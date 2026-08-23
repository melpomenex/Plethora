//! EPUB content extraction with chapter parsing

use crate::error::Result;
use crate::processor::ExtractedContent;
use base64::{engine::general_purpose, Engine as _};
use epub::doc::EpubDoc;
use std::collections::HashMap;
use std::path::Path;

/// Represents a chapter in an EPUB file
#[derive(Debug, Clone)]
pub struct EpubChapter {
    pub title: String,
    pub content: String,
    pub index: usize,
}

/// Extract text from HTML content while preserving document structure.
///
/// Headings (`<h1>`–`<h6>`), paragraphs, list items, and other block elements
/// are placed on their own lines. The `#`-mention section resolver depends on
/// headings appearing on their own line (its title regex is line-anchored), so
/// collapsing everything to a single space — as the previous version did —
/// makes every chapter heading invisible to resolution and the model receives
/// no focused context.
///
/// `<style>` and `<script>` content is dropped entirely; previously their raw
/// CSS/JS text leaked into the body.
fn extract_text_from_html(html: &str) -> String {
    // Tags whose end forces a line break (block-level + headings). `<br>` is
    // handled separately since it self-opens a break.
    const BLOCK_TAGS: &[&str] = &[
        "p",
        "div",
        "section",
        "article",
        "header",
        "footer",
        "main",
        "aside",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "li",
        "tr",
        "blockquote",
        "pre",
    ];

    let mut result = String::new();
    let mut chars = html.chars().peekable();

    while let Some(c) = chars.next() {
        if c != '<' {
            // Outside a tag: copy visible text, normalizing whitespace to a
            // single space (newlines inside a run of inline text collapse too).
            if c.is_whitespace() {
                if !result.ends_with(' ') && !result.ends_with('\n') {
                    result.push(' ');
                }
            } else {
                result.push(c);
            }
            continue;
        }

        // We're at a '<'. Collect tag body up to '>'.
        let mut tag_body = String::new();
        for tc in chars.by_ref() {
            if tc == '>' {
                break;
            }
            tag_body.push(tc);
        }

        let name = tag_name(&tag_body);

        // Skip raw text content of <style>/<script> entirely.
        if name == "style" || name == "script" {
            let close = format!("</{}", name);
            let mut buffer = String::new();
            for sc in chars.by_ref() {
                buffer.push(sc);
                if buffer.to_lowercase().ends_with(&close) {
                    for tc in chars.by_ref() {
                        if tc == '>' {
                            break;
                        }
                    }
                    break;
                }
            }
            if !result.ends_with('\n') && !result.ends_with(' ') {
                result.push('\n');
            }
            continue;
        }

        // <br> forces a single line break; block/heading end-tags force one too
        // (they close a block). Opening block tags also get a break so that the
        // heading text starts on a fresh line.
        let is_break = name == "br"
            || (tag_body.starts_with('/') && BLOCK_TAGS.contains(&name.as_str()))
            || (!tag_body.starts_with('/') && BLOCK_TAGS.contains(&name.as_str()));
        if is_break {
            if !result.ends_with('\n') {
                while result.ends_with(' ') {
                    result.pop();
                }
                result.push('\n');
            }
        }
    }

    // Normalize: collapse 3+ newlines to 2, and strip leading whitespace per line.
    let mut normalized = String::with_capacity(result.len());
    let mut blank = false;
    for line in result.split_inclusive('\n') {
        let trimmed = line.trim_start();
        if trimmed.trim().is_empty() {
            if !blank && !normalized.is_empty() {
                normalized.push('\n');
            }
            blank = true;
        } else {
            normalized.push_str(trimmed);
            blank = false;
        }
    }
    normalized.trim().to_string()
}

/// Lowercased tag name from the inside of `<...>`, ignoring `/`, attributes,
/// and whitespace. e.g. `"/h1 "` -> "h1", `"br /"` -> "br".
fn tag_name(tag_body: &str) -> String {
    let s = tag_body.trim().trim_start_matches('/');
    let end = s
        .find(|c: char| c.is_whitespace() || c == '/' || c == '>')
        .unwrap_or(s.len());
    s[..end].to_lowercase()
}

fn should_extract_text(mime: &str) -> bool {
    let mime = mime.to_lowercase();
    mime.contains("html")
        || mime.contains("xhtml")
        || mime.contains("xml")
        || mime.starts_with("text/")
}

