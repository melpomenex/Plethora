## MODIFIED Requirements

### Requirement: X thread retrieval uses the proven provider pipeline with a live fallback
The system SHALL retrieve X/Twitter threads using the provider order proven by `xcom.py`, adapted into Plethora's Rust architecture with the live fallback already present:
1. ThreadReaderApp: `GET /api/v0/ping/{id}.json` to resolve the root id; `GET /api/v0/thread/{id}.json` JSON contract when available (compat probe); `GET /thread/{root}.html` HTML unroll (the live path; `xcom.py` lacks this fallback and SHALL NOT be regressed by this change).
2. X GraphQL `TweetResultByRestId` (guest-token auth) for single-post fallback and enrichment.
3. Syndication (`cdn.syndication.twimg.com/tweet-result`) as the last single-post fallback.

The implementation SHALL continue to run in Rust (no shelling out to Python), since `xcom.py` is a behavioral reference, not the runtime.

#### Scenario: Multi-post thread retrieved via ThreadReaderApp HTML
- **WHEN** a user opens a valid X thread URL for a thread that exists on ThreadReaderApp
- **THEN** the thread SHALL be retrieved in author/post order with all posts' text and media, and the `sourceKind` SHALL be `"threadreader"`

#### Scenario: Single post retrieved via GraphQL/syndication fallback
- **WHEN** the user opens a valid single X post URL (no ThreadReaderApp unroll)
- **THEN** the post SHALL be retrieved as a single-post thread via the GraphQL/syndication fallback, with `sourceKind` `"single"` and a dismissible single-post notice

#### Scenario: ThreadReaderApp unavailable does not break retrieval
- **WHEN** ThreadReaderApp returns an error but the post itself is retrievable
- **THEN** the system SHALL fall back to single-post retrieval and SHALL present the result rather than failing outright

### Requirement: URL normalization and root identification
The system SHALL normalize common X URL formats and identify the root post of a thread. At minimum: optional scheme, `www.`/`mobile.` subdomains, `x.com`/`twitter.com`, `/<user>/status/<id>` and `/i/status/<id>`, query parameters, and trailing slashes. Any in-thread post id SHALL resolve to the root post via ThreadReaderApp ping when available. The canonical output URL SHALL be `https://x.com/<screen_name>/status/<root_id>`.

#### Scenario: URL variants resolve
- **WHEN** the user provides `https://twitter.com/user/status/123`, `http://mobile.twitter.com/user/status/123?x=y`, `https://x.com/user/status/123/`, or `https://x.com/i/status/123`
- **THEN** the same tweet id SHALL be extracted and the thread SHALL be retrieved

#### Scenario: In-thread id resolves to root
- **WHEN** the user provides a URL to a mid-thread post
- **THEN** the system SHALL resolve the root post and retrieve the full thread (when ThreadReaderApp has it)

#### Scenario: Invalid URL
- **WHEN** the URL contains no recognizable tweet id
- **THEN** the system SHALL return a typed `invalid_url` error and SHALL NOT invoke any provider

### Requirement: Typed, user-friendly error states
The system SHALL distinguish useful error cases and present user-friendly messages without exposing raw internal exceptions: invalid URL; deleted/private/restricted post (`thread_unavailable`); authentication/API credentials missing; provider rate limit (`rate_limited`); upstream provider unavailable (`thread_reader_unavailable`/`network_error`); thread genuinely inaccessible. The frontend SHALL map the backend's serialized error `type` to the intended title/detail copy — fixing the current camelCase-vs-snake_case mismatch.

#### Scenario: Error type maps to intended copy
- **WHEN** the backend returns `{"type":"thread_unavailable","message":"Tweet not found or restricted in GraphQL"}`
- **THEN** the UI SHALL show the `threadUnavailable` title/detail copy (not the generic fallback), with the backend message as detail

#### Scenario: Deleted/private post
- **WHEN** the post is deleted, private, or restricted
- **THEN** the UI SHALL show a clear "thread not available / post not found or restricted" state with the typed message, and a Retry/Open-on-X affordance

#### Scenario: Rate limit
- **WHEN** a provider returns HTTP 429
- **THEN** the UI SHALL show a "rate limited" state rather than a generic failure

#### Scenario: No raw exceptions as primary UX
- **WHEN** any retrieval error occurs
- **THEN** the primary user-facing surface SHALL be the typed, friendly error; raw internal exception text SHALL appear only as secondary detail, never as the main message

### Requirement: Retrieval preserves thread structure
The system SHALL preserve author/post ordering, per-post text (including paragraph breaks), media, quoted-post references where retrieved, and the metadata needed by Plethora's X viewer (`TwitterThread` shape: id, rootId, rootUrl, author, title, posts, totalPosts, htmlContent, structuredText, sourceKind).

#### Scenario: Order and text preserved
- **WHEN** a thread is retrieved
- **THEN** posts SHALL appear in the author's authored order with text intact (paragraph breaks preserved), and the viewer SHALL render the complete thread

### Requirement: Fallback providers are transparent
If a fallback provider is used (e.g. single-post fallback when ThreadReaderApp lacks a thread), the system SHALL handle it transparently: the thread SHALL still be usable for reading/AI, and the single-post fallback SHALL be indicated to the user with a dismissible notice (as the viewer already does), not silently or as an error.

#### Scenario: Single-post fallback is indicated, not hidden
- **WHEN** only a single post is retrievable and no thread unroll exists
- **THEN** the viewer SHALL show the post with the existing dismissible "showing this single post" notice, and the thread SHALL remain usable