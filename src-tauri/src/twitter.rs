//! Twitter / X video and thread import.
//!
//! Ports the media-extraction logic from the project's `xcom.py` reference:
//! X's web-client bearer token + anonymous guest-token auth against the
//! GraphQL `TweetResultByRestId` endpoint, with syndication fallback
//! (`https://cdn.syndication.twimg.com/tweet-result?id=...`).
//!
//! Provides two major workflows:
//! 1. Video import (`get_twitter_video_info`, `import_twitter_video`): Downloads MP4 into `videos/`
//! 2. Thread analysis (`get_twitter_thread`, `import_twitter_thread`): Parses author posts, NoteTweets,
//!    media, quoted tweets, and generates structured text + styled HTML for reading & AI learning.

use std::collections::HashSet;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use tauri::State;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

use crate::database::Repository;
use crate::models::{Document, DocumentMetadata, FileType};

// ── constants ─────────────────────────────────────────────────────────────

const API_BASE: &str = "https://api.x.com";

/// X's hardcoded public web-client bearer token (URL-encoded `=` as `%3D`).
const BEARER: &str = "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";

const UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36";

/// GraphQL query id for `TweetResultByRestId`.
const QID_TWEET_RESULT: &str = "sBoAB5nqJTOyR9sZ5qVLsw";

/// Extended feature-flag set for tweet-detail requests.
const TWEET_FEATURES: &str = r#"{"rweb_video_screen_enabled":false,"profile_label_improvements_pcf_label_in_post_enabled":false,"rweb_tipjar_consumption_enabled":true,"responsive_web_graphql_exclude_directive_enabled":true,"verified_phone_label_enabled":false,"freedom_of_speech_not_reach_fetch_enabled":true,"standardized_nudges_misinfo":true,"tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled":false,"responsive_web_graphql_skip_user_profile_image_extensions_enabled":false,"responsive_web_graphql_timeline_navigation_enabled":false,"creator_subscriptions_tweet_preview_api_enabled":true,"responsive_web_graphql_timeline_navigation":true,"premium_content_api_read_enabled":true,"communities_web_enable_tweet_community_results_fetch":true,"c9s_tweet_anatomy_moderator_badge_enabled":true,"responsive_web_grok_analyze_button_fetch_trends_enabled":true,"responsive_web_edit_tweet_api_enabled":true,"graphql_is_translatable_rweb_tweet_is_translatable_enabled":true,"view_counts_everywhere_api_enabled":true,"longform_notetweets_consumption_enabled":true,"responsive_web_twitter_article_tweet_consumption_enabled":true}"#;

/// Guest-token lifetime (2-hour cache).
const GUEST_TOKEN_TTL: Duration = Duration::from_secs(7200);

// ── shared client + cached guest token ────────────────────────────────────

static HTTP: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .expect("failed to build reqwest client")
});

/// Cached guest token + the instant it was obtained.
static GUEST_TOKEN: Lazy<Mutex<Option<(String, Instant)>>> = Lazy::new(|| Mutex::new(None));

// ── types ─────────────────────────────────────────────────────────────────

/// Metadata for a tweet that contains a video, returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TwitterVideoInfo {
    pub tweet_id: String,
    pub status_url: String,
    pub title: String,
    pub author: String,
    pub thumbnail_url: Option<String>,
    pub duration_secs: Option<i64>,
    pub mp4_url: String,
}

/// Author details on X/Twitter.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TwitterAuthor {
    pub name: String,
    pub screen_name: String,
    pub avatar_url: Option<String>,
    pub verified: bool,
    pub profile_url: String,
}

/// Attached photo, video, or animated GIF in an X post.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TwitterMedia {
    pub kind: String, // "photo", "video", "animated_gif"
    pub media_url: String,
    pub thumbnail_url: Option<String>,
    pub alt_text: Option<String>,
    pub aspect_ratio: Option<f64>,
}

/// Quoted post nested inside a main post.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TwitterQuotedPost {
    pub id: String,
    pub author: TwitterAuthor,
    pub text: String,
    pub media: Vec<TwitterMedia>,
    pub created_at: Option<String>,
    pub url: String,
}

/// Single post within an X thread.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TwitterPost {
    pub id: String,
    pub post_index: usize,
    pub author: TwitterAuthor,
    pub text: String,
    pub full_text: String,
    pub media: Vec<TwitterMedia>,
    pub quoted_post: Option<TwitterQuotedPost>,
    pub created_at: Option<String>,
    pub reply_count: Option<i64>,
    pub retweet_count: Option<i64>,
    pub favorite_count: Option<i64>,
    pub bookmark_count: Option<i64>,
    pub is_note_tweet: bool,
    pub url: String,
}

/// Normalized multi-post or single-post X thread.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TwitterThread {
    pub id: String,
    pub root_id: String,
    pub root_url: String,
    pub author: TwitterAuthor,
    pub title: String,
    pub posts: Vec<TwitterPost>,
    pub total_posts: usize,
    pub html_content: String,
    pub structured_text: String,
    pub created_at: Option<String>,
}

// ── helpers ───────────────────────────────────────────────────────────────

/// Extract the numeric tweet id from an `x.com`/`twitter.com` status URL
/// (e.g. `https://x.com/user/status/123?s=20` → `123`).
pub fn extract_tweet_id(input: &str) -> Result<String, String> {
    let trimmed = input.trim();
    let no_query = trimmed.split('?').next().unwrap_or(trimmed);
    let parts: Vec<&str> = no_query.trim_end_matches('/').split('/').collect();
    let idx = parts.iter().position(|p| p.eq_ignore_ascii_case("status"));
    let id = idx
        .and_then(|i| parts.get(i + 1))
        .ok_or_else(|| "Could not find a tweet id in the URL".to_string())?;
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("Invalid tweet id: {}", id));
    }
    Ok((*id).to_string())
}

/// Obtain (and cache) an anonymous guest token.
async fn ensure_guest_token() -> Result<String, String> {
    {
        let guard = GUEST_TOKEN.lock().await;
        if let Some((token, obtained)) = guard.as_ref() {
            if obtained.elapsed() < GUEST_TOKEN_TTL {
                return Ok(token.clone());
            }
        }
    }

    let resp = HTTP
        .post(format!("{}/1.1/guest/activate.json", API_BASE))
        .header("authorization", BEARER)
        .header("user-agent", UA)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .send()
        .await
        .map_err(|e| format!("Failed to request guest token: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!(
            "Guest token request failed: HTTP {}",
            resp.status()
        ));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse guest token response: {}", e))?;

    let token = json
        .get("guest_token")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "No guest_token in response".to_string())?
        .to_string();

    let mut guard = GUEST_TOKEN.lock().await;
    *guard = Some((token.clone(), Instant::now()));
    Ok(token)
}

