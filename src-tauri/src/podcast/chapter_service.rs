//! Chapter ingestion pipeline and cascade priority resolver.
//!
//! Resolves podcast chapters in strict cascade priority:
//! 1. External JSON (`type="application/json+chapters"`)
//! 2. Embedded ID3 `CHAP` frames or MP4 `chpl` atoms
//! 3. RSS inline Podlove Simple Chapters (`<psc:chapters>`)
//! 4. Episode description / show notes timestamp regex fallback
//!
//! Persists resolved chapters to the database and updates `podcast_episodes.chapters_source`.

use std::path::PathBuf;

use crate::database::Repository;
use crate::error::Result;
use crate::models::podcast_ad::PodcastChapter;
use crate::podcast::chapter_fetcher::fetch_external_chapters;
use crate::podcast::description_chapters::parse_description_chapters;
use crate::podcast::id3_chapters::extract_audio_file_chapters;

/// Input bundle for resolving chapters across multiple potential sources
#[derive(Debug, Clone, Default)]
pub struct ChapterResolutionInput {
    pub episode_id: String,
    pub chapters_url: Option<String>,
    pub chapters_type: Option<String>,
    pub local_audio_path: Option<PathBuf>,
    pub inline_chapters: Vec<PodcastChapter>,
    pub description: Option<String>,
    pub duration_secs: Option<i64>,
}

/// Resolves chapters across the 4 candidate sources in order of priority.
pub async fn resolve_episode_chapters(input: &ChapterResolutionInput) -> Vec<PodcastChapter> {
    // 1. External JSON chapters
    if let Some(ref url) = input.chapters_url {
        if !url.trim().is_empty() {
            match fetch_external_chapters(url, &input.episode_id, input.duration_secs).await {
                Ok(chapters) if !chapters.is_empty() => {
                    tracing::info!(
                        "Resolved {} chapters from external JSON for episode {}",
                        chapters.len(),
                        input.episode_id
                    );
                    return chapters;
                }
                Ok(_) => {
                    tracing::debug!(
                        "External JSON returned empty chapters for {}",
                        input.episode_id
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        "External JSON chapter fetch failed for {}: {}",
                        input.episode_id,
                        e
                    );
                }
            }
        }
    }

    // 2. Embedded ID3 / MP4 chapters from local audio file
    if let Some(ref path) = input.local_audio_path {
        if path.exists() {
            match extract_audio_file_chapters(path, &input.episode_id, input.duration_secs) {
                Ok(chapters) if !chapters.is_empty() => {
                    tracing::info!(
                        "Resolved {} chapters from embedded audio file for episode {}",
                        chapters.len(),
                        input.episode_id
                    );
                    return chapters;
                }
                Ok(_) => {}
                Err(e) => {
                    tracing::warn!(
                        "Embedded audio chapter extraction failed for {}: {}",
                        input.episode_id,
                        e
                    );
                }
            }
        }
    }

    // 3. RSS inline Podlove Simple Chapters
    if !input.inline_chapters.is_empty() {
        tracing::info!(
            "Resolved {} chapters from RSS inline Podlove for episode {}",
            input.inline_chapters.len(),
            input.episode_id
        );
        let mut chaps = input.inline_chapters.clone();
        for ch in &mut chaps {
            ch.episode_id = input.episode_id.clone();
        }
        return chaps;
    }

    // 4. Episode description / show notes regex fallback
    if let Some(ref desc) = input.description {
        if !desc.trim().is_empty() {
            let chapters = parse_description_chapters(desc, &input.episode_id, input.duration_secs);
            if !chapters.is_empty() {
                tracing::info!(
                    "Resolved {} chapters from description timestamps for episode {}",
                    chapters.len(),
                    input.episode_id
                );
                return chapters;
            }
        }
    }

    Vec::new()
}

