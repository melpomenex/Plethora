//! RFC-4180 compliant streaming CSV reader with BOM stripping, multiline quoted fields,
//! alternate delimiter support, and spreadsheet formula-injection protection.

use std::io::{BufRead, BufReader, Read};

use super::limits::StreamingParserLimits;
use super::types::ImportError;

pub struct CsvStreamReader<R: Read> {
    reader: BufReader<R>,
    delimiter: u8,
    limits: StreamingParserLimits,
    first_chunk: bool,
    eof: bool,
    row_index: usize,
}

impl<R: Read> CsvStreamReader<R> {
    pub fn new(reader: R, delimiter: char, limits: StreamingParserLimits) -> Self {
        Self {
            reader: BufReader::with_capacity(64 * 1024, reader),
            delimiter: delimiter as u8,
            limits,
            first_chunk: true,
            eof: false,
            row_index: 0,
        }
    }

    pub fn next_row(&mut self) -> Result<Option<Vec<String>>, ImportError> {
        if self.eof {
            return Ok(None);
        }

        let mut fields: Vec<String> = Vec::new();
        let mut current = Vec::<u8>::new();
        let mut in_quotes = false;
        let mut at_field_start = true;
        let mut any_bytes = false;

        loop {
            let buf = self
                .reader
                .fill_buf()
                .map_err(|e| ImportError::Io(e.to_string()))?;
            if buf.is_empty() {
                self.eof = true;
                if in_quotes {
                    return Err(ImportError::InvalidInput(format!(
                        "CSV row {} contains an unterminated quoted field",
                        self.row_index + 1
                    )));
                }
                if !any_bytes && fields.is_empty() && current.is_empty() {
                    return Ok(None);
                }
                fields.push(bytes_to_string(&current, self.row_index + 1)?);
                self.row_index += 1;
                return Ok(Some(fields));
            }

            let mut consumed = 0usize;
            if self.first_chunk {
                self.first_chunk = false;
                if buf.starts_with(&[0xEF, 0xBB, 0xBF]) {
                    consumed = 3;
                    self.reader.consume(consumed);
                    continue;
                }
            }

            let mut row_done = false;
            while consumed < buf.len() {
                let b = buf[consumed];
                consumed += 1;
                any_bytes = true;

                if in_quotes {
                    if b == b'"' {
                        if consumed < buf.len() {
                            if buf[consumed] == b'"' {
                                current.push(b'"');
                                consumed += 1;
                            } else {
                                in_quotes = false;
                            }
                        } else {
                            // Peek next buffer to check for escaped quote
                            self.reader.consume(consumed);
                            consumed = 0;
                            let next_buf = self
                                .reader
                                .fill_buf()
                                .map_err(|e| ImportError::Io(e.to_string()))?;
                            if next_buf.first() == Some(&b'"') {
                                current.push(b'"');
                                self.reader.consume(1);
                            } else {
                                in_quotes = false;
                            }
                            break;
                        }
                    } else {
                        current.push(b);
                    }
                } else if at_field_start && b == b'"' {
                    in_quotes = true;
                    at_field_start = false;
                } else if b == self.delimiter {
                    fields.push(bytes_to_string(&current, self.row_index + 1)?);
                    current.clear();
                    at_field_start = true;
                } else if b == b'\n' {
                    if current.last() == Some(&b'\r') {
                        current.pop();
                    }
                    fields.push(bytes_to_string(&current, self.row_index + 1)?);
                    row_done = true;
                    break;
                } else if b == b'\r' {
                    current.push(b'\r');
                } else {
                    current.push(b);
                    at_field_start = false;
                }

                if current.len() > self.limits.max_csv_field_bytes {
                    return Err(ImportError::SecurityViolation(format!(
                        "CSV field on row {} exceeds {} byte limit",
                        self.row_index + 1,
                        self.limits.max_csv_field_bytes
                    )));
                }
            }

            self.reader.consume(consumed);

            if row_done {
                // Skip completely blank lines when not inside quotes
                if fields.len() == 1 && fields[0].trim().is_empty() {
                    fields.clear();
                    current.clear();
                    at_field_start = true;
                    any_bytes = false;
                    continue;
                }
                self.row_index += 1;
                if self.row_index > self.limits.max_csv_rows {
                    return Err(ImportError::SecurityViolation(format!(
                        "CSV row count exceeds {} row limit",
                        self.limits.max_csv_rows
                    )));
                }
                return Ok(Some(fields));
            }
        }
    }
}

fn bytes_to_string(bytes: &[u8], row_num: usize) -> Result<String, ImportError> {
    let s = std::str::from_utf8(bytes).map_err(|_| {
        ImportError::InvalidInput(format!("CSV row {row_num} contains invalid UTF-8"))
    })?;
    let trimmed = s.trim_start();
    if trimmed.starts_with('=')
        || trimmed.starts_with("@SUM")
        || trimmed.starts_with("\t=")
        || trimmed.starts_with("\r=")
    {
        return Err(ImportError::SecurityViolation(format!(
            "Row {row_num}: rejected unsafe formula expression"
        )));
    }
    Ok(s.to_string())
}

pub fn detect_csv_delimiter(sample: &str) -> char {
    let first_line = sample
        .trim_start_matches('\u{feff}')
        .lines()
        .find(|l| !l.trim().is_empty())
        .unwrap_or("");
    let counts = [
        (',', count_unquoted(first_line, ',')),
        (';', count_unquoted(first_line, ';')),
        ('\t', count_unquoted(first_line, '\t')),
        ('|', count_unquoted(first_line, '|')),
    ];
    counts
        .into_iter()
        .max_by_key(|(_, c)| *c)
        .filter(|(_, c)| *c > 0)
        .map(|(d, _)| d)
        .unwrap_or(',')
}

fn count_unquoted(line: &str, delim: char) -> usize {
    let mut in_quotes = false;
    let mut count = 0;
    for ch in line.chars() {
        if ch == '"' {
            in_quotes = !in_quotes;
        } else if ch == delim && !in_quotes {
            count += 1;
        }
    }
    count
}
