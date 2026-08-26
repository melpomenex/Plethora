/**
 * Centralized, versioned constants for the article import pipeline.
 *
 * Everything the scorer, normalizer, sanitizer, and rendered fallback consult
 * lives here so tuning is a one-file change and fixture assertions pin exact
 * behavior. No randomness and no clock inputs anywhere in scoring — the same
 * candidate + page context must always produce the same score.
 */

/** Bump whenever scorer weights/thresholds or normalization semantics change
 * in a way that could alter extraction outcomes. Persisted with each import. */
export const EXTRACTOR_VERSION = 4;

// ──────────────────────────────────────────────────────────────────────────
// Scoring thresholds (design D3)
// ──────────────────────────────────────────────────────────────────────────

/** Score ≥ this ⇒ confidence `high`. */
export const HIGH_THRESHOLD = 70;
/** Score ≥ this ⇒ confidence `medium`. Tuned against the fixture corpus:
 * documentation-style pages with tables/code and clean prose land 40–45;
 * they extract reliably and must not pay the rendered-fallback cost. */
export const MEDIUM_THRESHOLD = 40;
/** Best score below this after any fallback ⇒ typed failure, never a silent
 * garbage import. */
export const ACCEPT_FLOOR = 35;
/** Candidates below this word count are never accepted, regardless of score. */
export const MIN_WORDS = 120;
/** Emergency floor when rendered fallback fails but static extraction is still
 * readable (universal-article-import-pipeline). */
export const EMERGENCY_MIN_WORDS = 80;
/** Minimum score for emergency static acceptance after render failure. */
export const EMERGENCY_ACCEPT_FLOOR = 25;

// Component weights. Each component's raw sub-score is normalized to its
// weight range; the total is clamped to [0, 100].
export const SCORER_WEIGHTS = {
  proseVolume: 25,
  proseQuality: 15,
  linkDensityPenalty: 15,
  chromePenalty: 25,
  structureBonus: 10,
  metadataAgreement: 10,
  completenessPenalty: 10,
} as const;

// ──────────────────────────────────────────────────────────────────────────
// Prose / link-density tuning
// ──────────────────────────────────────────────────────────────────────────

/** Word count at which prose volume earns full marks (log-scaled below it). */
export const PROSE_VOLUME_FULL_WORDS = 1200;
/** Mean paragraph length (words) considered healthy prose. */
export const GOOD_PARAGRAPH_MEAN_WORDS = 12;
/** Linked-character ratio at which the full link-density penalty applies. */
export const LINK_DENSITY_FULL = 0.35;
/** Comma-per-1000-words typical of natural prose (prose-quality signal). */
export const PROSE_COMMA_PER_1000 = 8;
/** Share of text in paragraphs ≥ 15 words that suggests real prose runs. */
export const CONTIGUOUS_PROSE_FULL_RATIO = 0.55;
/** Minimum words in a paragraph for its text to count as contiguous prose. */
export const CONTIGUOUS_PARA_MIN_WORDS = 15;

// ──────────────────────────────────────────────────────────────────────────
// Chrome detection
// ──────────────────────────────────────────────────────────────────────────

/** Generic site-chrome phrases. Weighted hits per 1000 words feed the chrome
 * penalty. Case-insensitive, matched against the candidate's text and link
 * text. Deliberately generic — no publisher names (the Mother Jones case must
 * pass on structural signals alone). */
export const CHROME_LEXICON: readonly string[] = [
  'skip to main content',
  'subscribe',
  'subscription',
  'sign up',
  'sign in',
  'log in',
  'login',
  'register',
  'newsletter',
  'donate',
  'donation',
  'become a member',
  'membership',
  'related',
  'recommended',
  'we recommend',
  'most read',
  'most popular',
  'latest news',
  'trending',
  'read more',
  'share on facebook',
  'share on twitter',
  'share on x',
  'share this article',
  'follow us',
  'follow along',
  'comments',
  'leave a comment',
  'privacy policy',
  'privacy manager',
  'privacy preferences',
  'cookie preferences',
  'cookie settings',
  'terms of service',
  'terms of use',
  'advertise',
  'advertising',
  'sponsored',
  'sponsored content',
  'all rights reserved',
  'reprint this article',
  'view comments',
  'load comments',
  'get our newsletter',
  'get our award-winning',
  'we see you’re using an ad blocker',
  "we see you're using an ad blocker",
  'one quick request',
  'support our journalism',
  'independent journalism',
];

/** Chrome hits per 1000 words at which the full penalty applies. */
export const CHROME_FULL_PER_1000 = 6;
/** A link whose text is ≤ this many words counts as a "tiny link fragment". */
export const TINY_LINK_MAX_WORDS = 4;
/** Tiny fragments at which the full chrome penalty applies. */
export const TINY_LINK_FULL_COUNT = 12;
/** Identical link text repeated ≥ this many times ⇒ treated as chrome block. */
export const REPEATED_LINK_MIN_REPEATS = 4;
/** Trailing node cluster with ≥ this many anchors ⇒ footer-like. */
export const FOOTER_LINK_CLUSTER = 6;
/** Extra chrome penalty per matched signal family (repeated blocks, footer
 * cluster), added before clamping. */
export const CHROME_CLUSTER_EXTRA = 4;

