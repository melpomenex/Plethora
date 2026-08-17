//! HTML content extraction

use crate::error::Result;
use crate::processor::ExtractedContent;
use std::path::Path;

pub async fn extract_html_content(file_path: &str) -> Result<ExtractedContent> {
    let path = Path::new(file_path);

    // Read the HTML file
    let content = match tokio::fs::read_to_string(path).await {
        Ok(c) => c,
        Err(e) => {
            return Err(crate::error::PlethoraError::NotFound(format!(
                "Failed to read HTML file: {}",
                e
            )))
        }
    };

    // Extract title from <title> tag
    let title = extract_title_from_html(&content);

    let text = extract_text_from_html_fragment(&content);

    // Estimate page count
    let word_count = text.split_whitespace().count();
    let page_count = (word_count / 300).max(1);

    let metadata = serde_json::json!({
        "format": "HTML",
        "word_count": word_count,
    });

    Ok(ExtractedContent {
        text,
        title,
        author: None,
        page_count: Some(page_count),
        metadata,
    })
}

fn extract_title_from_html(html: &str) -> Option<String> {
    let title_start = html.find("<title>")?;
    let title_end = html.find("</title>")?;

    if title_end > title_start {
        let title = &html[title_start + 7..title_end];
        Some(title.trim().to_string())
    } else {
        None
    }
}

/// Convert stored article HTML into stable plain text for reading, Q&A, and
/// recovery of legacy browser-extension imports.
pub fn extract_text_from_html_fragment(html: &str) -> String {
    html2text::from_read(html.as_bytes(), 80)
        .unwrap_or_else(|_| {
            regex::Regex::new(r"<[^>]+>")
                .expect("valid html tag regex")
                .replace_all(html, " ")
                .to_string()
        })
        .replace('\u{a0}', " ")
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        .replace("\n\n\n", "\n\n")
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::extract_text_from_html_fragment;

    #[test]
    fn extracts_readable_text_without_script_content() {
        let text = extract_text_from_html_fragment(
            "<article><h1>Title</h1><p>Durable body.</p><script>ignore()</script></article>",
        );
        assert!(text.contains("Title"));
        assert!(text.contains("Durable body."));
        assert!(!text.contains("ignore()"));
    }
}
