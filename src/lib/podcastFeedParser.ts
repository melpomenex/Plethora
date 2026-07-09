/**
 * Client-side podcast RSS fetch + parse helpers (browser / PWA mode).
 *
 * Podcasts and RSS articles share the same XML feed format; the generic
 * `parseFeed`/`parseRSSItem` parser in `src/api/rss.ts` already extracts
 * enclosure audio (the bit podcasts need). This module:
 *   - fetches the feed XML via the same direct→CORS-proxy chain used for RSS,
 *   - maps the generic `Feed`/`FeedItem` into the podcast `PodcastFeed`/
 *     `PodcastEpisode` wire shapes (camelCase) and the IndexedDB record shapes
 *     (snake_case).
 *
 * Used by the browser backend (`src/lib/browser-backend.ts`) so podcasts work
 * on the PWA / Web App the same way RSS subscriptions already do.
 */

// `Feed`/`FeedItem` are used only as types here — importing them as type-only
// (erased at compile time) keeps this module free of a static runtime edge
// back into `../api/rss`, which would otherwise close a circular import
// (browser-backend → podcastFeedParser → rss → tauri → browser-backend) and
// surface as an "Importing a module script failed." runtime error when the
// RSS view chunk loads. `parseFeed` is pulled lazily at call time below.
import type { Feed, FeedItem } from '../api/rss';
import type { PodcastFeedRecord, PodcastEpisodeRecord } from './database';

// Same proxy chain as fetch_rss_feed_url / fetch_url_content in browser-backend.ts.
const CORS_PROXIES = [
    null, // direct first (works for CORS-enabled hosts)
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest=',
];

/**
 * Fetch a podcast feed's raw XML text. Tries a direct fetch first, then falls
 * back through the CORS-proxy chain. Throws if every attempt fails.
 */
export async function fetchPodcastFeedXml(feedUrl: string): Promise<string> {
    let lastError: Error | null = null;

    for (const proxy of CORS_PROXIES) {
        const url = proxy ? proxy + encodeURIComponent(feedUrl) : feedUrl;
        try {
            const response = await fetch(url);
            if (response.ok) {
                const text = await response.text();
                if (text) return text;
            }
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
        }
    }

    throw new Error(
        `Failed to fetch podcast feed after trying direct + CORS proxies. Last error: ${lastError?.message ?? 'unknown'}`,
    );
}

/**
 * Fetch and parse a podcast feed. Returns the generic `Feed` (channel + items)
 * or null if the XML could not be parsed as RSS/Atom.
 *
 * `parseFeed` is imported dynamically so this module has no static runtime
 * dependency on `../api/rss` — that would close a circular import
 * (browser-backend → podcastFeedParser → rss → tauri → browser-backend).
 */
export async function fetchAndParsePodcastFeed(feedUrl: string): Promise<Feed | null> {
    const xml = await fetchPodcastFeedXml(feedUrl);
    const { parseFeed } = await import('../api/rss');
    return parseFeed(xml, feedUrl);
}

/**
 * Parse an iTunes duration string into seconds.
 * Accepts "HH:MM:SS", "MM:SS", plain seconds, and ".mmm" fractional suffixes.
 * Mirrors `parse_itunes_duration` in src-tauri/src/podcast/parser.rs.
 */
export function parseItunesDuration(s: string | undefined | null): number | null {
    if (!s) return null;
    const trimmed = s.trim();
    if (!trimmed) return null;

    // Strip an optional fractional part before integer/timecode parsing
    // (e.g. "3600.123" → 3600, "01:02:03.5" → parse the "01:02:03" part).
    const base = trimmed.split('.')[0];

    if (base !== '') {
        const asSec = Number(base);
        if (Number.isFinite(asSec) && trimmed.indexOf(':') === -1) {
            return Math.floor(asSec);
        }
    }

    const parts = trimmed.split(':');
    if (parts.length === 2) {
        const mins = Number(parts[0]);
        const secs = Number(parts[1]);
        if (Number.isFinite(mins) && Number.isFinite(secs)) {
            return Math.floor(mins * 60 + secs);
        }
    } else if (parts.length === 3) {
        const hours = Number(parts[0]);
        const mins = Number(parts[1]);
        const secs = Number(parts[2]);
        if (Number.isFinite(hours) && Number.isFinite(mins) && Number.isFinite(secs)) {
            return Math.floor(hours * 3600 + mins * 60 + secs);
        }
    }
    return null;
}

