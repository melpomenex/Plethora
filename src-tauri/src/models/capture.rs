//! Durable capture origin and saved-link eligibility shared by analytics and the library.

use serde_json::Value;
use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub enum CaptureSource {
    #[serde(rename = "browser-extension")]
    BrowserExtension,
    #[serde(rename = "share-target")]
    ShareTarget,
    #[serde(rename = "rss")]
    Rss,
    #[serde(rename = "manual")]
    Manual,
}

pub fn classify_capture(metadata_json: Option<&str>) -> CaptureSource {
    let metadata = metadata_json.and_then(|json| serde_json::from_str::<Value>(json).ok());
    metadata
        .as_ref()
        .map(classify_metadata)
        .unwrap_or(CaptureSource::Manual)
}

fn classify_metadata(metadata: &Value) -> CaptureSource {
    let Some(obj) = metadata.as_object() else {
        return CaptureSource::Manual;
    };
    match obj
        .get("captureProvenance")
        .and_then(|v| v.get("source"))
        .and_then(Value::as_str)
    {
        Some("browser_extension") => return CaptureSource::BrowserExtension,
        Some("share_extension" | "android_share") => return CaptureSource::ShareTarget,
        _ => {}
    }
    // Typed DocumentMetadata serializes an absent Option as null; that is not a share capture.
    if obj
        .get("shareProvenance")
        .is_some_and(|value| !value.is_null())
    {
        return CaptureSource::ShareTarget;
    }
    match obj.get("source").and_then(Value::as_str) {
        Some("browser_extension") => CaptureSource::BrowserExtension,
        Some("share_extension" | "android_share") => CaptureSource::ShareTarget,
        Some("rss") => CaptureSource::Rss,
        _ => CaptureSource::Manual,
    }
}

/// Whether persisted metadata proves that a document arrived through a
/// supported native share entry point. Semantic tags and URL presence do not
/// establish this relationship.
pub fn share_capture_eligible(metadata_json: Option<&str>) -> bool {
    let Some(metadata) = metadata_json.and_then(|json| serde_json::from_str::<Value>(json).ok()) else {
        return false;
    };
    let Some(obj) = metadata.as_object() else {
        return false;
    };
    let is_native_share = |value: Option<&Value>| {
        value
            .and_then(|v| v.get("source"))
            .and_then(Value::as_str)
            .is_some_and(|source| matches!(source, "share_extension" | "android_share"))
    };
    is_native_share(obj.get("captureProvenance"))
        || is_native_share(obj.get("shareProvenance"))
        || obj
            .get("shareProvenance")
            .is_some_and(|value| !value.is_null())
        || obj
            .get("source")
            .and_then(Value::as_str)
            .is_some_and(|source| matches!(source, "share_extension" | "android_share"))
}

