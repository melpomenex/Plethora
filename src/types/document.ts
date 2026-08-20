import type { ViewState } from "./readerPosition";
import type { SelectionContext } from "./selection";

// Document types matching the C++ schema
export interface Document {
  id: string;
  title: string;
  filePath: string;
  fileType: "pdf" | "epub" | "markdown" | "html" | "youtube" | "audio" | "video" | "image" | "other";
  content?: string;  // Extracted text content
  contentHash?: string;
  /**
   * Sync manifest identifier for this document's binary file. Set when the
   * document is imported on a device with sync enabled (see documentStore
   * `registerImportedFileSync`), so other devices in the same sync room can
   * discover + pull the file via the FileManifest / FileTransferManager.
   * Absent on documents created before file sync, or when sync is disabled.
   * This is metadata only — it rides the state-sync (localStorage bridge),
   * not the Rust/SQLite schema.
   */
  fileId?: string;
  totalPages?: number;
  currentPage?: number;
  currentScrollPercent?: number;
  currentCfi?: string;
  currentViewState?: ViewState | string;
  positionJson?: string;
  progressPercent?: number;
  category?: string;
  tags: string[];
  dateAdded: string;
  dateModified: string;
  dateLastReviewed?: string;
  extractCount: number;
  learningItemCount: number;
  priorityRating: number;
  prioritySlider: number;
  priorityScore: number;
  /**
   * True once the user has explicitly committed a priority for this document
   * via the priority popup. While false, an explicit slider/rating of 0 is
   * treated as "unset" and resolveDisplaySlider seeds from the rating bucket /
   * neutral midpoint; once true, the slider value (including 0) is the real
   * current priority. Optional for backwards-compat with older cached state.
   */
  priorityExplicitlySet?: boolean;
  isArchived: boolean;
  isFavorite: boolean;
  isDismissed?: boolean;
  /**
   * When true, this document is strictly local-only and excluded from all
   * cloud synchronization, hosted AI pipelines, remote transcription, and cloud TTS.
   */
  isLocalOnly?: boolean;
  /**
   * When true, this document is excluded from all AI pipelines (RAG, summarization, cards, cloud OCR).
   */
  isAiExcluded?: boolean;
  metadata?: DocumentMetadata;
  coverImageUrl?: string;
  coverImageSource?: string;
  nextReadingDate?: string;
  readingCount?: number;
  stability?: number;
  difficulty?: number;
  reps?: number;
  totalTimeSpent?: number;
  consecutiveCount?: number;
  collectionId?: string;
  intervalModifier?: number;
  firstReviewedAt?: string;
}

/** Provenance recorded for imports through the canonical Web Article Import
 *  Pipeline (overhaul-web-article-import). Additive: pre-pipeline documents
 *  simply lack `webArticle`, and older clients restoring a DB that contains
 *  it ignore the unknown JSON. */
export interface WebArticleProvenance {
  originalUrl: string;
  canonicalUrl?: string;
  resolvedUrl: string;
  /** 'defuddle' | 'readability' | 'rendered-defuddle' | 'rendered-readability'
   *  | 'site:<domain>' | 'raw-fallback' | future engines. */
  extractor: string;
  extractionScore: number;
  extractionConfidence: 'high' | 'medium' | 'low' | string;
  extractionVersion: number;
  importedAt: string;
  renderedFallbackUsed?: boolean;
  renderFallbackReason?: string;
  failureReason?: string;
  sourceSnapshot?: {
    path: string;
    sha256: string;
    rawBytes: number;
    gzipBytes: number;
  };
  /** Bounded per-candidate diagnostics (engine/score/confidence/words/…). */
  candidates?: Array<{
    engine: string;
    score: number;
    confidence: string;
    words: number;
    paragraphs: number;
    images: number;
  }>;
  /** Full pipeline diagnostics (stage timings, fetch info, warnings). */
  diagnostics?: unknown;
}

export interface DocumentMetadata {
  author?: string;
  subject?: string;
  keywords?: string[];
  createdAt?: string;
  modifiedAt?: string;
  fileSize?: number;
  language?: string;
  pageCount?: number;
  wordCount?: number;
  collectionId?: string;
  fileId?: string;
  isLocalOnly?: boolean;
  // Web import metadata
  source?: string;
  url?: string;
  originalUrl?: string;
  /** Article-pipeline provenance (see WebArticleProvenance). */
  webArticle?: WebArticleProvenance;
  fetchedAt?: string;
  siteName?: string;
  image?: string;
  favicon?: string;
  fetchMethod?: 'direct' | 'proxy';
  readingTime?: number;
  browserImportMode?: 'text-editor' | 'rich-preview' | 'low-confidence' | 'raw-fallback';
  articleHtml?: string;
  extractedImages?: Array<{
    src: string;
    alt?: string;
  }>;
  // NotebookLM artifact origin
  sourceNotebookId?: string;
  sourceJobId?: string;
  /** Structured JSON preserved from a NotebookLM structured-artifact import
   *  (mind-map, data-table); renders through the structured viewers. */
  structuredContent?: unknown;
  // ArXiv metadata
  arxivId?: string;
  arxivUrl?: string;
  pdfUrl?: string;
  htmlUrl?: string;
  originalFileName?: string;
  // Markdown bundle metadata
  bundleImages?: Record<string, string>; // relative path -> stored filename
  hasBundleImages?: boolean;
  // X / Twitter Thread metadata
  xThread?: TwitterThread;
  /** True while the X thread payload is being fetched (skeleton state). */
  xThreadLoading?: boolean;
  /** Typed retrieval error ({ type, message }) for the native error state. */
  xThreadError?: { type?: string; message?: string };

