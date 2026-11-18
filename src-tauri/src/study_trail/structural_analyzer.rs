use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A coherent structural unit extracted from a source document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralUnit {
    pub unit_id: String,
    pub document_id: String,
    pub format: String,
    pub heading_path: Vec<String>,
    pub title: String,
    pub text: String,
    pub start_offset: usize,
    pub end_offset: usize,
    pub page_number: Option<u32>,
    pub end_page_number: Option<u32>,
    pub spine_index: Option<u32>,
    pub timestamp_ms: Option<i64>,
    pub end_timestamp_ms: Option<i64>,
    pub segment_id: Option<String>,
    pub word_count: usize,
    pub is_heading_only: bool,
    pub is_repeated_running_line: bool,
}

#[derive(Debug, Clone)]
pub enum StructuralSourceInput<'a> {
    Markdown {
        document_id: &'a str,
        text: &'a str,
    },
    Html {
        document_id: &'a str,
        html: &'a str,
    },
    Plain {
        document_id: &'a str,
        text: &'a str,
    },
    PdfPages {
        document_id: &'a str,
        pages: &'a [String],
    },
    EpubSpines {
        document_id: &'a str,
        spines: &'a [(u32, String)],
    },
    EpubTitledSpines {
        document_id: &'a str,
        spines: &'a [(u32, Option<String>, String)],
    },
    Transcript {
        document_id: &'a str,
        format: &'a str,
        segments: &'a [TranscriptUnitInput],
    },
}

#[derive(Debug, Clone)]
pub struct TranscriptUnitInput {
    pub segment_id: Option<String>,
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
    pub chapter: Option<String>,
}

const SECTION_SPLIT_TARGET_WORDS: usize = 260;

pub fn count_words(text: &str) -> usize {
    text.split_whitespace().count()
}

