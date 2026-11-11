//! External JSON chapter fetcher and validator for Podcasting 2.0 chapters.
//!
//! Conforms to Podcasting 2.0 chapters specification (`application/json+chapters`):
//! https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md#chapters
//!
//! Includes strict SSRF protection (prohibits loopback, link-local, private RFC1918,
//! cloud metadata endpoints, and non-HTTP/HTTPS schemes).

use crate::models::podcast_ad::{ChapterSource, PodcastChapter};
use crate::podcast::parser::{is_sponsor_title, parse_timestamp_to_ms};
use reqwest::header::USER_AGENT;
use serde::{Deserialize, Serialize};
use std::net::{IpAddr, ToSocketAddrs};
use std::time::Duration;
use url::Url;

/// Checks if an IP address is considered private, loopback, link-local, or otherwise prohibited for SSRF protection.
pub fn is_prohibited_ip(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(ipv4) => {
            if ipv4.is_loopback()
                || ipv4.is_link_local()
                || ipv4.is_private()
                || ipv4.is_broadcast()
                || ipv4.is_unspecified()
                || ipv4.is_documentation()
            {
                return true;
            }
            let octets = ipv4.octets();
            // Benchmarking: 198.18.0.0/15
            if octets[0] == 198 && (octets[1] == 18 || octets[1] == 19) {
                return true;
            }
            // Carrier-grade NAT: 100.64.0.0/10
            if octets[0] == 100 && (octets[1] >= 64 && octets[1] <= 127) {
                return true;
            }
            // Multicast or reserved (224.0.0.0/4 and above)
            if octets[0] >= 224 {
                return true;
            }
            false
        }
        IpAddr::V6(ipv6) => {
            if ipv6.is_loopback() || ipv6.is_unspecified() {
                return true;
            }
            let octets = ipv6.octets();
            // Unique local: fc00::/7
            if (octets[0] & 0xfe) == 0xfc {
                return true;
            }
            // Link-local: fe80::/10
            if octets[0] == 0xfe && (octets[1] & 0xc0) == 0x80 {
                return true;
            }
            // Multicast: ff00::/8
            if octets[0] == 0xff {
                return true;
            }
            // IPv4-mapped IPv6 (::ffff:x.x.x.x)
            if let Some(ipv4) = ipv6.to_ipv4_mapped() {
                return is_prohibited_ip(&IpAddr::V4(ipv4));
            }
            false
        }
    }
}