/// Fetch a tweet result from X GraphQL endpoint.
async fn fetch_tweet_graphql(tweet_id: &str) -> Result<serde_json::Value, String> {
    let guest_token = ensure_guest_token().await?;

    let variables = serde_json::json!({
        "tweetId": tweet_id,
        "withCommunity": false,
        "includePromotedContent": false,
        "withVoice": false,
    })
    .to_string();

    let url = format!(
        "{}/graphql/{}/TweetResultByRestId",
        API_BASE, QID_TWEET_RESULT
    );

    let resp = HTTP
        .get(&url)
        .header("authorization", BEARER)
        .header("user-agent", UA)
        .header("x-twitter-active-user", "yes")
        .header("x-twitter-client-language", "en")
        .header("x-guest-token", &guest_token)
        .query(&[
            ("variables", variables.as_str()),
            ("features", TWEET_FEATURES),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to fetch tweet from GraphQL: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("GraphQL request failed: HTTP {} — {}", status, body));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse GraphQL response: {}", e))?;

    // data.tweetResult.result
    json.get("data")
        .and_then(|d| d.get("tweetResult"))
        .and_then(|tr| tr.get("result"))
        .cloned()
        .ok_or_else(|| "Tweet not found or restricted in GraphQL".to_string())
}

/// Fetch a tweet from syndication fallback endpoint.
async fn fetch_tweet_syndication(tweet_id: &str) -> Result<serde_json::Value, String> {
    let url = format!(
        "https://cdn.syndication.twimg.com/tweet-result?id={}&token=1",
        tweet_id
    );

    let resp = HTTP
        .get(&url)
        .header("user-agent", UA)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch tweet from syndication: {}", e))?;

    let status = resp.status();
    if !status.is_success() {
        return Err(format!("Syndication request failed: HTTP {}", status));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse syndication response: {}", e))?;

    Ok(json)
}

/// Fetch tweet payload, trying GraphQL first and syndication as fallback.
async fn fetch_tweet_result(tweet_id: &str) -> Result<serde_json::Value, String> {
    match fetch_tweet_graphql(tweet_id).await {
        Ok(res) => Ok(res),
        Err(gql_err) => {
            tracing::warn!(
                "GraphQL tweet fetch failed for id {}, falling back to syndication: {}",
                tweet_id,
                gql_err
            );
            fetch_tweet_syndication(tweet_id).await.map_err(|syn_err| {
                format!(
                    "Failed to fetch tweet via GraphQL ({}) and Syndication ({})",
                    gql_err, syn_err
                )
            })
        }
    }
}

/// Build canonical status URL.
pub fn build_status_url(screen_name: &str, tweet_id: &str) -> String {
    format!("https://x.com/{}/status/{}", screen_name, tweet_id)
}

/// Build profile URL.
pub fn build_profile_url(screen_name: &str) -> String {
    format!("https://x.com/{}", screen_name)
}

/// Strip t.co link wrappers and collapse whitespace.
pub fn normalize_text(text: &str) -> String {
    text.trim()
        .split('\n')
        .map(|l| l.trim())
        .filter(|l| !l.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

// ── parsing ───────────────────────────────────────────────────────────────

/// Unwrap visibility results wrapper if present.
fn unwrap_result(val: &serde_json::Value) -> &serde_json::Value {
    if val.get("__typename").and_then(|v| v.as_str()) == Some("TweetWithVisibilityResults") {
        val.get("tweet").unwrap_or(val)
    } else {
        val
    }
}

/// Parse author info from GraphQL or Syndication JSON.
pub fn parse_author(val: &serde_json::Value) -> TwitterAuthor {
    let val = unwrap_result(val);

    // Try GraphQL shape first: core.user_results.result
    if let Some(user_res) = val
        .get("core")
        .and_then(|c| c.get("user_results"))
        .and_then(|u| u.get("result"))
    {
        let legacy = user_res.get("legacy");
        let name = legacy
            .and_then(|l| l.get("name"))
            .and_then(|n| n.as_str())
            .unwrap_or("Unknown")
            .to_string();
        let screen_name = legacy
            .and_then(|l| l.get("screen_name"))
            .and_then(|s| s.as_str())
            .unwrap_or("unknown")
            .to_string();
        let avatar_url = legacy
            .and_then(|l| l.get("profile_image_url_https"))
            .and_then(|a| a.as_str())
            .map(|s| s.replace("_normal.", "_bigger."));
        let verified = user_res
            .get("is_blue_verified")
            .and_then(|v| v.as_bool())
            .unwrap_or_else(|| {
                legacy
                    .and_then(|l| l.get("verified"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            });

        return TwitterAuthor {
            profile_url: build_profile_url(&screen_name),
            name,
            screen_name,
            avatar_url,
            verified,
        };
    }

    // Try Syndication shape: user: { name, screen_name, ... }
    if let Some(u) = val.get("user") {
        let name = u
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("Unknown")
            .to_string();
        let screen_name = u
            .get("screen_name")
            .and_then(|s| s.as_str())
            .unwrap_or("unknown")
            .to_string();
        let avatar_url = u
            .get("profile_image_url_https")
            .and_then(|a| a.as_str())
            .map(|s| s.replace("_normal.", "_bigger."));
        let verified = u
            .get("is_blue_verified")
            .and_then(|v| v.as_bool())
            .or_else(|| u.get("verified").and_then(|v| v.as_bool()))
            .unwrap_or(false);

        return TwitterAuthor {
            profile_url: build_profile_url(&screen_name),
            name,
            screen_name,
            avatar_url,
            verified,
        };
    }

    TwitterAuthor {
        name: "Unknown".to_string(),
        screen_name: "unknown".to_string(),
        avatar_url: None,
        verified: false,
        profile_url: "https://x.com".to_string(),
    }
}

/// Parse media attachments from GraphQL or Syndication JSON.
pub fn parse_media(val: &serde_json::Value) -> Vec<TwitterMedia> {
    let val = unwrap_result(val);
    let mut media_list = Vec::new();

    // 1. GraphQL extended_entities.media
    if let Some(media_arr) = val
        .get("legacy")
        .and_then(|l| l.get("extended_entities"))
        .and_then(|e| e.get("media"))
        .and_then(|m| m.as_array())
    {
        for m in media_arr {
            let kind = m
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("photo")
                .to_string();
            let thumb = m
                .get("media_url_https")
                .and_then(|u| u.as_str())
                .map(str::to_string);
            let alt_text = m
                .get("ext_alt_text")
                .or_else(|| m.get("alt_text"))
                .and_then(|a| a.as_str())
                .map(str::to_string);

            let mut media_url = thumb.clone().unwrap_or_default();
            if kind == "video" || kind == "animated_gif" {
                if let Some(variants) = m
                    .get("video_info")
                    .and_then(|vi| vi.get("variants"))
                    .and_then(|v| v.as_array())
                {
                    let mut best_bitrate: i64 = -1;
                    for v in variants {
                        if v.get("content_type").and_then(|c| c.as_str()) == Some("video/mp4") {
                            let bitrate = v.get("bitrate").and_then(|b| b.as_i64()).unwrap_or(0);
                            if bitrate >= best_bitrate {
                                best_bitrate = bitrate;
                                if let Some(url) = v.get("url").and_then(|u| u.as_str()) {
                                    media_url = url.to_string();
                                }
                            }
                        }
                    }
                }
            }

            let aspect_ratio = m
                .get("original_info")
                .and_then(|oi| {
                    let w = oi.get("width")?.as_f64()?;
                    let h = oi.get("height")?.as_f64()?;
                    if h > 0.0 {
                        Some(w / h)
                    } else {
                        None
                    }
                })
                .or_else(|| {
                    m.get("video_info")
                        .and_then(|vi| vi.get("aspect_ratio"))
                        .and_then(|ar| ar.as_array())
                        .and_then(|arr| {
                            let num = arr.get(0)?.as_f64()?;
                            let den = arr.get(1)?.as_f64()?;
                            if den > 0.0 {
                                Some(num / den)
                            } else {
                                None
                            }
                        })
                });

            media_list.push(TwitterMedia {
                kind,
                media_url,
                thumbnail_url: thumb,
                alt_text,
                aspect_ratio,
            });
        }
        return media_list;
    }

    // 2. Syndication photos / mediaDetails
    if let Some(photos) = val.get("photos").and_then(|p| p.as_array()) {
        for p in photos {
            if let Some(url) = p.get("url").and_then(|u| u.as_str()) {
                let aspect_ratio = {
                    let w = p.get("width").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    let h = p.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    if h > 0.0 {
                        Some(w / h)
                    } else {
                        None
                    }
                };
                media_list.push(TwitterMedia {
                    kind: "photo".to_string(),
                    media_url: url.to_string(),
                    thumbnail_url: Some(url.to_string()),
                    alt_text: p
                        .get("accessibilityLabel")
                        .and_then(|a| a.as_str())
                        .map(str::to_string),
                    aspect_ratio,
                });
            }
        }
    }

    if let Some(video) = val.get("video") {
        let thumb = video
            .get("poster")
            .and_then(|p| p.as_str())
            .map(str::to_string);
        let mut video_url = thumb.clone().unwrap_or_default();
        if let Some(variants) = video.get("variants").and_then(|v| v.as_array()) {
            let mut best_bitrate: i64 = -1;
            for v in variants {
                let ctype = v
                    .get("type")
                    .or_else(|| v.get("content_type"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("");
                if ctype.contains("mp4") {
                    let bitrate = v.get("bitrate").and_then(|b| b.as_i64()).unwrap_or(0);
                    if bitrate >= best_bitrate {
                        best_bitrate = bitrate;
                        if let Some(src) = v.get("src").or_else(|| v.get("url")).and_then(|u| u.as_str()) {
                            video_url = src.to_string();
                        }
                    }
                }
            }
        }

        let aspect_ratio = video
            .get("aspectRatio")
            .and_then(|ar| ar.as_array())
            .and_then(|arr| {
                let num = arr.get(0)?.as_f64()?;
                let den = arr.get(1)?.as_f64()?;
                if den > 0.0 {
                    Some(num / den)
                } else {
                    None
                }
            });

        media_list.push(TwitterMedia {
            kind: "video".to_string(),
            media_url: video_url,
            thumbnail_url: thumb,
            alt_text: None,
            aspect_ratio,
        });
    }

    media_list
}

/// Parse quoted post if present.
pub fn parse_quoted_post(val: &serde_json::Value) -> Option<TwitterQuotedPost> {
    let val = unwrap_result(val);

    // GraphQL: quoted_status_result.result
    if let Some(q_val) = val
        .get("quoted_status_result")
        .and_then(|q| q.get("result"))
    {
        let q_val = unwrap_result(q_val);
        let author = parse_author(q_val);
        let id = q_val
            .get("rest_id")
            .or_else(|| q_val.get("legacy").and_then(|l| l.get("id_str")))
            .and_then(|i| i.as_str())
            .unwrap_or_default()
            .to_string();

        let text = q_val
            .get("note_tweet")
            .and_then(|nt| nt.get("note_tweet_results"))
            .and_then(|r| r.get("result"))
            .and_then(|res| res.get("text"))
            .and_then(|t| t.as_str())
            .or_else(|| {
                q_val
                    .get("legacy")
                    .and_then(|l| l.get("full_text"))
                    .and_then(|t| t.as_str())
            })
            .unwrap_or_default()
            .to_string();

        let media = parse_media(q_val);
        let created_at = q_val
            .get("legacy")
            .and_then(|l| l.get("created_at"))
            .and_then(|c| c.as_str())
            .map(str::to_string);
        let url = build_status_url(&author.screen_name, &id);

        return Some(TwitterQuotedPost {
            id,
            author,
            text,
            media,
            created_at,
            url,
        });
    }

    // Syndication: quoted_tweet
    if let Some(q_val) = val.get("quoted_tweet") {
        let author = parse_author(q_val);
        let id = q_val
            .get("id_str")
            .and_then(|i| i.as_str())
            .unwrap_or_default()
            .to_string();
        let text = q_val
            .get("text")
            .and_then(|t| t.as_str())
            .unwrap_or_default()
            .to_string();
        let media = parse_media(q_val);
        let created_at = q_val
            .get("created_at")
            .and_then(|c| c.as_str())
            .map(str::to_string);
        let url = build_status_url(&author.screen_name, &id);

        return Some(TwitterQuotedPost {
            id,
            author,
            text,
            media,
            created_at,
            url,
        });
    }

    None
}

/// Parse a complete TwitterPost from GraphQL or Syndication JSON.
pub fn parse_post(val: &serde_json::Value, fallback_id: &str) -> TwitterPost {
    let val = unwrap_result(val);
    let author = parse_author(val);

    let id = val
        .get("rest_id")
        .or_else(|| val.get("id_str"))
        .or_else(|| val.get("legacy").and_then(|l| l.get("id_str")))
        .and_then(|i| i.as_str())
        .unwrap_or(fallback_id)
        .to_string();

    let is_note_tweet = val.get("note_tweet").is_some();
    let note_text = val
        .get("note_tweet")
        .and_then(|nt| {
            nt.get("note_tweet_results")
                .and_then(|r| r.get("result"))
                .and_then(|res| res.get("text"))
                .or_else(|| nt.get("text"))
        })
        .and_then(|t| t.as_str());

    let raw_text = note_text
        .or_else(|| {
            val.get("legacy")
                .and_then(|l| l.get("full_text"))
                .and_then(|t| t.as_str())
        })
        .or_else(|| val.get("text").and_then(|t| t.as_str()))
        .unwrap_or_default();

    let full_text = raw_text.to_string();
    let text = normalize_text(raw_text);

    let media = parse_media(val);
    let quoted_post = parse_quoted_post(val);

    let legacy = val.get("legacy");
    let created_at = legacy
        .and_then(|l| l.get("created_at"))
        .or_else(|| val.get("created_at"))
        .and_then(|c| c.as_str())
        .map(str::to_string);

    let reply_count = legacy
        .and_then(|l| l.get("reply_count"))
        .or_else(|| val.get("reply_count"))
        .or_else(|| val.get("conversation_count"))
        .and_then(|v| v.as_i64());

    let retweet_count = legacy
        .and_then(|l| l.get("retweet_count"))
        .or_else(|| val.get("retweet_count"))
        .and_then(|v| v.as_i64());

    let favorite_count = legacy
        .and_then(|l| l.get("favorite_count"))
        .or_else(|| val.get("favorite_count"))
        .and_then(|v| v.as_i64());

    let bookmark_count = legacy
        .and_then(|l| l.get("bookmark_count"))
        .and_then(|v| v.as_i64());

    let url = build_status_url(&author.screen_name, &id);

    TwitterPost {
        id,
        post_index: 1,
        author,
        text,
        full_text,
        media,
        quoted_post,
        created_at,
        reply_count,
        retweet_count,
        favorite_count,
        bookmark_count,
        is_note_tweet,
        url,
    }
}

// ── HTML & Structured Text Formatting ─────────────────────────────────────

fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// Render thread as formatted HTML styled with semantic tokens for the reader.
pub fn build_thread_html(author: &TwitterAuthor, posts: &[TwitterPost]) -> String {
    let mut html = String::with_capacity(posts.len() * 1024);

    html.push_str(r#"<div class="x-thread-container" style="max-width: 48rem; margin: 0 auto; padding: 1.5rem 1rem; font-family: var(--font-family, sans-serif);">"#);

    // Thread Author Header
    html.push_str(r#"<header class="x-thread-header" style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--color-border, #e2e8f0); padding-bottom: 1rem; margin-bottom: 1.5rem;">"#);
    html.push_str(r#"<div style="display: flex; align-items: center; gap: 0.75rem;">"#);
    if let Some(avatar) = &author.avatar_url {
        html.push_str(&format!(
            r#"<img src="{}" alt="{}" style="width: 3rem; height: 3rem; border-radius: 9999px; object-fit: cover;" />"#,
            escape_html(avatar),
            escape_html(&author.name)
        ));
    }
    html.push_str(r#"<div>"#);
    html.push_str(&format!(
        r#"<div style="font-weight: 700; font-size: 1.125rem; color: var(--color-foreground, #020817); display: flex; align-items: center; gap: 0.25rem;">{} {}</div>"#,
        escape_html(&author.name),
        if author.verified {
            r#"<span title="Verified" style="color: #38bdf8;">✓</span>"#
        } else {
            ""
        }
    ));
    html.push_str(&format!(
        r#"<a href="{}" target="_blank" rel="noopener noreferrer" style="font-size: 0.875rem; color: var(--color-muted-foreground, #64748b); text-decoration: none;">@{}</a>"#,
        escape_html(&author.profile_url),
        escape_html(&author.screen_name)
    ));
    html.push_str(r#"</div></div>"#);

    html.push_str(&format!(
        r#"<div style="font-size: 0.8125rem; font-weight: 600; padding: 0.25rem 0.625rem; border-radius: 9999px; background: var(--color-muted, #f1f5f9); color: var(--color-muted-foreground, #64748b);">{} post{}</div>"#,
        posts.len(),
        if posts.len() == 1 { "" } else { "s" }
    ));
    html.push_str(r#"</header>"#);

    // Thread Posts Stream
    html.push_str(r#"<main class="x-posts-stream" style="display: flex; flex-direction: column; gap: 1.5rem;">"#);

    for post in posts {
        html.push_str(&format!(
            r#"<article class="x-post" id="post-{}" data-post-id="{}" data-post-index="{}" style="position: relative; padding: 1.25rem; border-radius: 0.75rem; border: 1px solid var(--color-border, #e2e8f0); background: var(--color-card, #ffffff);">"#,
            escape_html(&post.id),
            escape_html(&post.id),
            post.post_index
        ));

        // Post top meta
        html.push_str(r#"<div class="x-post-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; font-size: 0.8125rem; color: var(--color-muted-foreground, #64748b);">"#);
        html.push_str(&format!(
            r#"<span style="font-weight: 600;">Post {} of {}</span>"#,
            post.post_index,
            posts.len()
        ));
        html.push_str(r#"<div style="display: flex; align-items: center; gap: 0.5rem;">"#);
        if let Some(created) = &post.created_at {
            html.push_str(&format!(r#"<span>{}</span>"#, escape_html(created)));
        }
        html.push_str(&format!(
            r#"<button class="x-extract-post-btn" onclick="window.parent.postMessage({{type:'PLETHORA_EXTRACT_POST',postId:'{}',postIndex:{},text:document.getElementById('post-body-{}')?.innerText||''}},'*')" style="background: var(--color-muted, #f1f5f9); border: 1px solid var(--color-border, #e2e8f0); border-radius: 4px; padding: 2px 8px; font-size: 0.75rem; color: var(--color-foreground, #020817); cursor: pointer;" title="Extract this post">Extract</button>"#,
            escape_html(&post.id),
            post.post_index,
            escape_html(&post.id)
        ));
        html.push_str(r#"</div></div>"#);

        // Body Text
        html.push_str(&format!(
            r#"<div class="x-post-body" id="post-body-{}" style="font-size: 1rem; line-height: 1.625; color: var(--color-foreground, #020817); white-space: pre-wrap; word-break: break-word;">"#,
            escape_html(&post.id)
        ));
        html.push_str(&escape_html(&post.full_text));
        html.push_str(r#"</div>"#);

        // Media Grid
        if !post.media.is_empty() {
            html.push_str(r#"<div class="x-post-media" style="margin-top: 1rem; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.5rem; border-radius: 0.5rem; overflow: hidden;">"#);
            for m in &post.media {
                if m.kind == "video" || m.kind == "animated_gif" {
                    html.push_str(&format!(
                        r#"<div style="position: relative;"><video src="{}" poster="{}" controls style="width: 100%; border-radius: 0.5rem; max-height: 24rem; object-fit: cover;"></video></div>"#,
                        escape_html(&m.media_url),
                        escape_html(m.thumbnail_url.as_deref().unwrap_or_default())
                    ));
                } else {
                    html.push_str(&format!(
                        r#"<a href="{}" target="_blank" rel="noopener noreferrer"><img src="{}" alt="{}" style="width: 100%; height: auto; border-radius: 0.5rem; max-height: 24rem; object-fit: cover;" /></a>"#,
                        escape_html(&m.media_url),
                        escape_html(&m.media_url),
                        escape_html(m.alt_text.as_deref().unwrap_or("Attached image"))
                    ));
                }
            }
            html.push_str(r#"</div>"#);
        }

        // Quoted Post
        if let Some(quote) = &post.quoted_post {
            html.push_str(r#"<div class="x-quoted-post" style="margin-top: 1rem; padding: 0.875rem; border-radius: 0.5rem; border: 1px solid var(--color-border, #e2e8f0); background: var(--color-muted, #f1f5f9);">"#);
            html.push_str(&format!(
                r#"<div style="font-weight: 600; font-size: 0.875rem; color: var(--color-foreground, #020817); margin-bottom: 0.25rem;">{} <span style="color: var(--color-muted-foreground, #64748b); font-weight: 400;">@{}</span></div>"#,
                escape_html(&quote.author.name),
                escape_html(&quote.author.screen_name)
            ));
            html.push_str(&format!(
                r#"<div style="font-size: 0.875rem; line-height: 1.5; color: var(--color-foreground, #020817); white-space: pre-wrap;">{}</div>"#,
                escape_html(&quote.text)
            ));
            html.push_str(r#"</div>"#);
        }

        // Post Footer Link
        html.push_str(r#"<div class="x-post-footer" style="display: flex; align-items: center; justify-content: space-between; margin-top: 0.75rem; font-size: 0.75rem; color: var(--color-muted-foreground, #64748b);">"#);
        html.push_str(&format!(
            r#"<a href="{}" target="_blank" rel="noopener noreferrer" style="color: inherit; text-decoration: none;">View on X →</a>"#,
            escape_html(&post.url)
        ));
        html.push_str(r#"</div>"#);

        html.push_str(r#"</article>"#);
    }

    html.push_str(r#"</main>"#);
    html.push_str(r#"</div>"#);

    html
}

/// Render structured plain text with post boundaries for token-efficient AI prompts.
pub fn build_thread_structured_text(author: &TwitterAuthor, posts: &[TwitterPost]) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "X Thread by {} (@{}):\n\n",
        author.name, author.screen_name
    ));

    for post in posts {
        out.push_str(&format!(
            "[Post {} by @{}]\n{}\n\n",
            post.post_index, author.screen_name, post.full_text
        ));
        if let Some(quote) = &post.quoted_post {
            out.push_str(&format!(
                "[Quoting @{}]: \"{}\"\n\n",
                quote.author.screen_name, quote.text
            ));
        }
    }

    out.trim().to_string()
}

// ── Thread Normalization & Traversal ──────────────────────────────────────

/// Resolve a full thread from a given starting tweet URL.
pub async fn resolve_twitter_thread(url: &str) -> Result<TwitterThread, String> {
    let tweet_id = extract_tweet_id(url)?;
    let result = fetch_tweet_result(&tweet_id).await?;

    let root_post = parse_post(&result, &tweet_id);
    let author = root_post.author.clone();

    let mut posts = Vec::new();
    let mut seen_ids = HashSet::new();

    // Check if result contains timeline instructions with multi-post conversation
    if let Some(instructions) = result
        .get("threaded_conversation_with_injections_v2")
        .and_then(|tc| tc.get("instructions"))
        .or_else(|| {
            result
                .get("timeline")
                .and_then(|tl| tl.get("instructions"))
        })
        .and_then(|i| i.as_array())
    {
        for inst in instructions {
            if let Some(entries) = inst.get("entries").and_then(|e| e.as_array()) {
                for entry in entries {
                    // Check itemContent or items
                    if let Some(item_res) = entry
                        .get("content")
                        .and_then(|c| c.get("itemContent"))
                        .and_then(|ic| ic.get("tweet_results"))
                        .and_then(|tr| tr.get("result"))
                    {
                        let p = parse_post(item_res, "");
                        if p.author.screen_name.eq_ignore_ascii_case(&author.screen_name)
                            && !p.id.is_empty()
                            && seen_ids.insert(p.id.clone())
                        {
                            posts.push(p);
                        }
                    } else if let Some(items) = entry
                        .get("content")
                        .and_then(|c| c.get("items"))
                        .and_then(|it| it.as_array())
                    {
                        for it in items {
                            if let Some(item_res) = it
                                .get("item")
                                .and_then(|i| i.get("itemContent"))
                                .and_then(|ic| ic.get("tweet_results"))
                                .and_then(|tr| tr.get("result"))
                            {
                                let p = parse_post(item_res, "");
                                if p.author.screen_name.eq_ignore_ascii_case(&author.screen_name)
                                    && !p.id.is_empty()
                                    && seen_ids.insert(p.id.clone())
                                {
                                    posts.push(p);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if posts.is_empty() {
        // Single post fallback
        seen_ids.insert(root_post.id.clone());
        posts.push(root_post);
    } else {
        // Ensure root post is included
        if !seen_ids.contains(&tweet_id) {
            posts.insert(0, root_post);
        }
    }

    // Number posts sequentially
    for (i, p) in posts.iter_mut().enumerate() {
        p.post_index = i + 1;
    }

    let root_id = posts
        .first()
        .map(|p| p.id.clone())
        .unwrap_or_else(|| tweet_id.clone());
    let root_url = build_status_url(&author.screen_name, &root_id);

    let first_text = posts.first().map(|p| p.text.as_str()).unwrap_or("X Thread");
    let excerpt = if first_text.chars().count() > 80 {
        format!("{}...", first_text.chars().take(80).collect::<String>())
    } else {
        first_text.to_string()
    };
    let title = format!("{} (@{}) on X: \"{}\"", author.name, author.screen_name, excerpt);

    let html_content = build_thread_html(&author, &posts);
    let structured_text = build_thread_structured_text(&author, &posts);
    let created_at = posts.first().and_then(|p| p.created_at.clone());
    let total_posts = posts.len();

    Ok(TwitterThread {
        id: root_id.clone(),
        root_id,
        root_url,
        author,
        title,
        posts,
        total_posts,
        html_content,
        structured_text,
        created_at,
    })
}

/// Walk the raw tweet result and extract video metadata.
fn parse_video(result: &serde_json::Value, tweet_id: &str) -> Result<TwitterVideoInfo, String> {
    let result = unwrap_result(result);

    let legacy = result
        .get("legacy")
        .ok_or_else(|| "Tweet has no legacy block".to_string())?;

    let media_arr = legacy
        .get("extended_entities")
        .and_then(|e| e.get("media"))
        .and_then(|m| m.as_array())
        .ok_or_else(|| "This post doesn't contain a video.".to_string())?;

    let mut chosen: Option<(String, Option<i64>, Option<String>)> = None;
    for m in media_arr {
        let kind = m.get("type").and_then(|v| v.as_str()).unwrap_or("");
        if kind != "video" && kind != "animated_gif" {
            continue;
        }
        let video_info = match m.get("video_info") {
            Some(vi) => vi,
            None => continue,
        };

        let mut best_bitrate: i64 = -1;
        let mut best_url: Option<String> = None;
        if let Some(variants) = video_info.get("variants").and_then(|v| v.as_array()) {
            for v in variants {
                let ctype = v.get("content_type").and_then(|c| c.as_str()).unwrap_or("");
                if ctype != "video/mp4" {
                    continue;
                }
                let bitrate = v.get("bitrate").and_then(|b| b.as_i64()).unwrap_or(0);
                if bitrate >= best_bitrate {
                    best_bitrate = bitrate;
                    if let Some(url) = v.get("url").and_then(|u| u.as_str()) {
                        best_url = Some(url.to_string());
                    }
                }
            }
        }

        let mp4_url = match best_url {
            Some(u) => u,
            None => continue,
        };

        let duration_ms = video_info.get("duration_millis").and_then(|d| d.as_i64());
        let thumb = m
            .get("media_url_https")
            .and_then(|u| u.as_str())
            .map(|s| s.to_string());
        chosen = Some((mp4_url, duration_ms, thumb));
        break;
    }

    let (mp4_url, duration_ms, thumbnail_url) =
        chosen.ok_or_else(|| "This post doesn't contain a video.".to_string())?;

    let duration_secs = duration_ms.map(|ms| ms / 1000);

    let full_text = legacy
        .get("full_text")
        .and_then(|t| t.as_str())
        .unwrap_or("");
    let title = normalize_text(full_text);
    let title = if title.is_empty() {
        format!("Tweet {}", tweet_id)
    } else {
        title
    };

    let author = result
        .get("core")
        .and_then(|c| c.get("user_results"))
        .and_then(|ur| ur.get("result"))
        .and_then(|r| r.get("legacy"))
        .and_then(|l| l.get("screen_name"))
        .and_then(|s| s.as_str())
        .unwrap_or("unknown")
        .to_string();

    let status_url = build_status_url(&author, tweet_id);

    Ok(TwitterVideoInfo {
        tweet_id: tweet_id.to_string(),
        status_url,
        title,
        author,
        thumbnail_url,
        duration_secs,
        mp4_url,
    })
}

/// Resolve video metadata (no download).
pub async fn resolve_video_info(url: &str) -> Result<TwitterVideoInfo, String> {
    let tweet_id = extract_tweet_id(url)?;
    let result = fetch_tweet_result(&tweet_id).await?;
    parse_video(&result, &tweet_id)
}

/// Where Twitter videos are stored.
fn videos_dir() -> Result<PathBuf, String> {
    let dir = dirs::data_dir()
        .ok_or_else(|| "Could not determine data directory".to_string())?
        .join("incrementum")
        .join("videos");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create video directory: {}", e))?;
    Ok(dir)
}

/// Stream `mp4_url` into the app's videos directory.
async fn download_video(mp4_url: &str, tweet_id: &str) -> Result<(PathBuf, u64), String> {
    let dir = videos_dir()?;
    let timestamp = chrono::Utc::now().timestamp();
    let filename = format!("{}-{}.mp4", timestamp, tweet_id);
    let dest = dir.join(filename);

    let resp = HTTP
        .get(mp4_url)
        .header("user-agent", UA)
        .send()
        .await
        .map_err(|e| format!("Failed to start video download: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Video download failed: HTTP {}", resp.status()));
    }

    use futures::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut file = tokio::fs::File::create(&dest)
        .await
        .map_err(|e| format!("Failed to create video file: {}", e))?;

    let mut total: u64 = 0;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Error reading video stream: {}", e))?;
        total += chunk.len() as u64;
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write video chunk: {}", e))?;
    }
    file.flush()
        .await
        .map_err(|e| format!("Failed to flush video file: {}", e))?;

    Ok((dest, total))
}

// ── Tauri commands ────────────────────────────────────────────────────────

/// Resolve a tweet URL to its video metadata, without downloading.
#[tauri::command]
pub async fn get_twitter_video_info(url: String) -> Result<TwitterVideoInfo, String> {
    resolve_video_info(&url).await
}

/// Resolve an X/Twitter post or thread URL to its parsed thread model.
#[tauri::command]
pub async fn get_twitter_thread(url: String) -> Result<TwitterThread, String> {
    resolve_twitter_thread(&url).await
}

/// Import a Twitter/X video as a `Video` document.
#[tauri::command]
pub async fn import_twitter_video(
    url: String,
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Document, String> {
    let info = resolve_video_info(&url).await?;
    let (dest_path, file_size) = download_video(&info.mp4_url, &info.tweet_id).await?;

    let now = chrono::Utc::now();
    let mut doc = Document::with_collection(
        info.title.clone(),
        dest_path.to_string_lossy().to_string(),
        FileType::Video,
        collection_id,
    );
    doc.category = Some("Videos".to_string());
    doc.tags = vec!["twitter".to_string(), "x".to_string(), "video".to_string()];
    doc.total_pages = info.duration_secs.map(|s| s as i32);
    doc.priority_score = 7.0;
    doc.current_page = Some(0);
    if let Some(thumb) = &info.thumbnail_url {
        doc.cover_image_url = Some(thumb.clone());
        doc.cover_image_source = Some("twitter".to_string());
    }

    doc.metadata = Some(DocumentMetadata {
        author: Some(info.author.clone()),
        file_size: Some(file_size as i64),
        created_at: Some(now),
        source: Some("twitter".to_string()),
        fetched_at: Some(now),
        site_name: Some("X".to_string()),
        ..Default::default()
    });

    repo.create_document(&doc)
        .await
        .map_err(|e| format!("Failed to save document to database: {}", e))
}

/// Import an X/Twitter post or thread as an `Html` document.
#[tauri::command]
pub async fn import_twitter_thread(
    url: String,
    collection_id: Option<String>,
    repo: State<'_, Repository>,
) -> Result<Document, String> {
    let thread = resolve_twitter_thread(&url).await?;
    let now = chrono::Utc::now();

    let mut doc = Document::with_collection(
        thread.title.clone(),
        thread.root_url.clone(),
        FileType::Html,
        collection_id,
    );
    doc.category = Some("X Threads".to_string());
    doc.tags = vec!["x".to_string(), "twitter".to_string(), "thread".to_string()];
    doc.content = Some(thread.structured_text.clone());
    doc.total_pages = Some(thread.total_posts as i32);
    doc.priority_score = 6.0;
    doc.current_page = Some(0);

    if let Some(first_img) = thread.posts.iter().flat_map(|p| &p.media).find(|m| m.kind == "photo") {
        doc.cover_image_url = Some(first_img.media_url.clone());
        doc.cover_image_source = Some("twitter".to_string());
    } else if let Some(avatar) = &thread.author.avatar_url {
        doc.cover_image_url = Some(avatar.clone());
        doc.cover_image_source = Some("twitter".to_string());
    }

    doc.metadata = Some(DocumentMetadata {
        author: Some(thread.author.name.clone()),
        created_at: Some(now),
        source: Some(thread.root_url.clone()),
        fetched_at: Some(now),
        site_name: Some("X".to_string()),
        article_html: Some(thread.html_content.clone()),
        structured_content: serde_json::to_value(&thread).ok(),
        ..Default::default()
    });

    repo.create_document(&doc)
        .await
        .map_err(|e| format!("Failed to save thread document to database: {}", e))
}

// ── tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_tweet_id_from_x_url() {
        assert_eq!(
            extract_tweet_id("https://x.com/user/status/1234567890").unwrap(),
            "1234567890"
        );
    }

    #[test]
    fn extracts_tweet_id_from_twitter_url_with_query() {
        assert_eq!(
            extract_tweet_id("https://twitter.com/Someone/status/987?s=20&t=abc").unwrap(),
            "987"
        );
    }

    #[test]
    fn extracts_tweet_id_with_trailing_slash() {
        assert_eq!(
            extract_tweet_id("https://x.com/u/status/42/").unwrap(),
            "42"
        );
    }

    #[test]
    fn rejects_url_without_status() {
        assert!(extract_tweet_id("https://x.com/user").is_err());
    }

    #[test]
    fn rejects_non_numeric_id() {
        assert!(extract_tweet_id("https://x.com/u/status/abc").is_err());
    }

    #[test]
    fn parses_single_tweet_graphql() {
        let result = serde_json::json!({
            "__typename": "Tweet",
            "rest_id": "1001",
            "legacy": {
                "id_str": "1001",
                "full_text": "Hello X world!",
                "created_at": "Mon Jan 01 12:00:00 +0000 2024",
                "favorite_count": 42,
                "reply_count": 5,
                "retweet_count": 10,
                "bookmark_count": 2,
                "extended_entities": {
                    "media": [{
                        "type": "photo",
                        "media_url_https": "https://pbs.twimg.com/media/pic1.jpg",
                        "original_info": { "width": 1200, "height": 800 }
                    }]
                }
            },
            "core": {
                "user_results": {
                    "result": {
                        "legacy": {
                            "name": "Jane Researcher",
                            "screen_name": "janeresearch",
                            "profile_image_url_https": "https://pbs.twimg.com/avatar_normal.jpg",
                            "verified": true
                        },
                        "is_blue_verified": true
                    }
                }
            }
        });

        let post = parse_post(&result, "1001");
        assert_eq!(post.id, "1001");
        assert_eq!(post.author.name, "Jane Researcher");
        assert_eq!(post.author.screen_name, "janeresearch");
        assert_eq!(post.author.verified, true);
        assert_eq!(post.text, "Hello X world!");
        assert_eq!(post.full_text, "Hello X world!");
        assert_eq!(post.media.len(), 1);
        assert_eq!(post.media[0].kind, "photo");
        assert_eq!(post.media[0].media_url, "https://pbs.twimg.com/media/pic1.jpg");
        assert_eq!(post.media[0].aspect_ratio, Some(1.5));
    }

    #[test]
    fn parses_notetweet_longform_text() {
        let result = serde_json::json!({
            "__typename": "Tweet",
            "rest_id": "1002",
            "legacy": {
                "id_str": "1002",
                "full_text": "Short preview..."
            },
            "note_tweet": {
                "note_tweet_results": {
                    "result": {
                        "text": "This is a comprehensive longform post that exceeds 280 characters and contains detailed explanations of the discovery."
                    }
                }
            },
            "core": {
                "user_results": {
                    "result": {
                        "legacy": { "name": "Author", "screen_name": "author" }
                    }
                }
            }
        });

        let post = parse_post(&result, "1002");
        assert_eq!(post.is_note_tweet, true);
        assert_eq!(
            post.full_text,
            "This is a comprehensive longform post that exceeds 280 characters and contains detailed explanations of the discovery."
        );
    }

    #[test]
    fn parses_syndication_tweet_shape() {
        let result = serde_json::json!({
            "__typename": "Tweet",
            "id_str": "1003",
            "text": "Syndicated tweet content",
            "user": {
                "name": "Syndicated User",
                "screen_name": "synuser",
                "profile_image_url_https": "https://pbs.twimg.com/syn_normal.jpg",
                "is_blue_verified": true
            },
            "photos": [{
                "url": "https://pbs.twimg.com/synphoto.jpg",
                "width": 600,
                "height": 400
            }],
            "quoted_tweet": {
                "id_str": "999",
                "text": "Original quote text",
                "user": {
                    "name": "Quoted Author",
                    "screen_name": "quoteauthor"
                }
            }
        });

        let post = parse_post(&result, "1003");
        assert_eq!(post.id, "1003");
        assert_eq!(post.author.screen_name, "synuser");
        assert_eq!(post.author.verified, true);
        assert_eq!(post.media.len(), 1);
        assert!(post.quoted_post.is_some());
        let q = post.quoted_post.unwrap();
        assert_eq!(q.id, "999");
        assert_eq!(q.author.screen_name, "quoteauthor");
        assert_eq!(q.text, "Original quote text");
    }

    #[test]
    fn builds_html_and_structured_text_for_threads() {
        let author = TwitterAuthor {
            name: "Alice Scholar".to_string(),
            screen_name: "alicescholar".to_string(),
            avatar_url: Some("https://example.com/avatar.jpg".to_string()),
            verified: true,
            profile_url: "https://x.com/alicescholar".to_string(),
        };

        let posts = vec![
            TwitterPost {
                id: "201".to_string(),
                post_index: 1,
                author: author.clone(),
                text: "1/3 First claim about AI architectures.".to_string(),
                full_text: "1/3 First claim about AI architectures.".to_string(),
                media: vec![],
                quoted_post: None,
                created_at: Some("2024-02-01".to_string()),
                reply_count: Some(2),
                retweet_count: Some(5),
                favorite_count: Some(20),
                bookmark_count: Some(1),
                is_note_tweet: false,
                url: "https://x.com/alicescholar/status/201".to_string(),
            },
            TwitterPost {
                id: "202".to_string(),
                post_index: 2,
                author: author.clone(),
                text: "2/3 Evidence supporting the claim.".to_string(),
                full_text: "2/3 Evidence supporting the claim.".to_string(),
                media: vec![],
                quoted_post: None,
                created_at: Some("2024-02-01".to_string()),
                reply_count: Some(1),
                retweet_count: Some(3),
                favorite_count: Some(15),
                bookmark_count: Some(0),
                is_note_tweet: false,
                url: "https://x.com/alicescholar/status/202".to_string(),
            },
        ];

        let html = build_thread_html(&author, &posts);
        assert!(html.contains("Alice Scholar"));
        assert!(html.contains("@alicescholar"));
        assert!(html.contains("Post 1 of 2"));
        assert!(html.contains("Post 2 of 2"));
        assert!(html.contains("First claim about AI architectures."));

        let structured = build_thread_structured_text(&author, &posts);
        assert!(structured.contains("X Thread by Alice Scholar (@alicescholar):"));
        assert!(structured.contains("[Post 1 by @alicescholar]"));
        assert!(structured.contains("[Post 2 by @alicescholar]"));
    }

    #[test]
    fn picks_highest_bitrate_mp4_variant() {
        let result = serde_json::json!({
            "__typename": "Tweet",
            "legacy": {
                "full_text": "look at this https://t.co/abc",
                "extended_entities": {
                    "media": [{
                        "type": "photo",
                        "media_url_https": "https://pbs.twimg.com/photo.jpg"
                    }, {
                        "type": "video",
                        "media_url_https": "https://pbs.twimg.com/thumb.jpg",
                        "video_info": {
                            "duration_millis": 12500,
                            "variants": [
                                {"content_type": "application/x-mpegURL", "url": "https://x.com/hls.m3u8"},
                                {"bitrate": 832000,  "content_type": "video/mp4", "url": "https://x.com/360p.mp4"},
                                {"bitrate": 2176000, "content_type": "video/mp4", "url": "https://x.com/720p.mp4"}
                            ]
                        }
                    }]
                }
            },
            "core": {
                "user_results": { "result": { "legacy": { "screen_name": "testuser" } } }
            }
        });

        let info = parse_video(&result, "111").unwrap();
        assert_eq!(info.mp4_url, "https://x.com/720p.mp4");
        assert_eq!(info.duration_secs, Some(12));
        assert_eq!(
            info.thumbnail_url.as_deref(),
            Some("https://pbs.twimg.com/thumb.jpg")
        );
        assert_eq!(info.author, "testuser");
        assert_eq!(info.status_url, "https://x.com/testuser/status/111");
        assert_eq!(info.title, "look at this https://t.co/abc");
    }

    #[test]
    fn errors_when_no_video_media() {
        let result = serde_json::json!({
            "__typename": "Tweet",
            "legacy": {
                "full_text": "just text",
                "extended_entities": {
                    "media": [{"type": "photo", "media_url_https": "https://x.com/p.jpg"}]
                }
            },
            "core": { "user_results": { "result": { "legacy": { "screen_name": "u" } } } }
        });
        assert!(parse_video(&result, "1").is_err());
    }

    #[test]
    fn unwraps_visibility_wrapper() {
        let result = serde_json::json!({
            "__typename": "TweetWithVisibilityResults",
            "tweet": {
                "__typename": "Tweet",
                "legacy": {
                    "full_text": "hi",
                    "extended_entities": {
                        "media": [{
                            "type": "video",
                            "video_info": {
                                "variants": [
                                    {"bitrate": 832000, "content_type": "video/mp4", "url": "https://x.com/v.mp4"}
                                ]
                            }
                        }]
                    }
                },
                "core": { "user_results": { "result": { "legacy": { "screen_name": "u" } } } }
            }
        });
        let info = parse_video(&result, "5").unwrap();
        assert_eq!(info.mp4_url, "https://x.com/v.mp4");
    }
}

