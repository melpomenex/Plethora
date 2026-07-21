use crate::database::Repository;
use crate::youtube::TranscriptSegment;
use lazy_static::lazy_static;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::State;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "status")]
pub enum OnDeviceTranscriptResult {
    #[serde(rename = "ok")]
    Ok {
        segments: Vec<TranscriptSegment>,
        language: String,
    },
    #[serde(rename = "err")]
    Err { kind: String, detail: String },
}

#[derive(Debug, Clone)]
struct ClientContext {
    name: &'static str,
    client_name: &'static str,
    client_version: &'static str,
    user_agent: &'static str,
}

const CLIENT_CONTEXTS: &[ClientContext] = &[
    ClientContext {
        name: "WEB_EMBEDDED_PLAYER",
        client_name: "WEB_EMBEDDED_PLAYER",
        client_version: "1.20240313.01.00",
        user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    ClientContext {
        name: "ANDROID",
        client_name: "ANDROID",
        client_version: "19.09.37",
        user_agent: "com.google.android.youtube/19.09.37 (Linux; U; Android 12; en_US; Pixel 6 Build/SD1A.210817.036)",
    },
    ClientContext {
        name: "TVHTML5",
        client_name: "TVHTML5",
        client_version: "7.20230622.01.00",
        user_agent: "Mozilla/5.0 (ChromiumStylePlatform; Large Screen) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
];

const FALLBACK_API_KEY: &str = "AIzaSyAO_FJ2y1cc5J-WJ5J1cc5J-WJ5J1cc5J";

lazy_static! {
    static ref API_KEY_REGEX: regex::Regex =
        regex::Regex::new(r#""INNERTUBE_API_KEY"\s*:\s*"([^"]+)""#).unwrap();
}

pub use crate::youtube::captions::{decode_html_entities, strip_tags};

#[derive(Debug, Deserialize, Clone)]
struct CaptionTrack {
    #[serde(rename = "baseUrl")]
    base_url: String,
    #[serde(rename = "languageCode")]
    language_code: String,
    kind: Option<String>,
}

async fn fetch_innertube_key(client: &Client, video_id: &str) -> Option<String> {
    let url = format!("https://www.youtube.com/watch?v={}", video_id);
    let response = client.get(&url)
        .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .header("Accept-Language", "en-US,en;q=0.9")
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .ok()?;
    let html = response.text().await.ok()?;

    if let Some(caps) = API_KEY_REGEX.captures(&html) {
        if let Some(m) = caps.get(1) {
            return Some(m.as_str().to_string());
        }
    }
    None
}

fn select_caption_track(
    tracks: &[CaptionTrack],
    requested_lang: Option<&str>,
) -> Option<CaptionTrack> {
    if tracks.is_empty() {
        return None;
    }

    let default_lang = requested_lang.unwrap_or("en");

    // 1. Exact match (prefer manual over auto-generated)
    let exact_match = tracks
        .iter()
        .filter(|t| t.language_code == default_lang)
        .min_by_key(|t| t.kind.as_deref() == Some("asr"));
    if let Some(track) = exact_match {
        return Some(track.clone());
    }

    // 2. Prefix match on primary subtag (e.g. "en" matches "en-US")
    let prefix_lang = default_lang.split('-').next().unwrap_or(default_lang);
    let prefix_match = tracks
        .iter()
        .filter(|t| {
            t.language_code
                .split('-')
                .next()
                .unwrap_or(&t.language_code)
                == prefix_lang
        })
        .min_by_key(|t| t.kind.as_deref() == Some("asr"));
    if let Some(track) = prefix_match {
        return Some(track.clone());
    }

    // 3. Fallback to the first available track
    Some(tracks[0].clone())
}

async fn attempt_fetch(
    client: &Client,
    video_id: &str,
    api_key: &str,
    ctx: &ClientContext,
    language: Option<&str>,
) -> Result<(Vec<TranscriptSegment>, String), (String, String)> {
    let url = format!("https://www.youtube.com/youtubei/v1/player?key={}", api_key);

    let mut client_payload = serde_json::json!({
        "clientName": ctx.client_name,
        "clientVersion": ctx.client_version,
        "hl": "en",
        "gl": "US",
        "utcOffsetMinutes": 0,
    });

    if ctx.client_name == "ANDROID" {
        client_payload["androidSdkVersion"] = serde_json::json!(30);
    }

    let mut payload = serde_json::json!({
        "videoId": video_id,
        "context": {
            "client": client_payload
        }
    });

    if ctx.client_name == "WEB_EMBEDDED_PLAYER" {
        payload["context"]["thirdParty"] = serde_json::json!({
            "embedUrl": format!("https://www.youtube.com/embed/{}", video_id)
        });
    }

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", ctx.user_agent)
        .json(&payload)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| ("Network".to_string(), e.to_string()))?;

    let status_code = response.status();
    if status_code == 429 {
        return Err((
            "RateLimited".to_string(),
            "YouTube returned 429 Rate Limited".to_string(),
        ));
    }
    if !status_code.is_success() {
        return Err((
            "Network".to_string(),
            format!("YouTube API returned status code {}", status_code),
        ));
    }

    let body = response
        .text()
        .await
        .map_err(|e| ("Network".to_string(), e.to_string()))?;
    let player_json: serde_json::Value = serde_json::from_str(&body).map_err(|e| {
        (
            "Unknown".to_string(),
            format!("Failed to parse player JSON: {}", e),
        )
    })?;

    let playability = player_json.get("playabilityStatus");
    let status = playability
        .and_then(|p| p.get("status").and_then(|s| s.as_str()))
        .unwrap_or("OK");
    let reason = playability
        .and_then(|p| p.get("reason").and_then(|r| r.as_str()))
        .unwrap_or("");

    if status != "OK" {
        if status == "LOGIN_REQUIRED" {
            let reason_lower = reason.to_lowercase();
            if reason_lower.contains("age") || reason_lower.contains("restricted") {
                return Err(("AgeRestricted".to_string(), reason.to_string()));
            } else if reason_lower.contains("bot") || reason_lower.contains("confirm you") {
                return Err(("PoTokenRequired".to_string(), reason.to_string()));
            } else {
                return Err(("SignInRequired".to_string(), reason.to_string()));
            }
        } else if status == "UNPLAYABLE" || status == "ERROR" {
            return Err(("VideoUnavailable".to_string(), reason.to_string()));
        } else {
            return Err((
                "Unknown".to_string(),
                format!("Playability status: {}, reason: {}", status, reason),
            ));
        }
    }

    let tracks_json = player_json
        .get("captions")
        .and_then(|c| c.get("playerCaptionsTracklistRenderer"))
        .and_then(|p| p.get("captionTracks"));

    let tracks: Vec<CaptionTrack> = match tracks_json {
        Some(t) => serde_json::from_value(t.clone()).map_err(|e| {
            (
                "Unknown".to_string(),
                format!("Failed to parse caption tracks: {}", e),
            )
        })?,
        None => {
            return Err((
                "NoCaptions".to_string(),
                "No caption tracks in player response".to_string(),
            ))
        }
    };

    if tracks.is_empty() {
        return Err((
            "NoCaptions".to_string(),
            "No caption tracks available".to_string(),
        ));
    }

    let selected_track = select_caption_track(&tracks, language).ok_or_else(|| {
        (
            "NoCaptions".to_string(),
            "Failed to select caption track".to_string(),
        )
    })?;

    let caption_url = selected_track.base_url;
    let gating_marker = caption_url.contains("signature=") || !caption_url.contains("&sig=");
    if gating_marker {
        return Err((
            "PoTokenRequired".to_string(),
            "Caption track URL is signature-gated".to_string(),
        ));
    }

    let format_url = format!("{}&fmt=json3", caption_url);

    let caption_res = client
        .get(&format_url)
        .header("User-Agent", ctx.user_agent)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| ("Network".to_string(), e.to_string()))?;

    let caption_status = caption_res.status();
    if caption_status == 403 {
        return Err((
            "PoTokenRequired".to_string(),
            "Caption track download forbidden (403)".to_string(),
        ));
    }
    if !caption_status.is_success() {
        return Err((
            "Network".to_string(),
            format!("Caption track fetch returned status {}", caption_status),
        ));
    }

    let caption_body = caption_res
        .text()
        .await
        .map_err(|e| ("Network".to_string(), e.to_string()))?;
    if caption_body.trim().is_empty() {
        return Err((
            "PoTokenRequired".to_string(),
            "Caption track response is empty".to_string(),
        ));
    }

    let segments: Vec<TranscriptSegment> =
        crate::youtube::captions::parse_json3_captions(&caption_body);
    if segments.is_empty() {
        return Err((
            "NoCaptions".to_string(),
            "json3 body contained no cues".to_string(),
        ));
    }

    Ok((segments, selected_track.language_code))
}

pub async fn fetch_youtube_transcript_on_device_internal(
    video_id: &str,
    language: Option<&str>,
) -> OnDeviceTranscriptResult {
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap_or_else(|_| Client::new());

    // 1. Try to extract API key dynamically
    let api_key = match fetch_innertube_key(&client, video_id).await {
        Some(k) => k,
        None => FALLBACK_API_KEY.to_string(),
    };

    let mut last_err = ("Unknown".to_string(), "No contexts tried".to_string());

    // 2. Loop through clients
    for ctx in CLIENT_CONTEXTS {
        match attempt_fetch(&client, video_id, &api_key, ctx, language).await {
            Ok((segments, lang)) => {
                return OnDeviceTranscriptResult::Ok {
                    segments,
                    language: lang,
                };
            }
            Err((kind, detail)) => {
                // If outcome is terminal (no captions), return early.
                // VideoUnavailable might be client-specific, so let other clients try.
                if kind == "NoCaptions" {
                    return OnDeviceTranscriptResult::Err { kind, detail };
                }
                last_err = (kind, detail);
            }
        }
    }

    OnDeviceTranscriptResult::Err {
        kind: last_err.0,
        detail: last_err.1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_html_entities() {
        assert_eq!(
            decode_html_entities("&amp; &lt; &gt; &quot; &#39; &apos;"),
            "& < > \" ' '"
        );
    }

    #[test]
    fn test_strip_tags() {
        assert_eq!(
            strip_tags("<font color=\"#ffffff\">hello</font> <b>world</b>"),
            "hello world"
        );
    }

    #[test]
    fn test_select_caption_track() {
        let tracks = vec![
            CaptionTrack {
                base_url: "url1".to_string(),
                language_code: "en".to_string(),
                kind: Some("asr".to_string()),
            },
            CaptionTrack {
                base_url: "url2".to_string(),
                language_code: "en".to_string(),
                kind: None,
            },
            CaptionTrack {
                base_url: "url3".to_string(),
                language_code: "fr".to_string(),
                kind: None,
            },
        ];

        // Should select exact match, preferring manual over ASR
        let selected = select_caption_track(&tracks, Some("en")).unwrap();
        assert_eq!(selected.base_url, "url2");

        // Should fallback to prefix matching
        let selected_prefix = select_caption_track(&tracks, Some("en-US")).unwrap();
        assert_eq!(selected_prefix.base_url, "url2");

        // Should fallback to first if none matches
        let selected_fallback = select_caption_track(&tracks, Some("de")).unwrap();
        assert_eq!(selected_fallback.base_url, "url1");
    }
}