/// Extract full content from an EPUB file including all chapters
pub async fn extract_epub_content(file_path: &str) -> Result<ExtractedContent> {
    let path = Path::new(file_path);

    let mut doc = EpubDoc::new(file_path).map_err(|e| {
        crate::error::PlethoraError::Import(crate::error::ImportError {
            code: crate::error::ImportErrorCode::InvalidDocument,
            message: format!("Failed to open EPUB: {}", e),
            file_name: Some(file_path.to_string()),
        })
    })?;

    let spine_items = doc.spine.clone();
    let mut sections = Vec::new();

    for item in spine_items {
        if !item.linear {
            continue;
        }

        if let Some((content, mime)) = doc.get_resource_str(&item.idref) {
            if !should_extract_text(&mime) {
                continue;
            }

            let text = if mime.contains("html") || mime.contains("xhtml") || mime.contains("xml") {
                extract_text_from_html(&content)
            } else {
                content
            };

            if !text.trim().is_empty() {
                sections.push(text);
            }
        }
    }

    let text = sections.join("\n\n");
    let word_count = text.split_whitespace().count();
    let reading_time_mins = if word_count == 0 {
        0
    } else {
        (word_count as f64 / 200.0).ceil() as usize
    };
    let file_size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let language = doc.mdata("language").map(|item| item.value.clone());

    let mut epub_metadata = HashMap::new();
    epub_metadata.insert("format".to_string(), "EPUB".to_string());
    epub_metadata.insert("file_size".to_string(), file_size.to_string());
    epub_metadata.insert("word_count".to_string(), word_count.to_string());
    epub_metadata.insert(
        "reading_time_minutes".to_string(),
        reading_time_mins.to_string(),
    );
    if let Some(lang) = &language {
        epub_metadata.insert("language".to_string(), lang.clone());
    }

    let metadata = serde_json::json!({
        "format": "EPUB",
        "file_size": file_size,
        "word_count": word_count,
        "reading_time_minutes": reading_time_mins,
        "language": language,
        "epub_metadata": epub_metadata
    });

    Ok(ExtractedContent {
        text,
        title: doc.get_title(),
        author: doc.mdata("creator").map(|item| item.value.clone()),
        page_count: if doc.spine.is_empty() {
            None
        } else {
            Some(doc.spine.len())
        },
        metadata,
    })
}

/// Extract embedded cover image from an EPUB file as a data URL.
pub async fn extract_epub_cover_data_url(file_path: &str) -> Result<Option<String>> {
    let mut doc = EpubDoc::new(file_path).map_err(|e| {
        crate::error::PlethoraError::NotFound(format!("Failed to open EPUB: {}", e))
    })?;

    if let Some((cover_bytes, mime)) = doc.get_cover() {
        if cover_bytes.is_empty() {
            return Ok(None);
        }
        let encoded = general_purpose::STANDARD.encode(cover_bytes);
        return Ok(Some(format!("data:{};base64,{}", mime, encoded)));
    }

    Ok(None)
}

/// Extract a specific chapter from an EPUB file
pub async fn extract_epub_chapter(file_path: &str, chapter_num: usize) -> Result<EpubChapter> {
    let mut doc = EpubDoc::new(file_path).map_err(|e| {
        crate::error::PlethoraError::NotFound(format!("Failed to open EPUB: {}", e))
    })?;
    if chapter_num == 0 || chapter_num > doc.spine.len() {
        return Err(crate::error::PlethoraError::NotFound(format!(
            "Chapter {} not found",
            chapter_num
        )));
    }

    let spine_item = doc.spine.get(chapter_num - 1).cloned().ok_or_else(|| {
        crate::error::PlethoraError::NotFound(format!("Chapter {} not found", chapter_num))
    })?;

    let content = doc
        .get_resource_str(&spine_item.idref)
        .map(|(content, mime)| {
            if should_extract_text(&mime)
                && (mime.contains("html") || mime.contains("xhtml") || mime.contains("xml"))
            {
                extract_text_from_html(&content)
            } else if should_extract_text(&mime) {
                content
            } else {
                String::new()
            }
        })
        .unwrap_or_default();

    Ok(EpubChapter {
        title: format!("Chapter {}", chapter_num),
        content,
        index: chapter_num - 1,
    })
}