fn clean_extracted_text(raw: &str) -> String {
    crate::threadreader::decode_html_entities(raw)
        .replace('\u{00a0}', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_bare_chapter_label(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() || trimmed.len() > 24 {
        return false;
    }
    if trimmed.chars().all(|c| c.is_ascii_digit() || c == '.') {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.starts_with("chapter ") || lower.starts_with("part ") || lower.starts_with("section ")
}

fn is_inline_html_tag(tag_name: &str) -> bool {
    matches!(
        tag_name,
        "span"
            | "em"
            | "strong"
            | "i"
            | "b"
            | "u"
            | "a"
            | "small"
            | "sub"
            | "sup"
            | "abbr"
            | "cite"
            | "code"
            | "q"
            | "mark"
            | "font"
            | "s"
            | "del"
            | "ins"
            | "var"
            | "kbd"
            | "samp"
            | "dfn"
            | "time"
            | "wbr"
            | "img"
            | "ruby"
            | "rp"
    )
}

/// Strips HTML tags into readable plain text while preserving block breaks and
/// keeping inline spans (e.g., drop-caps like `<span class="stickup">A</span>t`)
/// attached without spurious spaces.
pub fn strip_html_to_blocks(html: &str) -> Vec<(Option<(u8, String)>, String)> {
    let mut blocks = Vec::new();
    let mut current = String::new();
    let mut in_tag = false;
    let mut tag_buf = String::new();
    let mut in_ignored_tag: Option<String> = None;
    let mut in_head = false;
    let mut in_title = false;
    let mut heading_level: Option<u8> = None;
    let mut heading_buf = String::new();

    for ch in html.chars() {
        if ch == '<' {
            in_tag = true;
            tag_buf.clear();
            continue;
        }
        if ch == '>' && in_tag {
            in_tag = false;
            let tag = tag_buf.trim();
            let self_closing = tag.ends_with('/');
            let lower = tag.to_ascii_lowercase();
            let is_closing = lower.starts_with('/');
            let tag_name = lower
                .trim_start_matches('/')
                .trim_end_matches('/')
                .split(|c: char| c.is_whitespace() || c == '/')
                .next()
                .unwrap_or("");

            if let Some(ref ignored) = in_ignored_tag {
                if is_closing && tag_name == ignored {
                    in_ignored_tag = None;
                }
                continue;
            }
            if !is_closing
                && !self_closing
                && matches!(
                    tag_name,
                    "script" | "style" | "noscript" | "template" | "svg" | "rt"
                )
            {
                in_ignored_tag = Some(tag_name.to_string());
                continue;
            }
            if tag_name == "head" {
                if is_closing {
                    in_head = false;
                    in_title = false;
                } else if !self_closing {
                    in_head = true;
                }
                continue;
            }
            if tag_name == "title" {
                if is_closing {
                    in_title = false;
                } else if !self_closing {
                    in_title = true;
                }
                continue;
            }
            if tag_name == "body" && !is_closing {
                in_head = false;
                in_title = false;
                continue;
            }
            if in_head || in_title {
                continue;
            }

            if !is_closing && !self_closing && tag_name.len() == 2 && tag_name.starts_with('h') {
                if let Ok(lvl) = tag_name[1..].parse::<u8>() {
                    if (1..=6).contains(&lvl) {
                        let flushed = clean_extracted_text(&current);
                        if !flushed.is_empty() {
                            blocks.push((None, flushed));
                        }
                        current.clear();
                        heading_level = Some(lvl);
                        heading_buf.clear();
                        continue;
                    }
                }
            }
            if is_closing && heading_level.is_some() && tag_name.starts_with('h') {
                let h_text = clean_extracted_text(&heading_buf);
                if !h_text.is_empty() {
                    blocks.push((heading_level.map(|l| (l, h_text.clone())), h_text));
                }
                heading_level = None;
                heading_buf.clear();
                continue;
            }
            if matches!(
                tag_name,
                "p" | "div"
                    | "section"
                    | "article"
                    | "header"
                    | "footer"
                    | "main"
                    | "aside"
                    | "li"
                    | "blockquote"
                    | "tr"
                    | "dt"
                    | "dd"
                    | "figcaption"
                    | "pre"
                    | "br"
                    | "hr"
            ) {
                if heading_level.is_some() {
                    if tag_name == "br" && !heading_buf.ends_with(' ') {
                        heading_buf.push(' ');
                    }
                } else {
                    let flushed = clean_extracted_text(&current);
                    if !flushed.is_empty() {
                        blocks.push((None, flushed));
                    }
                    current.clear();
                }
            } else if matches!(tag_name, "td" | "th") {
                if !current.is_empty() && !current.ends_with(' ') {
                    current.push(' ');
                }
            } else if !is_inline_html_tag(tag_name) && !current.is_empty() && !current.ends_with(' ') {
                current.push(' ');
            }
            continue;
        }
        if in_tag {
            tag_buf.push(ch);
        } else if in_ignored_tag.is_none() && !in_head && !in_title {
            if let Some(_) = heading_level {
                if ch.is_whitespace() {
                    if !heading_buf.ends_with(' ') {
                        heading_buf.push(' ');
                    }
                } else {
                    heading_buf.push(ch);
                }
            } else if ch.is_whitespace() {
                if !current.ends_with(' ') {
                    current.push(' ');
                }
            } else {
                current.push(ch);
            }
        }
    }

    let tail = clean_extracted_text(&current);
    if !tail.is_empty() {
        blocks.push((None, tail));
    }
    blocks
}

fn update_heading_stack(stack: &mut Vec<(u8, String)>, level: u8, title: String) {
    while stack.last().is_some_and(|(l, _)| *l >= level) {
        stack.pop();
    }
    stack.push((level, title));
}

fn looks_like_plain_heading(line: &str) -> Option<(u8, String)> {
    let trimmed = line.trim();
    if trimmed.is_empty()
        || trimmed.len() > 110
        || trimmed.contains("...")
        || trimmed.contains('…')
        || trimmed.starts_with('—')
        || trimmed.starts_with('*')
    {
        return None;
    }
    if trimmed.ends_with('.') || trimmed.ends_with('?') || trimmed.ends_with('!') {
        return None;
    }
    let words = count_words(trimmed);
    if words == 0 || words > 12 {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("chapter ")
        || lower.starts_with("part ")
        || lower.starts_with("section ")
        || lower.starts_with("rule ")
        || lower == "table of contents"
        || lower == "contents"
        || lower == "bibliography"
        || lower == "references"
        || lower == "works cited"
        || lower == "index"
        || lower == "notes"
        || lower == "endnotes"
        || lower == "preface"
        || lower == "introduction"
        || lower == "appendix"
        || lower == "about the author"
        || lower == "acknowledgments"
        || lower == "acknowledgements"
    {
        return Some((1, trimmed.to_string()));
    }
    // Numbered heading like "1.2 Knowledge and Belief"
    let first = trimmed.chars().next()?;
    if first.is_ascii_digit() && trimmed.contains(' ') {
        let prefix = trimmed.split_whitespace().next()?;
        if prefix.chars().all(|c| c.is_ascii_digit() || c == '.') {
            return Some((2, trimmed.to_string()));
        }
    }
    // All-caps short heading (require >= 4 letters and skip Q:/A: flashcard prefixes like "A: 1991")
    let alpha_count = trimmed.chars().filter(|c| c.is_ascii_alphabetic()).count();
    if alpha_count >= 4
        && !lower.starts_with("q:")
        && !lower.starts_with("a:")
        && trimmed
            .chars()
            .filter(|c| c.is_ascii_alphabetic())
            .all(|c| c.is_ascii_uppercase())
    {
        return Some((1, trimmed.to_string()));
    }
    None
}

fn stack_is_non_prose(stack: &[(u8, String)]) -> bool {
    stack.iter().any(|(_, title)| {
        let lower = title.trim().to_ascii_lowercase();
        matches!(
            lower.as_str(),
            "table of contents"
                | "contents"
                | "toc"
                | "bibliography"
                | "references"
                | "works cited"
                | "selected bibliography"
                | "further reading"
                | "notes"
                | "endnotes"
                | "footnotes"
                | "index"
                | "subject index"
                | "name index"
                | "author index"
        )
    })
}

fn push_heading_with_merge(
    stack: &mut Vec<(u8, String)>,
    level: u8,
    title: String,
    had_body_since_heading: bool,
) {
    if !had_body_since_heading {
        if let Some((prev_lvl, prev_title)) = stack.last() {
            if *prev_lvl == level && is_bare_chapter_label(prev_title) {
                let merged = format!(
                    "{}: {}",
                    prev_title.trim().trim_end_matches(':'),
                    title.trim()
                );
                stack.pop();
                update_heading_stack(stack, level, merged);
                return;
            }
        }
        let norm_new = title
            .chars()
            .filter(|c| c.is_alphanumeric())
            .flat_map(char::to_lowercase)
            .collect::<String>();
        if let Some((1, top)) = stack.first() {
            let norm_top = top
                .chars()
                .filter(|c| c.is_alphanumeric())
                .flat_map(char::to_lowercase)
                .collect::<String>();
            if !norm_new.is_empty() && norm_top == norm_new {
                stack[0] = (1, title);
                stack.truncate(1);
                return;
            }
        }
    }
    update_heading_stack(stack, level, title);
}

/// Extracts coherent structural units from any supported source format.
pub fn analyze_document_structure(input: StructuralSourceInput<'_>) -> Vec<StructuralUnit> {
    match input {
        StructuralSourceInput::Markdown { document_id, text } => {
            analyze_markdown(document_id, text)
        }
        StructuralSourceInput::Html { document_id, html } => {
            analyze_html(document_id, html, "html", None, None)
        }
        StructuralSourceInput::Plain { document_id, text } => {
            analyze_plain(document_id, text, "text")
        }
        StructuralSourceInput::PdfPages { document_id, pages } => analyze_pdf(document_id, pages),
        StructuralSourceInput::EpubSpines {
            document_id,
            spines,
        } => analyze_epub(document_id, spines),
        StructuralSourceInput::EpubTitledSpines {
            document_id,
            spines,
        } => analyze_epub_titled(document_id, spines),
        StructuralSourceInput::Transcript {
            document_id,
            format,
            segments,
        } => analyze_transcript(document_id, format, segments),
    }
}

fn analyze_markdown(document_id: &str, text: &str) -> Vec<StructuralUnit> {
    let mut units = Vec::new();
    let mut stack: Vec<(u8, String)> = Vec::new();
    let mut current_lines: Vec<&str> = Vec::new();
    let mut buf_words = 0usize;
    let mut section_start = 0usize;
    let mut offset = 0usize;
    let mut idx = 0usize;

    let flush = |units: &mut Vec<StructuralUnit>,
                 stack: &[(u8, String)],
                 lines: &[&str],
                 start: usize,
                 end: usize,
                 idx: &mut usize| {
        let body = lines.join("\n").trim().to_string();
        if body.is_empty() {
            return;
        }
        let heading_path: Vec<String> = stack.iter().map(|(_, t)| t.clone()).collect();
        let title = heading_path
            .last()
            .cloned()
            .unwrap_or_else(|| "Section".to_string());
        let wc = count_words(&body);
        *idx += 1;
        units.push(StructuralUnit {
            unit_id: format!("{}:md:{}", document_id, *idx),
            document_id: document_id.to_string(),
            format: "markdown".to_string(),
            heading_path,
            title,
            text: body,
            start_offset: start,
            end_offset: end,
            page_number: None,
            end_page_number: None,
            spine_index: None,
            timestamp_ms: None,
            end_timestamp_ms: None,
            segment_id: None,
            word_count: wc,
            is_heading_only: false,
            is_repeated_running_line: false,
        });
    };

    for raw_line in text.split_inclusive('\n') {
        let trimmed = raw_line.trim_end_matches(['\r', '\n']);
        let hashes = trimmed.chars().take_while(|&c| c == '#').count();
        if (1..=6).contains(&hashes) && trimmed.chars().nth(hashes) == Some(' ') {
            flush(
                &mut units,
                &stack,
                &current_lines,
                section_start,
                offset,
                &mut idx,
            );
            current_lines.clear();
            buf_words = 0;
            let heading_title = trimmed[hashes + 1..].trim().to_string();
            update_heading_stack(&mut stack, hashes as u8, heading_title);
            section_start = offset + raw_line.len();
        } else if trimmed.trim().is_empty() {
            if current_lines.is_empty() {
                section_start = offset + raw_line.len();
            } else if buf_words >= SECTION_SPLIT_TARGET_WORDS && !stack_is_non_prose(&stack) {
                flush(
                    &mut units,
                    &stack,
                    &current_lines,
                    section_start,
                    offset,
                    &mut idx,
                );
                current_lines.clear();
                buf_words = 0;
                section_start = offset + raw_line.len();
            } else {
                current_lines.push(trimmed);
            }
        } else {
            if current_lines.is_empty() {
                section_start = offset;
            }
            buf_words += count_words(trimmed);
            current_lines.push(trimmed);
        }
        offset += raw_line.len();
    }
    flush(
        &mut units,
        &stack,
        &current_lines,
        section_start,
        offset,
        &mut idx,
    );

    if units.is_empty() && !text.trim().is_empty() {
        let trimmed = text.trim();
        units.push(StructuralUnit {
            unit_id: format!("{}:md:1", document_id),
            document_id: document_id.to_string(),
            format: "markdown".to_string(),
            heading_path: vec![],
            title: "Document".to_string(),
            text: trimmed.to_string(),
            start_offset: 0,
            end_offset: text.len(),
            page_number: None,
            end_page_number: None,
            spine_index: None,
            timestamp_ms: None,
            end_timestamp_ms: None,
            segment_id: None,
            word_count: count_words(trimmed),
            is_heading_only: count_words(trimmed) <= 12,
            is_repeated_running_line: false,
        });
    }
    units
}

fn analyze_html(
    document_id: &str,
    html: &str,
    format: &str,
    spine_index: Option<u32>,
    initial_heading: Option<&str>,
) -> Vec<StructuralUnit> {
    let blocks = strip_html_to_blocks(html);
    let mut units = Vec::new();
    let mut stack: Vec<(u8, String)> = Vec::new();
    if let Some(init) = initial_heading.map(str::trim).filter(|s| !s.is_empty()) {
        stack.push((1, init.to_string()));
    }
    let mut buf = Vec::new();
    let mut buf_words = 0usize;
    let mut offset = 0usize;
    let mut section_start = 0usize;
    let mut idx = 0usize;
    let mut had_body_since_heading = false;

    let flush = |units: &mut Vec<StructuralUnit>,
                 stack: &[(u8, String)],
                 buf: &[String],
                 start: usize,
                 end: usize,
                 idx: &mut usize| {
        let body = buf.join("\n\n").trim().to_string();
        if body.is_empty() {
            return;
        }
        let heading_path: Vec<String> = stack.iter().map(|(_, t)| t.clone()).collect();
        let title = heading_path
            .last()
            .cloned()
            .unwrap_or_else(|| "Section".to_string());
        let wc = count_words(&body);
        *idx += 1;
        units.push(StructuralUnit {
            unit_id: format!(
                "{}:{}:{}:{}",
                document_id,
                format,
                spine_index.unwrap_or(0),
                *idx
            ),
            document_id: document_id.to_string(),
            format: format.to_string(),
            heading_path,
            title,
            text: body,
            start_offset: start,
            end_offset: end,
            page_number: None,
            end_page_number: None,
            spine_index,
            timestamp_ms: None,
            end_timestamp_ms: None,
            segment_id: None,
            word_count: wc,
            is_heading_only: false,
            is_repeated_running_line: false,
        });
    };

    for (heading, text) in blocks {
        let len = text.len() + 2;
        if let Some((lvl, h_title)) = heading {
            flush(&mut units, &stack, &buf, section_start, offset, &mut idx);
            buf.clear();
            buf_words = 0;
            push_heading_with_merge(&mut stack, lvl, h_title, had_body_since_heading);
            had_body_since_heading = false;
            section_start = offset + len;
        } else {
            let block_words = count_words(&text);
            let is_toc_start = buf
                .first()
                .is_some_and(|first| first.trim().eq_ignore_ascii_case("contents") || first.trim().eq_ignore_ascii_case("table of contents"));
            if !buf.is_empty()
                && buf_words >= SECTION_SPLIT_TARGET_WORDS
                && !stack_is_non_prose(&stack)
                && !is_toc_start
            {
                flush(&mut units, &stack, &buf, section_start, offset, &mut idx);
                buf.clear();
                buf_words = 0;
            }
            if buf.is_empty() {
                section_start = offset;
            }
            buf.push(text);
            buf_words += block_words;
            had_body_since_heading = true;
        }
        offset += len;
    }
    flush(&mut units, &stack, &buf, section_start, offset, &mut idx);
    units
}

fn analyze_plain(document_id: &str, text: &str, format: &str) -> Vec<StructuralUnit> {
    let mut units = Vec::new();
    let mut stack: Vec<(u8, String)> = Vec::new();
    let mut buf: Vec<&str> = Vec::new();
    let mut buf_words = 0usize;
    let mut section_start = 0usize;
    let mut offset = 0usize;
    let mut idx = 0usize;
    let mut had_body_since_heading = false;

    let flush = |units: &mut Vec<StructuralUnit>,
                 stack: &[(u8, String)],
                 buf: &[&str],
                 start: usize,
                 end: usize,
                 idx: &mut usize| {
        let body = buf.join("\n").trim().to_string();
        if body.is_empty() {
            return;
        }
        let heading_path: Vec<String> = stack.iter().map(|(_, t)| t.clone()).collect();
        let title = heading_path
            .last()
            .cloned()
            .unwrap_or_else(|| "Passage".to_string());
        let wc = count_words(&body);
        *idx += 1;
        units.push(StructuralUnit {
            unit_id: format!("{}:{}:{}", document_id, format, *idx),
            document_id: document_id.to_string(),
            format: format.to_string(),
            heading_path,
            title,
            text: body,
            start_offset: start,
            end_offset: end,
            page_number: None,
            end_page_number: None,
            spine_index: None,
            timestamp_ms: None,
            end_timestamp_ms: None,
            segment_id: None,
            word_count: wc,
            is_heading_only: false,
            is_repeated_running_line: false,
        });
    };

    for raw_line in text.split_inclusive('\n') {
        let trimmed = raw_line.trim_end_matches(['\r', '\n']);
        if let Some((lvl, h_title)) = looks_like_plain_heading(trimmed) {
            flush(&mut units, &stack, &buf, section_start, offset, &mut idx);
            buf.clear();
            buf_words = 0;
            push_heading_with_merge(&mut stack, lvl, h_title, had_body_since_heading);
            had_body_since_heading = false;
            section_start = offset + raw_line.len();
        } else if trimmed.trim().is_empty() {
            if buf.is_empty() {
                section_start = offset + raw_line.len();
            } else if buf_words >= SECTION_SPLIT_TARGET_WORDS && !stack_is_non_prose(&stack) {
                flush(&mut units, &stack, &buf, section_start, offset, &mut idx);
                buf.clear();
                buf_words = 0;
                section_start = offset + raw_line.len();
            } else {
                buf.push(trimmed);
            }
        } else {
            if buf.is_empty() {
                section_start = offset;
            }
            buf_words += count_words(trimmed);
            buf.push(trimmed);
            had_body_since_heading = true;
        }
        offset += raw_line.len();
    }
    flush(&mut units, &stack, &buf, section_start, offset, &mut idx);
    units
}

fn normalize_running_edge(line: &str) -> String {
    line.trim()
        .chars()
        .map(|c| {
            if c.is_ascii_digit() {
                '#'
            } else {
                c.to_ascii_lowercase()
            }
        })
        .collect()
}

fn looks_like_edge_page_number(line: &str) -> bool {
    let trimmed = line.trim();
    !trimmed.is_empty()
        && trimmed.len() <= 9
        && trimmed.chars().any(|c| c.is_ascii_digit())
        && trimmed
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '/' | '-' | ' ' | '.' | '|'))
}

fn analyze_pdf(document_id: &str, pages: &[String]) -> Vec<StructuralUnit> {
    // Detect repeated running headers/footers across >= 3 pages (normalizing digits so "3/15" matches "4/15").
    let mut line_freq: HashMap<String, usize> = HashMap::new();
    for page in pages {
        let lines: Vec<&str> = page
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        for edge in lines.iter().take(3).chain(lines.iter().rev().take(3)) {
            if edge.len() <= 120 {
                let norm = normalize_running_edge(edge);
                *line_freq.entry(norm).or_insert(0) += 1;
            }
        }
    }
    let threshold = if pages.len() >= 4 { 3 } else { usize::MAX };
    let is_running_edge = |line: &str| {
        (line.len() <= 120
            && line_freq
                .get(&normalize_running_edge(line))
                .copied()
                .unwrap_or(0)
                >= threshold)
            || looks_like_edge_page_number(line)
    };

    let mut units = Vec::new();
    let mut stack: Vec<(u8, String)> = Vec::new();
    let mut offset = 0usize;

    for (page_idx, page_text) in pages.iter().enumerate() {
        let page_num = (page_idx + 1) as u32;
        let lines: Vec<&str> = page_text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();

        // Trim running headers/footers strictly from page edges so remaining lines stay contiguous.
        let mut start_idx = 0usize;
        while start_idx < lines.len() && start_idx < 3 && is_running_edge(lines[start_idx]) {
            start_idx += 1;
        }
        let mut end_idx = lines.len();
        let mut end_trimmed = 0usize;
        while end_idx > start_idx && end_trimmed < 3 && is_running_edge(lines[end_idx - 1]) {
            end_idx -= 1;
            end_trimmed += 1;
        }
        let body_lines = &lines[start_idx..end_idx];

        let mut cleaned_lines = Vec::with_capacity(body_lines.len());
        for &trimmed in body_lines {
            if let Some((lvl, h_title)) = looks_like_plain_heading(trimmed) {
                update_heading_stack(&mut stack, lvl, h_title);
            }
            cleaned_lines.push(trimmed);
        }
        let body = cleaned_lines.join("\n").trim().to_string();
        let len = page_text.len() + 1;
        if !body.is_empty() {
            let heading_path: Vec<String> = stack.iter().map(|(_, t)| t.clone()).collect();
            let title = heading_path
                .last()
                .cloned()
                .unwrap_or_else(|| format!("Page {}", page_num));
            let wc = count_words(&body);
            units.push(StructuralUnit {
                unit_id: format!("{}:pdf:p{}", document_id, page_num),
                document_id: document_id.to_string(),
                format: "pdf".to_string(),
                heading_path,
                title,
                text: body,
                start_offset: offset,
                end_offset: offset + page_text.len(),
                page_number: Some(page_num),
                end_page_number: Some(page_num),
                spine_index: None,
                timestamp_ms: None,
                end_timestamp_ms: None,
                segment_id: None,
                word_count: wc,
                is_heading_only: wc <= 8,
                is_repeated_running_line: false,
            });
        }
        offset += len;
    }
    units
}

fn analyze_epub(document_id: &str, spines: &[(u32, String)]) -> Vec<StructuralUnit> {
    let titled: Vec<(u32, Option<String>, String)> = spines
        .iter()
        .map(|(idx, content)| (*idx, None, content.clone()))
        .collect();
    analyze_epub_titled(document_id, &titled)
}

fn analyze_epub_titled(
    document_id: &str,
    spines: &[(u32, Option<String>, String)],
) -> Vec<StructuralUnit> {
    let mut units = Vec::new();
    let mut doc_offset = 0usize;
    for (spine_idx, toc_title, content) in spines {
        let mut spine_units = if content.contains('<') && content.contains('>') {
            analyze_html(
                document_id,
                content,
                "epub",
                Some(*spine_idx),
                toc_title.as_deref(),
            )
        } else {
            let mut plain_units = analyze_plain(document_id, content, "epub");
            for u in &mut plain_units {
                u.spine_index = Some(*spine_idx);
                if u.heading_path.is_empty() {
                    if let Some(title) = toc_title.as_ref().filter(|t| !t.trim().is_empty()) {
                        u.heading_path.push(title.clone());
                        u.title = title.clone();
                    }
                }
                u.unit_id = format!("{}:epub:{}:{}", document_id, spine_idx, u.start_offset);
            }
            plain_units
        };
        let mut spine_max_end = 0usize;
        for u in &mut spine_units {
            spine_max_end = spine_max_end.max(u.end_offset);
            u.start_offset += doc_offset;
            u.end_offset += doc_offset;
        }
        doc_offset += spine_max_end.max(content.len()) + 2;
        units.append(&mut spine_units);
    }
    units
}

fn analyze_transcript(
    document_id: &str,
    format: &str,
    segments: &[TranscriptUnitInput],
) -> Vec<StructuralUnit> {
    // Group transcript segments into ~180-word coherent units, breaking on chapter changes
    let mut units = Vec::new();
    let mut buf: Vec<String> = Vec::new();
    let mut current_chapter: Option<String> = None;
    let mut start_ms = 0i64;
    let mut end_ms = 0i64;
    let mut first_seg_id: Option<String> = None;
    let mut offset = 0usize;
    let mut idx = 0usize;

    let flush = |units: &mut Vec<StructuralUnit>,
                 buf: &[String],
                 chapter: &Option<String>,
                 s_ms: i64,
                 e_ms: i64,
                 seg_id: &Option<String>,
                 offset: &mut usize,
                 idx: &mut usize| {
        let body = buf.join(" ").trim().to_string();
        if body.is_empty() {
            return;
        }
        let wc = count_words(&body);
        let title = chapter.clone().unwrap_or_else(|| {
            let secs = (s_ms.max(0) / 1000) as u64;
            format!("Segment {}:{:02}", secs / 60, secs % 60)
        });
        let start_off = *offset;
        *offset += body.len() + 1;
        *idx += 1;
        units.push(StructuralUnit {
            unit_id: format!("{}:{}:{}", document_id, format, *idx),
            document_id: document_id.to_string(),
            format: format.to_string(),
            heading_path: chapter.iter().cloned().collect(),
            title,
            text: body,
            start_offset: start_off,
            end_offset: *offset,
            page_number: None,
            end_page_number: None,
            spine_index: None,
            timestamp_ms: Some(s_ms),
            end_timestamp_ms: Some(e_ms),
            segment_id: seg_id.clone(),
            word_count: wc,
            is_heading_only: false,
            is_repeated_running_line: false,
        });
    };

    for seg in segments {
        let chapter_changed = seg.chapter.is_some() && seg.chapter != current_chapter && !buf.is_empty();
        let current_words: usize = buf.iter().map(|s| count_words(s)).sum();
        if chapter_changed || current_words >= 180 {
            flush(
                &mut units,
                &buf,
                &current_chapter,
                start_ms,
                end_ms,
                &first_seg_id,
                &mut offset,
                &mut idx,
            );
            buf.clear();
            first_seg_id = None;
        }
        if buf.is_empty() {
            start_ms = seg.start_ms;
            first_seg_id = seg.segment_id.clone();
            current_chapter = seg.chapter.clone();
        }
        end_ms = seg.end_ms;
        buf.push(seg.text.trim().to_string());
    }
    flush(
        &mut units,
        &buf,
        &current_chapter,
        start_ms,
        end_ms,
        &first_seg_id,
        &mut offset,
        &mut idx,
    );
    units
}