  // Virtual & Physical Chunking fields
  parentDocumentId?: string;
  chunkIndex?: number;
  totalChunks?: number;
  chunkStartPage?: number;
  chunkEndPage?: number;
  chunkStartSpineIndex?: number;
  chunkEndSpineIndex?: number;
  chunkStartPos?: number;
  chunkEndPos?: number;
  estimatedReadingTimeMins?: number;
}

export interface TwitterAuthor {
  name: string;
  screenName: string;
  avatarUrl?: string | null;
  verified: boolean;
  profileUrl: string;
}

export interface TwitterMedia {
  kind: string;
  mediaUrl: string;
  thumbnailUrl?: string | null;
  altText?: string | null;
  aspectRatio?: number | null;
}

export interface TwitterQuotedPost {
  id: string;
  author: TwitterAuthor;
  text: string;
  media: TwitterMedia[];
  createdAt?: string | null;
  url: string;
}

/** A referenced status id with the @handle embedded in its status-link URL
 *  (`x.com/<user>/status/<id>`), captured from the quoting post's
 *  ThreadReaderApp HTML. Absent on threads persisted before quote-handle
 *  capture. */
export interface TwitterPostRef {
  id: string;
  screenName: string;
}

export interface TwitterPost {
  id: string;
  postIndex: number;
  author: TwitterAuthor;
  text: string;
  fullText: string;
  media: TwitterMedia[];
  quotedPost?: TwitterQuotedPost | null;
  createdAt?: string | null;
  replyCount?: number | null;
  retweetCount?: number | null;
  favoriteCount?: number | null;
  bookmarkCount?: number | null;
  isNoteTweet: boolean;
  url: string;
  /** Status ids referenced by this post (quoted/embedded posts), from the
   *  ThreadReaderApp page; enrichment resolves them into `quotedPost`. */
  refIds?: string[];
  /** URL-derived handles for `refIds` (id → @handle from the status link),
   *  used to attribute quoted posts whose author could not be parsed.
   *  Optional — absent on legacy threads. */
  refHandles?: TwitterPostRef[];
  /** Hashtags parsed from the tweet's `entities` (GraphQL/syndication
   *  enrichment). Optional — absent on TRA-only threads. */
  hashtags?: string[];
  /** @mentions parsed from the tweet's `entities`. Optional. */
  mentions?: TwitterMention[];
  /** URLs parsed from the tweet's `entities` — the `url` is the t.co
   *  shortlink as it appears in `fullText`, `expandedUrl` the real target.
   *  Optional; populated by enrichment/single-post retrieval. */
  expandedUrls?: TwitterExpandedUrl[];
}

export interface TwitterMention {
  screenName: string;
  name?: string;
}

export interface TwitterExpandedUrl {
  url: string;
  expandedUrl: string;
  displayUrl?: string;
}

export interface TwitterThread {
  id: string;
  rootId: string;
  rootUrl: string;
  author: TwitterAuthor;
  title: string;
  posts: TwitterPost[];
  totalPosts: number;
  htmlContent: string;
  structuredText: string;
  createdAt?: string | null;
  /** Retrieval source: "threadreader" | "graphql" | "syndication" | "single". */
  sourceKind?: string;
}

export interface Extract {
  id: string;
  documentId: string;
  content: string;
  pageTitle?: string;
  pageNumber?: number;
  selectionContext?: SelectionContext;
  highlightColor?: string;
  notes?: string;
  progressiveDisclosureLevel: number;
  maxDisclosureLevel: number;
  dateCreated: string;
  dateModified: string;
  tags: string[];
  category?: string;
  learningItems: LearningItem[];
}

export interface LearningItem {
  id: string;
  extractId?: string;
  documentId?: string;
  itemType: "flashcard" | "cloze" | "qa" | "basic";
  question: string;
  answer?: string;
  clozeText?: string;
  clozeRanges?: [number, number][];
  difficulty: 1 | 2 | 3 | 4 | 5;
  interval: number;
  easeFactor: number;
  dueDate: string;
  dateCreated: string;
  dateModified: string;
  lastReviewDate?: string;
  reviewCount: number;
  lapses: number;
  state: "new" | "learning" | "review" | "relearning";
  isSuspended: boolean;
  tags: string[];
  imageAssetIds?: string[];
  firstReviewedAt?: string;
}

export interface Category {
  id: string;
  name: string;
  parentId?: string;
  color?: string;
  icon?: string;
  description?: string;
  dateCreated: string;
  dateModified: string;
  documentCount: number;
  children?: Category[];
}

export interface Annotation {
  id: string;
  documentId: string;
  type: "highlight" | "underline" | "strikeout" | "comment" | "bookmark";
  pageNumber: number;
  content?: string;
  rect?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  color: string;
  dateCreated: string;
  dateModified: string;
}
