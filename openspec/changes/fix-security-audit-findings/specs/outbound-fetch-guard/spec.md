## ADDED Requirements

### Requirement: The private-network guard resolves DNS
The shared URL validation helper SHALL resolve the hostname and reject the URL if ANY resolved IP address is private, loopback, link-local, unspecified, or an IPv4-mapped IPv6 address, in addition to literal-address checks. Resolution results SHALL be cached briefly (≤60s) to keep batch imports fast.

#### Scenario: Public name resolving to loopback is rejected
- **WHEN** a URL's hostname is a public DNS name that resolves to `127.0.0.1` or an RFC1918 address
- **THEN** the guard rejects the fetch before any connection

#### Scenario: IPv4-mapped IPv6 literal is rejected
- **WHEN** a URL targets `http://[::ffff:127.0.0.1]:8080/`
- **THEN** the guard rejects it

### Requirement: Redirect hops are re-validated
Every URL-fetching code path SHALL re-validate each redirect target against the private-network guard before following it, using the shared redirect policy.

#### Scenario: Public URL redirecting to LAN is refused
- **WHEN** a validated public URL responds with a redirect to `http://192.168.1.1/admin`
- **THEN** the redirect is not followed and a typed error surfaces

### Requirement: All fetch paths use the guard
The guard SHALL be applied on every backend fetch path: article/document URL fetches, page previews, RSS feed fetches, podcast feed and audio fetches (subscribe, refresh, resolve, download, transcribe), enrichment-time readable-content fetches, and the loopback web proxy. The Vercel transcript function SHALL validate `videoId` against `^[a-zA-Z0-9_-]{11}$` (or equivalent safe charset) on every input branch before building URLs.

#### Scenario: Podcast feed pointing at internal service is refused
- **WHEN** a podcast subscription URL targets `http://169.254.169.254/...` or an internal host
- **THEN** the subscription fetch is rejected with a typed error and nothing is fetched

#### Scenario: Enrichment fetch of a private URL is refused
- **WHEN** background document enrichment runs for a saved page whose URL is a private/loopback address
- **THEN** the readable-content fetch is skipped with a typed error instead of fetched

#### Scenario: Transcript function rejects malformed videoId
- **WHEN** `/api/youtube/transcript` receives `videoId=..%2F..%2Fadmin`
- **THEN** the function responds `400` without contacting the VPS relay

### Requirement: Guard failures are per-item and typed
Guard rejections SHALL produce typed per-item errors that the UI surfaces as "address not allowed", and SHALL NOT abort an entire batch import when a single item has a disallowed URL.

#### Scenario: Batch import continues past one bad URL
- **WHEN** an import batch contains one item whose URL fails the guard
- **THEN** the other items import normally and the bad item shows a per-item error