function stripHtml(html: string | undefined | null): string {
    if (!html) return '';
    // Cheap HTML→text: drop tags, collapse whitespace. Good enough for a
    // podcast episode description preview (the Rust parser does similar).
    return html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;|&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Deterministic feed id from feed URL, so (re)subscribing/refreshing the same
 * feed is idempotent. Uses the same hash as `generateFeedId` in rss.ts so feed
 * ids stay consistent across RSS and podcast subsystems.
 */
export function podcastFeedId(feedUrl: string): string {
    let hash = 0;
    for (let i = 0; i < feedUrl.length; i++) {
        const char = feedUrl.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash;
    }
    return `podcast-feed-${Math.abs(hash)}`;
}

/**
 * Stable episode id: `${feedId}:${guid || audioUrl}`. Dedupes episodes across
 * refreshes by GUID, falling back to the audio URL when GUID is missing
 * (matches the Rust parser's fallback strategy).
 */
export function podcastEpisodeId(feedId: string, item: FeedItem): string {
    const key = item.guid || item.enclosure?.url || item.link || item.id;
    return `${feedId}:${key}`;
}

/**
 * Map a parsed `Feed` into the IndexedDB `PodcastFeedRecord` (snake_case).
 */
export function parsedFeedToFeedRecord(feed: Feed, now: string): PodcastFeedRecord {
    return {
        id: podcastFeedId(feed.feedUrl),
        title: feed.title,
        description: feed.description ?? null,
        image_url: feed.imageUrl ?? feed.icon ?? null,
        author: null,
        language: feed.language ?? null,
        link: feed.link ?? null,
        feed_url: feed.feedUrl,
        last_fetched: now,
        subscribed_at: now,
        sort_order: 0,
        auto_transcribe: false,
        transcribe_language: null,
    };
}

/** Map a parsed `FeedItem` into the IndexedDB `PodcastEpisodeRecord` (snake_case). */
export function parsedItemToEpisodeRecord(feedId: string, item: FeedItem, now: string): PodcastEpisodeRecord | null {
    const audioUrl = item.enclosure?.url || item.link || '';
    if (!audioUrl) return null; // not a playable podcast item
    return {
        id: podcastEpisodeId(feedId, item),
        feed_id: feedId,
        guid: item.guid ?? null,
        title: item.title,
        description: stripHtml(item.description) || null,
        published_date: item.pubDate || null,
        duration: parseItunesDuration((item as FeedItem & { itunesDuration?: string }).itunesDuration),
        audio_url: audioUrl,
        audio_type: item.enclosure?.type ?? null,
        file_size: item.enclosure?.length ?? null,
        image_url: item.thumbnail ?? null,
        link: item.link || null,
        played: false,
        playback_position: 0,
        date_added: now,
        transcript_text: null,
        transcript_status: 'none',
        transcript_error: null,
        transcribed_at: null,
    };
}

/**
 * Parse a feed and return both the record shapes ready to persist.
 * Items without a playable enclosure/link are dropped.
 */
export function parsedFeedToRecords(feed: Feed): {
    feedRecord: PodcastFeedRecord;
    episodeRecords: PodcastEpisodeRecord[];
} {
    const now = new Date().toISOString();
    const feedId = podcastFeedId(feed.feedUrl);
    const episodeRecords = feed.items
        .map((item) => parsedItemToEpisodeRecord(feedId, item, now))
        .filter((e): e is PodcastEpisodeRecord => e !== null);
    return { feedRecord: parsedFeedToFeedRecord(feed, now), episodeRecords };
}