/// Resolve an optional original HTTP(S) URL for a share preview. Local file
/// paths, note URLs and unsupported schemes are never returned.
pub fn share_capture_url(metadata_json: Option<&str>, file_path: &str) -> Option<String> {
    let metadata: Value = serde_json::from_str(metadata_json?).ok()?;
    let candidates = [
        metadata.pointer("/shareProvenance/sourceUrl").and_then(Value::as_str),
        metadata.pointer("/shareProvenance/originalUrl").and_then(Value::as_str),
        metadata.pointer("/shareProvenance/url").and_then(Value::as_str),
        metadata.pointer("/captureProvenance/sourceUrl").and_then(Value::as_str),
        metadata.pointer("/browserCaptureContext/sourceUrl").and_then(Value::as_str),
        metadata.get("originalUrl").and_then(Value::as_str),
        metadata.get("url").and_then(Value::as_str),
        metadata.pointer("/webArticle/originalUrl").and_then(Value::as_str),
        Some(file_path),
    ];
    let result = candidates.into_iter().flatten().find_map(|candidate| {
        let url = Url::parse(candidate.trim()).ok()?;
        (matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
            .then(|| url.to_string())
    });
    result
}

/// First valid source candidate; a malformed newer field cannot mask a legacy URL.
pub fn browser_capture_url(metadata_json: Option<&str>, file_path: &str) -> Option<String> {
    let metadata: Value = serde_json::from_str(metadata_json?).ok()?;
    if classify_metadata(&metadata) != CaptureSource::BrowserExtension {
        return None;
    }
    let result = [
        metadata
            .pointer("/captureProvenance/sourceUrl")
            .and_then(Value::as_str),
        metadata
            .pointer("/browserCaptureContext/sourceUrl")
            .and_then(Value::as_str),
        metadata.get("originalUrl").and_then(Value::as_str),
        metadata.get("url").and_then(Value::as_str),
        metadata
            .pointer("/webArticle/originalUrl")
            .and_then(Value::as_str),
        Some(file_path),
    ]
    .into_iter()
    .flatten()
    .find_map(|candidate| {
        let url = Url::parse(candidate.trim()).ok()?;
        (matches!(url.scheme(), "http" | "https") && url.host_str().is_some())
            .then(|| url.to_string())
    });
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eligibility_uses_classifier_precedence_and_valid_url_fallback() {
        let cases = [
            (
                r#"{"source":"browser_extension"}"#,
                Some("https://example.org/page"),
            ),
            (
                r#"{"source":"browser_extension","shareProvenance":null}"#,
                Some("https://example.org/page"),
            ),
            (
                r#"{"source":"browser_extension","shareProvenance":{}}"#,
                None,
            ),
            (
                r#"{"source":"browser_extension","captureProvenance":{"source":"android_share"}}"#,
                None,
            ),
            (
                r#"{"shareProvenance":{},"captureProvenance":{"source":"browser_extension","sourceUrl":"javascript:bad"},"originalUrl":"https://example.org/original"}"#,
                Some("https://example.org/original"),
            ),
            (
                r#"{"captureProvenance":{"source":"unknown"},"source":"browser_extension"}"#,
                Some("https://example.org/page"),
            ),
            (r#"{"source":"manual","tags":["browser-extension"]}"#, None),
            ("not JSON", None),
            ("[]", None),
        ];
        for (metadata, expected) in cases {
            assert_eq!(
                browser_capture_url(Some(metadata), "https://example.org/page").as_deref(),
                expected
            );
        }
        assert!(browser_capture_url(
            Some(r#"{"source":"browser_extension"}"#),
            "file:///private/page"
        )
        .is_none());
    }

    #[test]
    fn share_eligibility_requires_persisted_evidence_and_accepts_legacy_markers() {
        for metadata in [
            r#"{"captureProvenance":{"source":"android_share"}}"#,
            r#"{"captureProvenance":{"source":"share_extension"}}"#,
            r#"{"shareProvenance":{"source":"android_share"}}"#,
            r#"{"shareProvenance":{}}"#,
            r#"{"source":"share_extension"}"#,
        ] {
            assert!(share_capture_eligible(Some(metadata)), "{metadata}");
        }
        for metadata in [
            r#"{"source":"manual","tags":["share_extension"]}"#,
            r#"{"source":"rss","url":"https://example.org"}"#,
            r#"{"shareProvenance":null}"#,
            "not JSON",
            "[]",
        ] {
            assert!(!share_capture_eligible(Some(metadata)), "{metadata}");
        }
    }

    #[test]
    fn share_url_resolution_uses_valid_fallbacks_and_rejects_local_schemes() {
        assert_eq!(
            share_capture_url(
                Some(r#"{"shareProvenance":{"sourceUrl":"javascript:bad"},"originalUrl":"https://example.org/original"}"#),
                "file:///private/document.pdf"
            ).as_deref(),
            Some("https://example.org/original")
        );
        assert!(share_capture_url(Some(r#"{"url":"note://local"}"#), "file:///private/document.pdf").is_none());
        assert!(share_capture_url(Some("not JSON"), "https://example.org").is_none());
        assert_eq!(
            share_capture_url(
                Some(r#"{"captureProvenance":{"source":"browser_extension"},"browserCaptureContext":{"sourceUrl":"https://example.org/context"},"originalUrl":"https://example.org/original"}"#),
                "https://example.org/path"
            ).as_deref(),
            Some("https://example.org/context")
        );
    }
}
