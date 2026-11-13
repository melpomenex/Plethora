use crate::commands::ai_key_store::AIKeyStore;
use crate::database::{Repository, StudyPlanResearchRepository};
use crate::models::study_plan_research::{
    SnapshotLocator, StudyPlanResearchResult, StudyPlanResearchSnapshot,
};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;
use tauri::State;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

const SEARCH_ENDPOINT: &str = "https://api.search.brave.com/res/v1/web/search";
const MAX_SEARCH_RESPONSE_BYTES: usize = 256 * 1024;
const MAX_PAGE_BYTES: usize = 1024 * 1024;
const MAX_EXCERPT_CHARS: usize = 12_000;
const MAX_ACTIVE_REQUESTS: usize = 3;

#[derive(Default)]
pub struct StudyPlanResearchRequestState {
    active: Mutex<HashMap<String, CancellationToken>>,
}

impl StudyPlanResearchRequestState {
    async fn register(&self, request_id: &str) -> Result<CancellationToken, String> {
        if request_id.trim().is_empty() || request_id.chars().count() > 80 {
            return Err("The research request identifier is invalid.".to_string());
        }
        let mut active = self.active.lock().await;
        if active.contains_key(request_id) {
            return Err("A request with this identifier is already running.".to_string());
        }
        if active.len() >= MAX_ACTIVE_REQUESTS {
            return Err("Plethora already has three Web Research requests running.".to_string());
        }
        let cancellation = CancellationToken::new();
        active.insert(request_id.to_string(), cancellation.clone());
        Ok(cancellation)
    }

    async fn finish(&self, request_id: &str) {
        self.active.lock().await.remove(request_id);
    }

    async fn cancel(&self, request_id: &str) -> bool {
        if let Some(token) = self.active.lock().await.get(request_id) {
            token.cancel();
            true
        } else {
            false
        }
    }
}

#[derive(Deserialize)]
struct BraveResponse {
    web: Option<BraveWeb>,
}

#[derive(Deserialize)]
struct BraveWeb {
    results: Option<Vec<BraveResult>>,
}

#[derive(Deserialize)]
struct BraveResult {
    title: Option<String>,
    url: Option<String>,
    description: Option<String>,
}

fn research_repository(repo: &Repository) -> StudyPlanResearchRepository {
    StudyPlanResearchRepository::new(repo.pool().clone())
}

/// Searches Brave only after the UI explicitly authorizes the exact query.
/// The request contains no plan, source-library, or learner data.
#[tauri::command]
pub async fn search_study_plan_web(
    query: String,
    approved: bool,
    request_id: String,
    key_store: State<'_, AIKeyStore>,
    requests: State<'_, StudyPlanResearchRequestState>,
) -> Result<Vec<StudyPlanResearchResult>, String> {
    if !approved {
        return Err("Approve the displayed query before searching the web.".to_string());
    }
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 300 {
        return Err("Search queries must contain 1 to 300 characters.".to_string());
    }
    let cancellation = requests.register(&request_id).await?;
    let result = async {
        let api_key = key_store
            .get_key("brave")
            .await
            .map_err(|error| format!("Could not read the Brave Search key: {error}"))?
            .filter(|key| !key.trim().is_empty())
            .ok_or_else(|| "Add a Brave Search API key in Settings before researching.".to_string())?;

        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("Could not start the search request: {error}"))?;
        let mut response = tokio::select! {
            _ = cancellation.cancelled() => return Err("Web Research was cancelled.".to_string()),
            response = client
                .get(SEARCH_ENDPOINT)
                .query(&[("q", query), ("count", "5")])
                .header("Accept", "application/json")
                .header("X-Subscription-Token", api_key)
                .send() => response.map_err(|error| format!("Brave Search request failed: {error}"))?,
        };
        if !response.status().is_success() {
            return Err(format!("Brave Search returned HTTP {}.", response.status()));
        }
        if response
            .content_length()
            .is_some_and(|size| size > MAX_SEARCH_RESPONSE_BYTES as u64)
        {
            return Err("Brave Search returned a response larger than the 256 KB limit.".to_string());
        }
        let mut body = Vec::new();
        loop {
            let chunk = tokio::select! {
                _ = cancellation.cancelled() => return Err("Web Research was cancelled.".to_string()),
                chunk = response.chunk() => chunk.map_err(|error| format!("Could not read Brave Search results: {error}"))?,
            };
            let Some(chunk) = chunk else {
                break;
            };
            if body.len() + chunk.len() > MAX_SEARCH_RESPONSE_BYTES {
                return Err("Brave Search returned a response larger than the 256 KB limit.".to_string());
            }
            body.extend_from_slice(&chunk);
        }
        let parsed: BraveResponse = serde_json::from_slice(&body)
            .map_err(|error| format!("Brave Search returned invalid results: {error}"))?;
        let results = parsed
            .web
            .and_then(|web| web.results)
            .unwrap_or_default()
            .into_iter()
            .filter_map(|item| {
                let url = item.url?;
                if !is_public_web_url(&url) {
                    return None;
                }
                Some(StudyPlanResearchResult {
                    id: format!("wr_{}", uuid::Uuid::new_v4().simple()),
                    title: item.title.unwrap_or_else(|| url.clone()).chars().take(240).collect(),
                    url,
                    snippet: item.description.unwrap_or_default().chars().take(600).collect(),
                })
            })
            .take(5)
            .collect();
        Ok(results)
    }.await;
    requests.finish(&request_id).await;
    result
}