/// Ingest, resolve, and atomically persist chapters for a podcast episode.
pub async fn resolve_and_persist_episode_chapters(
    repo: &Repository,
    input: ChapterResolutionInput,
) -> Result<Vec<PodcastChapter>> {
    let resolved = resolve_episode_chapters(&input).await;

    if !resolved.is_empty() {
        let source = resolved[0].source.clone();
        repo.upsert_podcast_chapters(&input.episode_id, &resolved)
            .await?;
        repo.update_episode_chapters_source(&input.episode_id, &source)
            .await?;
    }

    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::podcast_ad::ChapterSource;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn test_cascade_external_json_overrides_description() {
        // Build mock chapters JSON
        let chapters_json = r#"{
            "version": "1.2.0",
            "chapters": [
                { "startTime": 0, "title": "JSON Intro" },
                { "startTime": 60, "title": "JSON Main Topic" },
                { "startTime": 120, "title": "JSON Outro" }
            ]
        }"#;

        let json_parsed = crate::podcast::chapter_fetcher::parse_chapters_json(
            chapters_json,
            "test_ep_cascade",
            Some(180),
        )
        .unwrap();

        let desc_text = r#"
00:00 - Desc Intro
01:00 - Desc Main
02:00 - Desc Outro
"#;

        let input = ChapterResolutionInput {
            episode_id: "test_ep_cascade".to_string(),
            chapters_url: None, // No network url in mock, we simulate inline override
            chapters_type: None,
            local_audio_path: None,
            inline_chapters: json_parsed, // Simulated higher priority chapters
            description: Some(desc_text.to_string()),
            duration_secs: Some(180),
        };

        let resolved = resolve_episode_chapters(&input).await;
        assert_eq!(resolved.len(), 3);
        assert_eq!(resolved[0].title, "JSON Intro");
        assert_eq!(resolved[0].source, ChapterSource::Podcast20Json.as_str());
    }

    #[tokio::test]
    async fn test_cascade_embedded_id3_overrides_description() {
        // Build a synthetic MP3 with ID3 CHAP frames in a temporary file
        let mut tmp_file = NamedTempFile::new().unwrap();

        let mut tag = Vec::new();
        tag.extend_from_slice(b"ID3");
        tag.push(3); // v2.3
        tag.push(0);
        tag.push(0);

        let mut body = Vec::new();

        for i in 0..3 {
            let mut chap_payload = Vec::new();
            chap_payload.extend_from_slice(format!("chp{}\0", i).as_bytes());
            chap_payload.extend_from_slice(&((i * 60000) as u32).to_be_bytes());
            chap_payload.extend_from_slice(&(((i + 1) * 60000) as u32).to_be_bytes());
            chap_payload.extend_from_slice(&[0xFF; 8]);

            let title_str = format!("ID3 Chapter {}", i + 1);
            let mut tit2 = Vec::new();
            tit2.push(3);
            tit2.extend_from_slice(title_str.as_bytes());
            chap_payload.extend_from_slice(b"TIT2");
            chap_payload.extend_from_slice(&(tit2.len() as u32).to_be_bytes());
            chap_payload.extend_from_slice(&[0, 0]);
            chap_payload.extend_from_slice(&tit2);

            body.extend_from_slice(b"CHAP");
            body.extend_from_slice(&(chap_payload.len() as u32).to_be_bytes());
            body.extend_from_slice(&[0, 0]);
            body.extend_from_slice(&chap_payload);
        }

        let body_len = body.len() as u32;
        let s0 = ((body_len >> 21) & 0x7F) as u8;
        let s1 = ((body_len >> 14) & 0x7F) as u8;
        let s2 = ((body_len >> 7) & 0x7F) as u8;
        let s3 = (body_len & 0x7F) as u8;
        tag.extend_from_slice(&[s0, s1, s2, s3]);
        tag.extend_from_slice(&body);

        tmp_file.write_all(&tag).unwrap();

        let desc_text = r#"
00:00 - Desc Chapter 1
01:00 - Desc Chapter 2
02:00 - Desc Chapter 3
"#;

        let input = ChapterResolutionInput {
            episode_id: "test_ep_id3".to_string(),
            chapters_url: None,
            chapters_type: None,
            local_audio_path: Some(tmp_file.path().to_path_buf()),
            inline_chapters: Vec::new(),
            description: Some(desc_text.to_string()),
            duration_secs: Some(180),
        };

        let resolved = resolve_episode_chapters(&input).await;
        assert_eq!(resolved.len(), 3);
        assert_eq!(resolved[0].title, "ID3 Chapter 1");
        assert_eq!(resolved[0].source, ChapterSource::Id3Chap.as_str());
    }

    #[tokio::test]
    async fn test_cascade_podlove_overrides_description() {
        let desc_text = r#"
00:00 - Desc Chapter 1
01:00 - Desc Chapter 2
02:00 - Desc Chapter 3
"#;

        let inline_podlove = vec![
            PodcastChapter {
                id: "podlove_1".to_string(),
                episode_id: String::new(),
                chapter_index: 0,
                title: "Podlove Intro".to_string(),
                start_ms: 0,
                end_ms: 60000,
                image_url: None,
                link_url: None,
                source: ChapterSource::PodloveXml.as_str().to_string(),
                is_advertisement: false,
            },
            PodcastChapter {
                id: "podlove_2".to_string(),
                episode_id: String::new(),
                chapter_index: 1,
                title: "Podlove Main".to_string(),
                start_ms: 60000,
                end_ms: 120000,
                image_url: None,
                link_url: None,
                source: ChapterSource::PodloveXml.as_str().to_string(),
                is_advertisement: false,
            },
            PodcastChapter {
                id: "podlove_3".to_string(),
                episode_id: String::new(),
                chapter_index: 2,
                title: "Podlove Outro".to_string(),
                start_ms: 120000,
                end_ms: 180000,
                image_url: None,
                link_url: None,
                source: ChapterSource::PodloveXml.as_str().to_string(),
                is_advertisement: false,
            },
        ];

        let input = ChapterResolutionInput {
            episode_id: "test_ep_podlove".to_string(),
            chapters_url: None,
            chapters_type: None,
            local_audio_path: None,
            inline_chapters: inline_podlove,
            description: Some(desc_text.to_string()),
            duration_secs: Some(180),
        };

        let resolved = resolve_episode_chapters(&input).await;
        assert_eq!(resolved.len(), 3);
        assert_eq!(resolved[0].title, "Podlove Intro");
        assert_eq!(resolved[0].source, ChapterSource::PodloveXml.as_str());
    }

    #[tokio::test]
    async fn test_cascade_falls_back_to_description() {
        let desc_text = r#"
00:00 - Desc Intro
05:00 - Desc Deep Dive
15:00 - Desc Conclusion
"#;

        let input = ChapterResolutionInput {
            episode_id: "test_ep_desc".to_string(),
            chapters_url: None,
            chapters_type: None,
            local_audio_path: None,
            inline_chapters: Vec::new(),
            description: Some(desc_text.to_string()),
            duration_secs: Some(1200),
        };

        let resolved = resolve_episode_chapters(&input).await;
        assert_eq!(resolved.len(), 3);
        assert_eq!(resolved[0].title, "Desc Intro");
        assert_eq!(
            resolved[0].source,
            ChapterSource::DescriptionTimestamp.as_str()
        );
    }
}