/// Validate a URL against SSRF attack vectors.
///
/// Ensures scheme is http or https and host is not localhost, a private IP, or metadata endpoint.
pub fn validate_external_url(url_str: &str) -> Result<Url, String> {
    let parsed = Url::parse(url_str).map_err(|e| format!("Invalid URL: {}", e))?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!(
            "Unsupported scheme '{}': only http and https are allowed",
            scheme
        ));
    }

    let host = parsed
        .host()
        .ok_or_else(|| "URL must have a host".to_string())?;

    match host {
        url::Host::Ipv4(ipv4) => {
            if is_prohibited_ip(&IpAddr::V4(ipv4)) {
                return Err(format!("Prohibited IP address: {}", ipv4));
            }
        }
        url::Host::Ipv6(ipv6) => {
            if is_prohibited_ip(&IpAddr::V6(ipv6)) {
                return Err(format!("Prohibited IP address: {}", ipv6));
            }
        }
        url::Host::Domain(ref d) => {
            let host_lower = d.to_lowercase();
            if host_lower == "localhost"
                || host_lower.ends_with(".localhost")
                || host_lower.ends_with(".local")
                || host_lower == "metadata.google.internal"
                || host_lower == "instance-data"
            {
                return Err(format!("Prohibited host: {}", d));
            }
        }
    }

    Ok(parsed)
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Podcast20ChaptersFile {
    pub version: Option<String>,
    pub author: Option<String>,
    pub title: Option<String>,
    #[serde(rename = "podcastName")]
    pub podcast_name: Option<String>,
    pub description: Option<String>,
    #[serde(default)]
    pub chapters: Vec<Podcast20ChapterItem>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Podcast20ChapterItem {
    #[serde(rename = "startTime")]
    pub start_time: serde_json::Value,
    pub title: Option<String>,
    pub img: Option<String>,
    pub image: Option<String>,
    pub url: Option<String>,
    pub href: Option<String>,
    pub toc: Option<bool>,
    #[serde(rename = "endTime")]
    pub end_time: Option<serde_json::Value>,
}

/// Helper to parse a JSON Value (number or string) into milliseconds
fn parse_time_value(val: &serde_json::Value) -> Option<i64> {
    match val {
        serde_json::Value::Number(n) => n.as_f64().map(|secs| (secs * 1000.0).round() as i64),
        serde_json::Value::String(s) => parse_timestamp_to_ms(s),
        _ => None,
    }
}

/// Parse Podcasting 2.0 chapters JSON string into a list of PodcastChapter records.
pub fn parse_chapters_json(
    json_str: &str,
    episode_id: &str,
    duration_secs: Option<i64>,
) -> Result<Vec<PodcastChapter>, String> {
    let parsed: Podcast20ChaptersFile =
        serde_json::from_str(json_str).map_err(|e| format!("Invalid chapters JSON: {}", e))?;

    let mut raw_items: Vec<(i64, Option<i64>, String, Option<String>, Option<String>)> = Vec::new();

    for item in parsed.chapters {
        let start_ms = parse_time_value(&item.start_time).unwrap_or(0);
        let explicit_end_ms = item.end_time.as_ref().and_then(parse_time_value);
        let title = item.title.unwrap_or_else(|| "Untitled Chapter".to_string());
        let image = item.img.or(item.image);
        let link = item.url.or(item.href);
        raw_items.push((start_ms, explicit_end_ms, title, image, link));
    }

    raw_items.sort_by_key(|item| item.0);

    let num_items = raw_items.len();
    let mut chapters = Vec::with_capacity(num_items);

    for (idx, (start_ms, explicit_end_ms, title, image, link)) in raw_items.into_iter().enumerate()
    {
        let is_sponsor = is_sponsor_title(&title);
        let fallback_next_start = chapters.get(idx).map(|_| start_ms); // placeholder, recalculated below
        let end_ms = explicit_end_ms
            .or_else(|| {
                // If there's an explicit duration or next chapter
                duration_secs.map(|d| d * 1000)
            })
            .unwrap_or(start_ms);

        chapters.push(PodcastChapter {
            id: format!("{}:json:{}", episode_id, idx),
            episode_id: episode_id.to_string(),
            chapter_index: idx as i32,
            title,
            start_ms,
            end_ms,
            image_url: image,
            link_url: link,
            source: ChapterSource::Podcast20Json.as_str().to_string(),
            is_advertisement: is_sponsor,
        });
    }

    // Fix up end_ms sequentially if not explicitly set
    for idx in 0..chapters.len() {
        if idx + 1 < chapters.len() {
            let next_start = chapters[idx + 1].start_ms;
            if chapters[idx].end_ms <= chapters[idx].start_ms || chapters[idx].end_ms > next_start {
                chapters[idx].end_ms = next_start;
            }
        } else if let Some(d_secs) = duration_secs {
            let total_ms = d_secs * 1000;
            if chapters[idx].end_ms < total_ms {
                chapters[idx].end_ms = total_ms;
            }
        }
    }

    Ok(chapters)
}

/// Asynchronously fetch and validate external JSON chapters from a remote URL.
pub async fn fetch_external_chapters(
    url_str: &str,
    episode_id: &str,
    duration_secs: Option<i64>,
) -> Result<Vec<PodcastChapter>, String> {
    let parsed_url = validate_external_url(url_str)?;

    // Resolve DNS host and check for SSRF prohibited addresses
    if let Some(host) = parsed_url.host_str() {
        let port = parsed_url.port_or_known_default().unwrap_or(80);
        let socket_addrs = format!("{}:{}", host, port)
            .to_socket_addrs()
            .map_err(|e| format!("DNS resolution failed for {}: {}", host, e))?;

        for addr in socket_addrs {
            if is_prohibited_ip(&addr.ip()) {
                return Err(format!(
                    "DNS resolution for {} resolved to prohibited IP: {}",
                    host,
                    addr.ip()
                ));
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {}", e))?;

    let resp = client
        .get(parsed_url.as_str())
        .header(USER_AGENT, "Plethora/1.0 (Podcast Chapters)")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch chapters from {}: {}", url_str, e))?;

    if !resp.status().is_success() {
        return Err(format!("Failed to fetch chapters: HTTP {}", resp.status()));
    }

    // Guard maximum payload size to 5MB
    let text = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read chapters response: {}", e))?;

    if text.len() > 5 * 1024 * 1024 {
        return Err("Chapters JSON exceeds 5MB maximum limit".to_string());
    }

    parse_chapters_json(&text, episode_id, duration_secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ssrf_prohibits_private_and_loopback_ips() {
        // IPv4 loopback
        assert!(validate_external_url("http://127.0.0.1/chapters.json").is_err());
        assert!(validate_external_url("http://127.0.0.2:8080/ep.json").is_err());
        // IPv4 link-local (cloud metadata service)
        assert!(validate_external_url("http://169.254.169.254/latest/meta-data/").is_err());
        // IPv4 RFC1918 private subnets
        assert!(validate_external_url("http://10.0.0.1/chapters.json").is_err());
        assert!(validate_external_url("http://192.168.1.1/chapters.json").is_err());
        assert!(validate_external_url("http://172.16.0.1/chapters.json").is_err());
        // IPv6 loopback
        assert!(validate_external_url("http://[::1]/chapters.json").is_err());
        // Localhost hostnames
        assert!(validate_external_url("http://localhost/chapters.json").is_err());
        assert!(validate_external_url("http://sub.localhost:8000/").is_err());
        assert!(validate_external_url("http://myhost.local/").is_err());
        // Unsupported schemes
        assert!(validate_external_url("file:///etc/passwd").is_err());
        assert!(validate_external_url("ftp://example.com/chapters.json").is_err());

        // Valid public URLs
        assert!(validate_external_url("https://example.com/chapters.json").is_ok());
        assert!(
            validate_external_url("http://podcasts.example.org:8080/ep1/chapters.json").is_ok()
        );
    }

    #[test]
    fn test_parse_chapters_json_valid_payload() {
        let json = r#"{
            "version": "1.2.0",
            "author": "Tech Weekly",
            "title": "Episode 42: The Future",
            "chapters": [
                {
                    "startTime": 0,
                    "title": "Welcome and Intro",
                    "img": "https://example.com/ch1.jpg"
                },
                {
                    "startTime": 120.5,
                    "title": "Sponsor: CloudHost",
                    "url": "https://example.com/sponsor"
                },
                {
                    "startTime": "00:04:30",
                    "title": "Main Topic",
                    "endTime": 600.0
                }
            ]
        }"#;

        let chapters = parse_chapters_json(json, "ep42", Some(600)).unwrap();
        assert_eq!(chapters.len(), 3);

        assert_eq!(chapters[0].title, "Welcome and Intro");
        assert_eq!(chapters[0].start_ms, 0);
        assert_eq!(chapters[0].end_ms, 120500);
        assert_eq!(
            chapters[0].image_url.as_deref(),
            Some("https://example.com/ch1.jpg")
        );
        assert!(!chapters[0].is_advertisement);

        assert_eq!(chapters[1].title, "Sponsor: CloudHost");
        assert_eq!(chapters[1].start_ms, 120500);
        assert_eq!(chapters[1].end_ms, 270000); // 04:30 = 270s = 270000ms
        assert_eq!(
            chapters[1].link_url.as_deref(),
            Some("https://example.com/sponsor")
        );
        assert!(chapters[1].is_advertisement);

        assert_eq!(chapters[2].title, "Main Topic");
        assert_eq!(chapters[2].start_ms, 270000);
        assert_eq!(chapters[2].end_ms, 600000);
        assert!(!chapters[2].is_advertisement);
    }
}
