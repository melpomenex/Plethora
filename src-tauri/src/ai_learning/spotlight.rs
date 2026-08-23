//! Core Spotlight identity helpers. SQLite remains source of truth.

use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SpotlightKind {
    Document,
    Chunk,
    Extract,
    Card,
}

impl SpotlightKind {
    pub fn as_str(self) -> &'static str {
        match self {
            SpotlightKind::Document => "document",
            SpotlightKind::Chunk => "chunk",
            SpotlightKind::Extract => "extract",
            SpotlightKind::Card => "card",
        }
    }

    pub fn parse(raw: &str) -> Option<Self> {
        match raw {
            "document" => Some(Self::Document),
            "chunk" => Some(Self::Chunk),
            "extract" => Some(Self::Extract),
            "card" => Some(Self::Card),
            _ => None,
        }
    }
}

pub fn format_uri(kind: SpotlightKind, id: &str) -> String {
    format!("plethora://{}/{}", kind.as_str(), id)
}

pub fn parse_uri(uri: &str) -> Option<(SpotlightKind, String)> {
    let rest = uri.strip_prefix("plethora://")?;
    let (kind, id) = rest.split_once('/')?;
    let kind = SpotlightKind::parse(kind)?;
    if id.is_empty() {
        return None;
    }
    Some((kind, id.to_string()))
}

pub type SpotlightDonateFn = dyn Fn(&[SpotlightItem]) + Send + Sync;
pub type SpotlightDeleteFn = dyn Fn(&[String]) + Send + Sync;

#[derive(Debug, Clone)]
pub struct SpotlightItem {
    pub identifier: String,
    pub domain: String,
    pub title: String,
    pub text: String,
    pub uri: String,
    pub publicly_indexable: bool,
}

static DONATE: Mutex<Option<Arc<SpotlightDonateFn>>> = Mutex::new(None);
static DELETE: Mutex<Option<Arc<SpotlightDeleteFn>>> = Mutex::new(None);

pub fn install_spotlight_projector(
    donate: Arc<SpotlightDonateFn>,
    delete: Arc<SpotlightDeleteFn>,
) {
    *DONATE.lock().expect("spotlight donate lock") = Some(donate);
    *DELETE.lock().expect("spotlight delete lock") = Some(delete);
}

pub fn donate_items(items: &[SpotlightItem]) {
    if let Ok(guard) = DONATE.lock() {
        if let Some(f) = guard.as_ref() {
            f(items);
        }
    }
}

pub fn delete_identifiers(ids: &[String]) {
    if let Ok(guard) = DELETE.lock() {
        if let Some(f) = guard.as_ref() {
            f(ids);
        }
    }
}

pub fn donate_document_chunks(document_id: &str, title: &str, chunk_ids_and_text: &[(String, String)]) {
    let mut items = vec![SpotlightItem {
        identifier: format_uri(SpotlightKind::Document, document_id),
        domain: "plethora".into(),
        title: title.to_string(),
        text: title.to_string(),
        uri: format_uri(SpotlightKind::Document, document_id),
        publicly_indexable: false,
    }];
    for (id, text) in chunk_ids_and_text {
        items.push(SpotlightItem {
            identifier: format_uri(SpotlightKind::Chunk, id),
            domain: "plethora".into(),
            title: title.to_string(),
            text: text.clone(),
            uri: format_uri(SpotlightKind::Chunk, id),
            publicly_indexable: false,
        });
    }
    donate_items(&items);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_four_kinds() {
        for kind in [
            SpotlightKind::Document,
            SpotlightKind::Chunk,
            SpotlightKind::Extract,
            SpotlightKind::Card,
        ] {
            let uri = format_uri(kind, "abc-123");
            assert_eq!(parse_uri(&uri), Some((kind, "abc-123".into())));
        }
        assert!(parse_uri("https://example.com").is_none());
        assert!(parse_uri("plethora://unknown/x").is_none());
    }
}