// ──────────────────────────────────────────────────────────────────────────
// Metadata agreement (design D3/D7)
// ──────────────────────────────────────────────────────────────────────────

/** Normalized title similarity ≥ this ⇒ full agreement points. */
export const TITLE_AGREEMENT_FULL = 0.85;
/** Below this similarity the engine title loses to metadata precedence. */
export const TITLE_ENGINE_KEEP = 0.5;

// ──────────────────────────────────────────────────────────────────────────
// Completeness
// ──────────────────────────────────────────────────────────────────────────

/** Candidate words / source words below this ratio on a large source ⇒ full
 * completeness penalty. */
export const COMPLETENESS_MIN_RATIO = 0.2;
/** Source word counts below this are "small"; the completeness penalty only
 * applies to meaningfully larger sources. */
export const COMPLETENESS_SOURCE_MIN_WORDS = 600;

// ──────────────────────────────────────────────────────────────────────────
// Sanitization degeneracy (design D6)
// ──────────────────────────────────────────────────────────────────────────

/** Post-sanitize text < 60% of candidate text ⇒ warning diagnostic. */
export const SANITIZE_WARN_RATIO = 0.6;
/** Post-sanitize text < 25% of candidate text ⇒ `sanitization_degenerate`. */
export const SANITIZE_FAIL_RATIO = 0.25;

// ──────────────────────────────────────────────────────────────────────────
// Image normalization (design D8)
// ──────────────────────────────────────────────────────────────────────────

/** Largest acceptable srcset width; prefer the largest candidate ≤ this. */
export const IMAGE_MAX_WIDTH = 2400;
/** Width/height attributes ≤ this mark a tracking pixel ⇒ rejected. */
export const TRACKING_PIXEL_MAX = 2;
/** Same src appearing ≥ this many times ⇒ chrome/logo ⇒ rejected. */
export const REPEATED_IMAGE_MIN = 3;
/** Lazy-load attribute names probed in order. */
export const LAZY_SRC_ATTRIBUTES: readonly string[] = [
  'data-src',
  'data-lazy-src',
  'data-original',
  'data-ll-src',
] as const;

// ──────────────────────────────────────────────────────────────────────────
// Article asset ingestion
// ──────────────────────────────────────────────────────────────────────────

/** Maximum images ingested per article import. */
export const ARTICLE_ASSET_MAX_COUNT = 64;
/** Maximum bytes per individual article image (matches registry cap). */
export const ARTICLE_ASSET_MAX_BYTES = 10 * 1024 * 1024;
/** Maximum aggregate bytes for all images in one import. */
export const ARTICLE_ASSET_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
/** Parallel remote image fetches during import. */
export const ARTICLE_ASSET_FETCH_CONCURRENCY = 4;

// ──────────────────────────────────────────────────────────────────────────
// URL normalization (design D4)
// ──────────────────────────────────────────────────────────────────────────

/** Conservative tracking-parameter blocklist. Prefix matches cover the
 * utm_* family; exact names are stripped only on an exact key match. */
export const TRACKING_PARAM_EXACT: readonly string[] = [
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'mc_cid',
  'mc_eid',
  'mkt_tok',
  'ref_src',
  'ref_url',
  'igshid',
  'igsh',
  'si',
  'feature',
  'cmpid',
  'cvid',
  'oicd',
  'spm',
  'scm',
  'vero_id',
  '_hsenc',
  '_hsmi',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'utm_cid',
  'utm_reader',
  'utm_social',
  'utm_pub',
  'utm_swu',
  'utm_var',
] as const;

export const TRACKING_PARAM_PREFIXES: readonly string[] = ['utm_'] as const;

// ──────────────────────────────────────────────────────────────────────────
// Fetch / rendered fallback budgets (design D5, D14)
// ──────────────────────────────────────────────────────────────────────────

/** Rendered-capture DOM sampling interval. */
export const STABILITY_SAMPLE_INTERVAL_MS = 250;
/** DOM must be unchanged for this window before capture. */
export const STABILITY_WINDOW_MS = 750;
/** Hard cap on post-load stabilization waiting. */
export const STABILIZE_CAP_MS = 6000;
/** Overall rendered-capture budget (includes navigation). */
export const RENDERED_CAPTURE_BUDGET_MS = 20000;
/** Redirect hops beyond this ⇒ treated as a loop and failed. */
export const MAX_REDIRECT_HOPS = 10;
/** Response bodies larger than this are rejected with a typed error. */
export const FETCH_MAX_BYTES = 15 * 1024 * 1024;
/** Raw-source snapshots larger than this are skipped with a diagnostic. */
export const SNAPSHOT_MAX_BYTES = 5 * 1024 * 1024;
/** Snapshots older than this are removed by the cleanup pass. */
export const SNAPSHOT_MAX_AGE_DAYS = 180;

// ──────────────────────────────────────────────────────────────────────────
// Diagnostics bounds (design D11)
// ──────────────────────────────────────────────────────────────────────────

/** Per-candidate diagnostics records persisted (bounded). */
export const CANDIDATE_DIAGNOSTICS_LIMIT = 4;
/** Max characters for any single diagnostics string field. */
export const DIAGNOSTIC_STRING_CAP = 300;
