//! Integration tests for document import robustness and crash prevention.
//! Verifies that malformed, corrupted, empty, or exotic document files
//! never panic or crash the process and return structured typed errors.

use std::path::PathBuf;
use plethora_tauri_lib::error::{ImportErrorCode, PlethoraError};
use plethora_tauri_lib::models::FileType;
use plethora_tauri_lib::processor;

fn fixture_path(subpath: &str) -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("tests");
    path.push("fixtures");
    path.push("documents");
    path.push(subpath);
    path
}

#[tokio::test]
async fn test_empty_pdf_does_not_panic() {
    let p = fixture_path("pdf/empty.pdf");
    assert!(p.exists(), "empty.pdf fixture missing");

    let result = processor::pdf::extract_pdf_content(p.to_str().unwrap()).await;
    assert!(
        result.is_err(),
        "Expected empty PDF to fail with typed error, but got ok"
    );
    match result {
        Err(PlethoraError::Import(err)) => {
            assert_eq!(err.code, ImportErrorCode::InvalidDocument);
        }
        Err(e) => panic!("Unexpected error type: {:?}", e),
        Ok(_) => unreachable!(),
    }
}

#[tokio::test]
async fn test_corrupt_header_pdf_does_not_panic() {
    let p = fixture_path("pdf/corrupt_header.pdf");
    assert!(p.exists(), "corrupt_header.pdf fixture missing");

    let result = processor::pdf::extract_pdf_content(p.to_str().unwrap()).await;
    assert!(
        result.is_err(),
        "Expected corrupt PDF to fail with typed error, but got ok"
    );
    match result {
        Err(PlethoraError::Import(err)) => {
            assert_eq!(err.code, ImportErrorCode::InvalidDocument);
        }
        Err(e) => panic!("Unexpected error type: {:?}", e),
        Ok(_) => unreachable!(),
    }
}

#[tokio::test]
async fn test_truncated_pdf_does_not_panic() {
    let p = fixture_path("pdf/truncated.pdf");
    assert!(p.exists(), "truncated.pdf fixture missing");

    // Must not panic or hang
    let result = processor::pdf::extract_pdf_content(p.to_str().unwrap()).await;
    // May succeed partially or fail with typed error, but never panics
    if let Err(e) = result {
        match e {
            PlethoraError::Import(_) => {}
            other => panic!("Unexpected non-import error: {:?}", other),
        }
    }
}

#[tokio::test]
async fn test_corrupt_epub_does_not_panic() {
    let p = fixture_path("epub/corrupt_zip.epub");
    assert!(p.exists(), "corrupt_zip.epub fixture missing");

    let result = processor::epub::extract_epub_content(p.to_str().unwrap()).await;
    assert!(
        result.is_err(),
        "Expected corrupt EPUB to fail with typed error, but got ok"
    );
    match result {
        Err(PlethoraError::Import(err)) => {
            assert_eq!(err.code, ImportErrorCode::InvalidDocument);
        }
        Err(e) => panic!("Unexpected error type: {:?}", e),
        Ok(_) => unreachable!(),
    }
}

#[tokio::test]
async fn test_unicode_emojis_markdown_imports_cleanly() {
    let p = fixture_path("text/unicode_emojis.md");
    assert!(p.exists(), "unicode_emojis.md fixture missing");

    let result = processor::extract_content(
        p.to_str().unwrap(),
        FileType::Markdown,
    )
    .await;

    assert!(result.is_ok(), "Failed to extract unicode markdown: {:?}", result.err());
    let extracted = result.unwrap();
    assert!(extracted.text.contains("日本語のテキスト"));
    assert!(extracted.text.contains("🦄"));
}

#[tokio::test]
async fn test_unclosed_tags_html_does_not_panic() {
    let p = fixture_path("html/unclosed_tags.html");
    assert!(p.exists(), "unclosed_tags.html fixture missing");

    let result = processor::extract_content(
        p.to_str().unwrap(),
        FileType::Html,
    )
    .await;

    assert!(result.is_ok(), "Failed to parse unclosed HTML: {:?}", result.err());
    let extracted = result.unwrap();
    assert!(!extracted.text.is_empty(), "Extracted text should not be empty");
}