/// Fetches a selected public result, extracts a bounded readable snapshot,
/// and stores it as a candidate on the exact AI Knowledge Only plan version.
#[tauri::command]
pub async fn capture_study_plan_research_snapshot(
    plan_id: String,
    plan_version_id: String,
    query: String,
    url: String,
    title: String,
    repo: State<'_, Repository>,
    request_id: String,
    requests: State<'_, StudyPlanResearchRequestState>,
) -> Result<StudyPlanResearchSnapshot, String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 300 {
        return Err("The original search query is invalid.".to_string());
    }
    if title.trim().is_empty() || title.chars().count() > 240 {
        return Err("The source title is invalid.".to_string());
    }
    if url.chars().count() > 2048 {
        return Err("The source URL is longer than the 2 KB capture limit.".to_string());
    }
    let repository = research_repository(&repo);
    let cancellation = requests.register(&request_id).await?;
    let result = async {
        repository
            .assert_model_only_version(&plan_id, &plan_version_id)
            .await?;
        let (canonical_url, text) = fetch_readable_page(&url, &cancellation).await?;
        let excerpt = take_chars(&text, MAX_EXCERPT_CHARS);
        if excerpt.trim().is_empty() {
            return Err("No readable text was found on this page.".to_string());
        }
        let mut hasher = Sha256::new();
        hasher.update(text.as_bytes());
        let revision_hash = format!("sha256:{:x}", hasher.finalize());
        let parsed = url::Url::parse(&canonical_url)
            .map_err(|error| format!("The final source URL is invalid: {error}"))?;
        let publisher = parsed
            .host_str()
            .unwrap_or("Web source")
            .trim_start_matches("www.")
            .to_string();
        if cancellation.is_cancelled() {
            return Err("Web Research was cancelled.".to_string());
        }
        repository
            .save_candidate(StudyPlanResearchSnapshot {
                id: String::new(),
                plan_id: plan_id.clone(),
                plan_version_id: plan_version_id.clone(),
                query: query.to_string(),
                url: canonical_url,
                title: title.trim().to_string(),
                publisher,
                fetched_at: chrono::Utc::now().to_rfc3339(),
                revision_hash,
                locator: SnapshotLocator {
                    kind: "page".to_string(),
                    value: "Captured readable text".to_string(),
                },
                excerpt,
                status: "candidate".to_string(),
            })
            .await
    }
    .await;
    requests.finish(&request_id).await;
    result
}

#[tauri::command]
pub async fn list_study_plan_research_snapshots(
    plan_id: String,
    plan_version_id: String,
    repo: State<'_, Repository>,
) -> Result<Vec<StudyPlanResearchSnapshot>, String> {
    research_repository(&repo)
        .list_for_version(&plan_id, &plan_version_id)
        .await
}

#[tauri::command]
pub async fn accept_study_plan_research_snapshot(
    snapshot_id: String,
    plan_id: String,
    plan_version_id: String,
    repo: State<'_, Repository>,
) -> Result<StudyPlanResearchSnapshot, String> {
    research_repository(&repo)
        .accept(&snapshot_id, &plan_id, &plan_version_id)
        .await
}

#[tauri::command]
pub async fn cancel_study_plan_research_request(
    request_id: String,
    requests: State<'_, StudyPlanResearchRequestState>,
) -> Result<bool, String> {
    Ok(requests.cancel(&request_id).await)
}

fn is_public_web_url(value: &str) -> bool {
    let Ok(parsed) = url::Url::parse(value) else {
        return false;
    };
    matches!(parsed.scheme(), "http" | "https")
        && parsed.username().is_empty()
        && parsed.password().is_none()
        && crate::security::validate_url_not_private(value).is_ok()
}

async fn fetch_readable_page(
    initial_url: &str,
    cancellation: &CancellationToken,
) -> Result<(String, String), String> {
    tokio::time::timeout(
        Duration::from_secs(12),
        fetch_readable_page_inner(initial_url, cancellation),
    )
    .await
    .map_err(|_| "Source capture exceeded the 12 second time limit.".to_string())?
}