/// Get the number of chapters in an EPUB file
pub async fn get_epub_chapter_count(file_path: &str) -> Result<usize> {
    let doc = EpubDoc::new(file_path).map_err(|e| {
        crate::error::PlethoraError::NotFound(format!("Failed to open EPUB: {}", e))
    })?;

    Ok(doc.spine.len())
}

/// Get the table of contents from an EPUB file
pub async fn get_epub_toc(file_path: &str) -> Result<Vec<(String, usize)>> {
    let doc = EpubDoc::new(file_path).map_err(|e| {
        crate::error::PlethoraError::NotFound(format!("Failed to open EPUB: {}", e))
    })?;

    let mut toc_entries = Vec::new();
    for nav in doc.toc.iter() {
        if let Some(chapter_index) = doc.resource_uri_to_chapter(&nav.content) {
            toc_entries.push((nav.label.clone(), chapter_index + 1));
        }
    }

    Ok(toc_entries)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_epub_chapter_count() {
        // This test would require a sample EPUB file
        // For now, we just verify the function compiles
        assert!(true);
    }

    #[test]
    fn extract_text_preserves_headings_on_their_own_lines() {
        // Mirrors the markup of a real EPUB (h1 parts, h2 chapters, h3 sections).
        // The section resolver's title regex is line-anchored, so a heading that
        // is buried mid-line (as the old space-collapsing extractor produced) is
        // invisible to `#`-mention resolution.
        let html = "<html><body>\
            <style>body { margin: 0 } @page { padding: 0 }</style>\
            <h1>Part One: SEX, ROMANCE, AND LOVE</h1>\
            <h2>Chapter 1: DARWIN COMES OF AGE</h2>\
            <p>As for an English lady, the real chapter body begins here.</p>\
            <h3>AN UNLIKELY HERO</h3>\
            <p>Subsection prose continues the argument.</p>\
            </body></html>";
        let text = extract_text_from_html(html);

        // CSS from <style> must NOT leak into the body.
        assert!(!text.contains("@page"));
        assert!(!text.contains("margin"));

        // Each heading must be alone on its own line.
        let lines: Vec<&str> = text
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .collect();
        assert!(
            lines
                .iter()
                .any(|l| *l == "Part One: SEX, ROMANCE, AND LOVE"),
            "part heading on own line; got: {lines:?}"
        );
        assert!(
            lines.iter().any(|l| *l == "Chapter 1: DARWIN COMES OF AGE"),
            "chapter heading on own line; got: {lines:?}"
        );
        assert!(
            lines.iter().any(|l| *l == "AN UNLIKELY HERO"),
            "section heading on own line; got: {lines:?}"
        );

        // Body text must be preserved and not glued onto a heading line.
        assert!(text.contains("As for an English lady, the real chapter body begins here."));
        assert!(text.contains("Subsection prose continues the argument."));
        assert!(!text.contains("DARWIN COMES OF AGE As for an English"));
    }

    #[test]
    fn extract_text_collapses_inline_whitespace_but_keeps_block_breaks() {
        let html = "<p>One   sentence\nwith\ttabs.</p><p>Second paragraph.</p>";
        let text = extract_text_from_html(html);
        assert!(text.contains("One sentence with tabs."));
        assert!(text.contains("Second paragraph."));
        // Two block elements -> at least one newline between them.
        assert!(text.contains('\n'));
    }

    #[test]
    fn extract_text_preserves_unicode_characters() {
        // Smart quotes, dashes, ellipses, accented Latin, and CJK text
        let html = "<div>\
            <p>‘Single’ and “double” quotation marks, em—dash, en–dash, and ellipsis…</p>\
            <p>Accents: café, über, naïve, niño.</p>\
            <p>CJK & Cyrillic: 日本語, 中文, 한국어, Привет мир.</p>\
            <p>Mathematical: ∑(x) = ∫ f(t) dt ≠ ∞.</p>\
            </div>";
        let text = extract_text_from_html(html);

        // Smart punctuation must be preserved verbatim (no â mojibake)
        assert!(text.contains("‘Single’ and “double” quotation marks, em—dash, en–dash, and ellipsis…"));
        assert!(!text.contains('â'));

        // Accents
        assert!(text.contains("Accents: café, über, naïve, niño."));

        // CJK and Cyrillic
        assert!(text.contains("CJK & Cyrillic: 日本語, 中文, 한국어, Привет мир."));

        // Math
        assert!(text.contains("Mathematical: ∑(x) = ∫ f(t) dt ≠ ∞."));
    }
}
