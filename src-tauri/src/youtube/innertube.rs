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
    /// Value for the `X-YouTube-Client-Name` header. "" omits the header.
    client_id: &'static str,
    /// Device descriptors. "" omits the field; some clients are rejected without them.
    device_make: &'static str,
    device_model: &'static str,
    os_name: &'static str,
    os_version: &'static str,
    /// 0 omits `androidSdkVersion`.
    android_sdk_version: u32,
}

/// Ordered client contexts, most-likely-to-work first.
///
/// Verified against live YouTube on 2026-07-21 (see the change's design.md): ANDROID_VR is
/// the only context that still returns fetchable caption tracks. ANDROID now returns HTTP
/// 400 FAILED_PRECONDITION (it requires attestation), and WEB_EMBEDDED_PLAYER / TVHTML5
/// return a playability error with zero caption tracks. The dead contexts are retained as
/// fallbacks — they cost one request each only when the primary fails — but the list must
/// stay ordered, and ANDROID_VR must stay first.
const CLIENT_CONTEXTS: &[ClientContext] = &[
    ClientContext {
        name: "ANDROID_VR",
        client_name: "ANDROID_VR",
        client_version: "1.60.19",
        user_agent:
            "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; en_US; Quest 3)",
        client_id: "28",
        device_make: "Oculus",
        device_model: "Quest 3",
        os_name: "Android",
        os_version: "12",
        android_sdk_version: 32,
    },
    ClientContext {
        name: "WEB_EMBEDDED_PLAYER",
        client_name: "WEB_EMBEDDED_PLAYER",
        client_version: "1.20240313.01.00",
        user_agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        client_id: "56",
        device_make: "",
        device_model: "",
        os_name: "",
        os_version: "",
        android_sdk_version: 0,
    },
    ClientContext {
        name: "ANDROID",
        client_name: "ANDROID",
        client_version: "19.09.37",
        user_agent: "com.google.android.youtube/19.09.37 (Linux; U; Android 12; en_US; Pixel 6 Build/SD1A.210817.036)",
        client_id: "3",
        device_make: "",
        device_model: "",
        os_name: "Android",
        os_version: "12",
        android_sdk_version: 30,
    },
    ClientContext {
        name: "TVHTML5",
        client_name: "TVHTML5",
        client_version: "7.20230622.01.00",
        user_agent: "Mozilla/5.0 (ChromiumStylePlatform; Large Screen) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        client_id: "7",
        device_make: "",
        device_model: "",
        os_name: "",
        os_version: "",
        android_sdk_version: 0,
    },
];

/// Public InnerTube WEB key, used when scraping the key from the watch page fails.
/// Scraping is not reliable — YouTube returns HTTP 429 for watch-page requests from
/// flagged IPs, which is exactly the case this fallback has to cover.
const FALLBACK_API_KEY: &str = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

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