async fn fetch_readable_page_inner(
    initial_url: &str,
    cancellation: &CancellationToken,
) -> Result<(String, String), String> {
    if !is_public_web_url(initial_url) {
        return Err("This result does not point to a public HTTP or HTTPS page.".to_string());
    }
    let mut current = url::Url::parse(initial_url).map_err(|error| error.to_string())?;
    let mut response = None;
    for hop in 0..=2 {
        if !is_public_web_url(current.as_str()) {
            return Err(
                "The source redirected to a private or unsupported destination.".to_string(),
            );
        }
        let addresses = tokio::select! {
            _ = cancellation.cancelled() => return Err("Web Research was cancelled.".to_string()),
            addresses = resolve_public_addresses(&current) => addresses?,
        };
        let mut client_builder = reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .user_agent("Mozilla/5.0 (compatible; PlethoraStudyResearch/1.0)")
            .redirect(reqwest::redirect::Policy::none());
        if let Some(host) = current.host_str().filter(|_| !addresses.is_empty()) {
            client_builder = client_builder.resolve_to_addrs(host, &addresses);
        }
        let client = client_builder
            .build()
            .map_err(|error| format!("Could not start the source fetch: {error}"))?;
        let fetched = tokio::select! {
            _ = cancellation.cancelled() => return Err("Web Research was cancelled.".to_string()),
            fetched = client.get(current.clone()).send() => fetched.map_err(|error| format!("Could not fetch the source page: {error}"))?,
        };
        if fetched.status().is_redirection() {
            if hop == 2 {
                return Err("The source redirected more than twice.".to_string());
            }
            let location = fetched
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|header| header.to_str().ok())
                .ok_or_else(|| "The source returned an invalid redirect.".to_string())?;
            current = current
                .join(location)
                .map_err(|error| format!("The source redirect URL is invalid: {error}"))?;
            continue;
        }
        response = Some(fetched);
        break;
    }
    let mut response =
        response.ok_or_else(|| "Could not follow the source redirect.".to_string())?;
    if !response.status().is_success() {
        return Err(format!("The source returned HTTP {}.", response.status()));
    }
    let media_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !(media_type.contains("text/html") || media_type.contains("text/plain")) {
        return Err("The selected source is not an HTML or plain text page.".to_string());
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_PAGE_BYTES as u64)
    {
        return Err("The source page exceeds the 1 MB capture limit.".to_string());
    }
    let mut body = Vec::new();
    loop {
        let chunk = tokio::select! {
            _ = cancellation.cancelled() => return Err("Web Research was cancelled.".to_string()),
            chunk = response.chunk() => chunk.map_err(|error| format!("Could not read the source page: {error}"))?,
        };
        let Some(chunk) = chunk else {
            break;
        };
        if body.len() + chunk.len() > MAX_PAGE_BYTES {
            return Err("The source page exceeds the 1 MB capture limit.".to_string());
        }
        body.extend_from_slice(&chunk);
    }
    let html = String::from_utf8_lossy(&body).into_owned();
    let text = if media_type.contains("text/plain") {
        html
    } else {
        let mut readability = readable_readability::Readability::new();
        let (content, _) = readability.parse(&html);
        html2text::from_read(content.to_string().as_bytes(), 100)
            .unwrap_or_else(|_| content.text_contents())
    };
    let text = normalize_whitespace(&text);
    if text.chars().count() < 80 {
        return Err(
            "The page did not contain enough readable text to save as evidence.".to_string(),
        );
    }
    Ok((current.to_string(), text))
}

async fn resolve_public_addresses(url: &url::Url) -> Result<Vec<SocketAddr>, String> {
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "The source URL has no supported port.".to_string())?;
    match url
        .host()
        .ok_or_else(|| "The source URL has no host.".to_string())?
    {
        url::Host::Ipv4(ip) if is_public_ipv4(ip) => Ok(Vec::new()),
        url::Host::Ipv6(ip) if is_public_ipv6(ip) => Ok(Vec::new()),
        url::Host::Ipv4(_) | url::Host::Ipv6(_) => {
            Err("This result points to a private or reserved network address.".to_string())
        }
        url::Host::Domain(domain) => {
            let domain = domain.trim_end_matches('.');
            let lower = domain.to_ascii_lowercase();
            if lower == "localhost"
                || lower.ends_with(".localhost")
                || lower.ends_with(".local")
                || lower.ends_with(".internal")
                || lower.ends_with(".home.arpa")
            {
                return Err("Local network names are not allowed as research sources.".to_string());
            }
            let addresses = tokio::net::lookup_host((domain, 0))
                .await
                .map_err(|error| format!("Could not resolve the source host: {error}"))?
                .collect::<Vec<_>>();
            if addresses.is_empty() || addresses.iter().any(|address| !is_public_ip(address.ip())) {
                return Err(
                    "The source host resolved to a private or reserved network address."
                        .to_string(),
                );
            }
            Ok(addresses
                .into_iter()
                .map(|address| SocketAddr::new(address.ip(), port))
                .collect())
        }
    }
}

fn is_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_public_ipv4(address),
        IpAddr::V6(address) => is_public_ipv6(address),
    }
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    !(a == 0
        || a == 10
        || a == 127
        || (a == 100 && (64..=127).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..=31).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 88 && c == 99)
        || (a == 192 && b == 168)
        || (a == 198 && (b == 18 || b == 19))
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 224)
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    (segments[0] & 0xe000) == 0x2000
        && !(segments[0] == 0x2001 && segments[1] == 0x0db8)
        && segments[0] != 0x2002
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn take_chars(value: &str, maximum: usize) -> String {
    value.chars().take(maximum).collect()
}