/// Fetch a `visitorData` token from InnerTube.
///
/// Without one, YouTube bot-gates most videos even for the ANDROID_VR client: measured
/// 2026-07-21, a bare ANDROID_VR request got usable caption tracks for only 1 of 6 sampled
/// videos (the rest returned `LOGIN_REQUIRED` / "Sign in to confirm you're not a bot"),
/// versus 5 of 6 once a visitor token was attached.
///
/// This uses the `visitor_id` endpoint rather than scraping a watch page, so it does not
/// inherit the watch page's HTTP 429 fragility.
async fn fetch_visitor_data(client: &Client) -> Option<String> {
    let url = format!("https://www.youtube.com/youtubei/v1/visitor_id?key={}", FALLBACK_API_KEY);
    let payload = serde_json::json!({
        "context": {
            "client": {
                "clientName": "ANDROID_VR",
                "clientVersion": "1.60.19",
                "hl": "en",
                "gl": "US",
            }
        }
    });

    let response = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", CLIENT_CONTEXTS[0].user_agent)
        .json(&payload)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .ok()?;

    let json: serde_json::Value = response.json().await.ok()?;
    json.get("responseContext")?
        .get("visitorData")?
        .as_str()
        .map(|s| s.to_string())
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

/// Force `fmt=json3` on a caption track URL.
///
/// Some clients (ANDROID_VR among them) hand back a `baseUrl` that already carries
/// `fmt=srv3`. Appending a second `fmt` is silently ignored — YouTube honours the first
/// occurrence and returns XML — so the existing parameter has to be replaced rather than
/// appended, or the json3 parser is handed a `<?xml ...>` document.
fn with_json3_format(caption_url: &str) -> String {
    let (base, query) = match caption_url.split_once('?') {
        Some((base, query)) => (base, query),
        None => return format!("{}?fmt=json3", caption_url),
    };

    let mut params: Vec<&str> = query
        .split('&')
        .filter(|part| !part.is_empty() && !part.starts_with("fmt="))
        .collect();
    params.push("fmt=json3");

    format!("{}?{}", base, params.join("&"))
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
    visitor_data: Option<&str>,
) -> Result<(Vec<TranscriptSegment>, String), (String, String)> {
    let url = format!("https://www.youtube.com/youtubei/v1/player?key={}", api_key);

    let mut client_payload = serde_json::json!({
        "clientName": ctx.client_name,
        "clientVersion": ctx.client_version,
        "hl": "en",
        "gl": "US",
        "utcOffsetMinutes": 0,
    });

    if ctx.android_sdk_version > 0 {
        client_payload["androidSdkVersion"] = serde_json::json!(ctx.android_sdk_version);
    }
    for (key, value) in [
        ("deviceMake", ctx.device_make),
        ("deviceModel", ctx.device_model),
        ("osName", ctx.os_name),
        ("osVersion", ctx.os_version),
    ] {
        if !value.is_empty() {
            client_payload[key] = serde_json::json!(value);
        }
    }

    // Without a visitor token YouTube bot-gates most videos with LOGIN_REQUIRED
    // ("Sign in to confirm you're not a bot"), even for ANDROID_VR.
    if let Some(visitor) = visitor_data {
        client_payload["visitorData"] = serde_json::json!(visitor);
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

    let mut request = client
        .post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", ctx.user_agent);
    if !ctx.client_id.is_empty() {
        request = request
            .header("X-YouTube-Client-Name", ctx.client_id)
            .header("X-YouTube-Client-Version", ctx.client_version);
    }
    if let Some(visitor) = visitor_data {
        request = request.header("X-Goog-Visitor-Id", visitor);
    }

    let response = request
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

    // No gating check on the URL itself: there is no reliable URL-shape marker. `signature=`
    // is a standard param on every modern timedtext URL and `&sig=` is a dead legacy one, so
    // the old `contains("signature=") || !contains("&sig=")` test was true for *fetchable*
    // tracks and rejected essentially every video. Real gating surfaces as a 403 or an empty
    // HTTP 200 body, both handled after the fetch below.
    let format_url = with_json3_format(&selected_track.base_url);

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

    // 1b. Get a visitor token. Most videos are bot-gated without one.
    let visitor_data = fetch_visitor_data(&client).await;
    if visitor_data.is_none() {
        log::warn!("[innertube] no visitorData; most videos will be bot-gated");
    }

    let mut last_err = ("Unknown".to_string(), "No contexts tried".to_string());

    // 2. Loop through clients
    for (index, ctx) in CLIENT_CONTEXTS.iter().enumerate() {
        match attempt_fetch(
            &client,
            video_id,
            &api_key,
            ctx,
            language,
            visitor_data.as_deref(),
        )
        .await
        {
            Ok((segments, lang)) => {
                return OnDeviceTranscriptResult::Ok {
                    segments,
                    language: lang,
                };
            }
            Err((kind, detail)) => {
                // "NoCaptions" is only authoritative from the primary context. The fallback
                // contexts are known-degraded (they answer with a playability error and an
                // empty caption list for videos that *do* have captions), so believing them
                // would report "no captions" for a perfectly captioned video.
                // VideoUnavailable is likewise client-specific, so let other clients try.
                if kind == "NoCaptions" && index == 0 {
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

    /// Real player response captured from the ANDROID_VR client on 2026-07-21.
    const PLAYER_OK: &str = include_str!("fixtures/player_ok_android_vr.json");
    /// Real json3 caption body for the same video, per-word timings included.
    const CAPTIONS_JSON3: &str = include_str!("fixtures/captions_json3_ok.json");

    fn fixture_tracks() -> Vec<CaptionTrack> {
        let player: serde_json::Value = serde_json::from_str(PLAYER_OK).unwrap();
        serde_json::from_value(
            player["captions"]["playerCaptionsTracklistRenderer"]["captionTracks"].clone(),
        )
        .unwrap()
    }

    #[test]
    fn parses_caption_tracks_from_a_real_player_response() {
        let player: serde_json::Value = serde_json::from_str(PLAYER_OK).unwrap();
        assert_eq!(player["playabilityStatus"]["status"], "OK");

        let tracks = fixture_tracks();
        assert_eq!(tracks.len(), 6);

        // Both a manual and an ASR English track are present; manual must win.
        let selected = select_caption_track(&tracks, Some("en")).unwrap();
        assert_eq!(selected.language_code, "en");
        assert_eq!(selected.kind, None);
    }

    #[test]
    fn real_caption_urls_are_not_treated_as_gated() {
        // Regression guard for the removed `gating_marker` check. Every one of these URLs
        // was verified fetchable, yet each carries `signature=` and lacks `&sig=` — the two
        // conditions the old check rejected on. If a URL-shape gate is ever reintroduced, it
        // must not fire here.
        for track in fixture_tracks() {
            assert!(
                track.base_url.contains("signature="),
                "fixture should carry the standard signature param"
            );
            assert!(
                !track.base_url.contains("&sig="),
                "fixture should not carry the legacy sig param"
            );
        }
    }

    #[test]
    fn json3_format_replaces_an_existing_fmt_param() {
        // ANDROID_VR hands back `fmt=srv3` already set; appending would leave XML in play.
        let srv3 = "https://www.youtube.com/api/timedtext?v=abc&fmt=srv3&lang=en";
        let out = with_json3_format(srv3);
        assert!(out.contains("fmt=json3"), "{out}");
        assert!(!out.contains("fmt=srv3"), "{out}");
        assert_eq!(out.matches("fmt=").count(), 1, "{out}");
        assert!(out.contains("v=abc") && out.contains("lang=en"), "{out}");
    }

    #[test]
    fn json3_format_handles_urls_without_an_fmt_param() {
        let plain = "https://www.youtube.com/api/timedtext?v=abc&lang=en";
        let out = with_json3_format(plain);
        assert_eq!(out.matches("fmt=").count(), 1, "{out}");
        assert!(out.ends_with("fmt=json3"), "{out}");

        let no_query = "https://www.youtube.com/api/timedtext";
        assert_eq!(
            with_json3_format(no_query),
            "https://www.youtube.com/api/timedtext?fmt=json3"
        );
    }

    #[test]
    fn json3_format_is_applied_to_every_real_fixture_url() {
        for track in fixture_tracks() {
            let out = with_json3_format(&track.base_url);
            assert_eq!(
                out.matches("fmt=").count(),
                1,
                "exactly one fmt param expected: {out}"
            );
            assert!(out.contains("fmt=json3"), "{out}");
        }
    }

    #[test]
    fn parses_a_real_json3_caption_body_with_word_timings() {
        let segments = crate::youtube::captions::parse_json3_captions(CAPTIONS_JSON3);
        assert!(!segments.is_empty(), "real json3 body should yield cues");

        // The karaoke-sync feature depends on per-word offsets surviving the parse.
        assert!(
            segments.iter().any(|s| s
                .words
                .as_ref()
                .map(|w| !w.is_empty())
                .unwrap_or(false)),
            "expected per-word timings from the ASR track"
        );
    }

    #[test]
    fn empty_or_non_json_caption_bodies_yield_no_cues() {
        // The fetch path maps an empty body to PoTokenRequired before parsing; this guards
        // the parser itself against reporting phantom success on junk input.
        assert!(crate::youtube::captions::parse_json3_captions("").is_empty());
        assert!(crate::youtube::captions::parse_json3_captions(
            "<?xml version=\"1.0\"?><timedtext format=\"3\"></timedtext>"
        )
        .is_empty());
    }

    #[test]
    fn android_vr_is_the_primary_client_context() {
        // Ordering is load-bearing: the other contexts return zero caption tracks, and
        // NoCaptions is only treated as authoritative when it comes from index 0.
        assert_eq!(CLIENT_CONTEXTS[0].name, "ANDROID_VR");
        assert_eq!(CLIENT_CONTEXTS[0].client_id, "28");
    }

    /// End-to-end check against live YouTube. Ignored by default — it needs network and is
    /// subject to YouTube rate limiting. Run explicitly when validating a client-context
    /// change: `cargo test --lib live_on_device_fetch -- --ignored --nocapture`
    #[tokio::test]
    #[ignore]
    async fn live_on_device_fetch_returns_real_segments() {
        // A spread of videos, not a single control: a bare ANDROID_VR request happens to
        // work for dQw4w9WgXcQ but is bot-gated for most others, so testing only that one
        // would report success for a fetcher that fails on the videos users actually have.
        let videos = [
            ("MrEP6_l8DpY", "Sapolsky - the reported failure"),
            ("dQw4w9WgXcQ", "control"),
            ("jNQXAC9IVRw", "me at the zoo"),
            ("9bZkp7q19f0", "Gangnam Style"),
            ("kJQP7kiw5Fk", "Despacito"),
        ];

        let mut failures = Vec::new();
        for (video_id, label) in videos {
            match fetch_youtube_transcript_on_device_internal(video_id, Some("en")).await {
                OnDeviceTranscriptResult::Ok { segments, language } => {
                    println!(
                        "  OK   {label:32} {} segments, lang={language}, first={:?}",
                        segments.len(),
                        segments.first().map(|s| s.text.chars().take(40).collect::<String>())
                    );
                    assert!(!segments.is_empty());
                }
                OnDeviceTranscriptResult::Err { kind, detail } => {
                    println!("  FAIL {label:32} {kind} - {detail}");
                    failures.push(format!("{label}: {kind}"));
                }
            }
        }

        assert!(
            failures.is_empty(),
            "on-device fetch failed for: {failures:?}"
        );
    }

    #[test]
    fn fallback_api_key_is_well_formed() {
        // The previous constant was a corrupted copy with a repeating tail.
        assert!(FALLBACK_API_KEY.starts_with("AIza"));
        assert_eq!(FALLBACK_API_KEY.len(), 39);
        assert!(!FALLBACK_API_KEY.contains("5J-WJ5J1cc5J"));
    }
}
