import type { Document, Extract, LearningItem, SmartTagDetail } from "../../types/document";

/** Versioned, bounded evidence captured by the browser extension. */
export const BROWSER_CAPTURE_CONTEXT_VERSION = 1;

export const BROWSER_CAPTURE_LIMITS = Object.freeze({
  title: 240,
  url: 2048,
  domain: 160,
  author: 180,
  heading: 180,
  headingPath: 12,
  nearbyText: 1800,
  captionAltText: 1200,
  sourceTags: 24,
  sourceTag: 80,
  totalBytes: 8 * 1024,
});

export type BrowserOrganizationTargetType = "document" | "extract" | "learning-item";
export type BrowserImportItemType = "page" | "extract" | "qa" | "cloze" | "image-occlusion";
export type BrowserOrganizationStatus =
  | "queued"
  | "running"
  | "completed"
  | "needs-review"
  | "failed"
  | "dismissed";
export type BrowserConfidenceBand = "high" | "medium" | "low" | "none";
export type BrowserReviewReason =
  | "no-result"
  | "low-confidence"
  | "conflict"
  | "context-reduced"
  | "source-missing"
  | "classifier-failed"
  | "user-requested";

export interface BrowserCaptureContext {
  version: number;
  sourceUrl?: string;
  domain?: string;
  pageTitle?: string;
  author?: string;
  headingPath?: string[];
  nearbyText?: string;
  captionAltText?: string;
  contentKind?: string;
  sourceDocumentId?: string;
  sourceTags?: string[];
  selector?: string;
  range?: { startOffset?: number; endOffset?: number };
  reduced?: boolean;
  extensionVersion?: string;
}

export interface BrowserCaptureProvenance {
  source: "browser_extension";
  itemType: BrowserImportItemType;
  sourceUrl?: string;
  capturedAt: string;
  sourceDocumentId?: string;
  extensionVersion?: string;
  schemaVersion: number;
}

export interface BrowserOrganizationTagRecord extends SmartTagDetail {
  provenance: SmartTagDetail["provenance"] | "source-inherited";
  confidenceBand?: BrowserConfidenceBand;
  sourceDocumentId?: string;
  fingerprint?: string;
}

export interface BrowserOrganizationMetadata {
  schemaVersion: number;
  status: BrowserOrganizationStatus;
  confidenceBand: BrowserConfidenceBand;
  reviewReason?: BrowserReviewReason;
  fingerprint: string;
  queuedAt?: string;
  startedAt?: string;
  completedAt?: string;
  leaseExpiresAt?: string;
  error?: string;
  contextReduced?: boolean;
  details?: BrowserOrganizationTagRecord[];
  manualTags?: string[];
  dismissedTags?: string[];
  userConfirmedAt?: string;
  dismissedAt?: string;
}

export interface BrowserOrganizationTarget {
  targetType: BrowserOrganizationTargetType;
  targetId: string;
  documentId?: string;
  extractId?: string;
  itemType: BrowserImportItemType;
  title: string;
  author?: string;
  category?: string;
  fileType?: string;
  content: string;
  headings: string[];
  tags: string[];
  sourceTags: string[];
  sourceDocumentId?: string;
  captureContext?: BrowserCaptureContext;
  captureProvenance?: BrowserCaptureProvenance;
  organization?: BrowserOrganizationMetadata;
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ").trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function boundedList(value: unknown, maxItems: number, maxItemLength: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .map((item) => boundedString(item, maxItemLength))
    .filter((item): item is string => Boolean(item));
  return values.length > 0 ? Array.from(new Set(values)).slice(0, maxItems) : undefined;
}

function getDomain(sourceUrl?: string): string | undefined {
  if (!sourceUrl) return undefined;
  try {
    return new URL(sourceUrl).hostname.replace(/^www\./i, "").slice(0, BROWSER_CAPTURE_LIMITS.domain);
  } catch {
    return undefined;
  }
}

/** Normalize legacy/extension input without rejecting the enclosing save. */
export function normalizeBrowserCaptureContext(
  raw: unknown,
  fallback: { sourceUrl?: string; pageTitle?: string; nearbyText?: string } = {},
): BrowserCaptureContext | undefined {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const sourceUrl = boundedString(source.sourceUrl ?? source.source_url ?? fallback.sourceUrl, BROWSER_CAPTURE_LIMITS.url);
  const headingPath = boundedList(
    source.headingPath ?? source.heading_path ?? source.headings,
    BROWSER_CAPTURE_LIMITS.headingPath,
    BROWSER_CAPTURE_LIMITS.heading,
  );
  const context: BrowserCaptureContext = {
    version: Number.isFinite(Number(source.version)) ? Number(source.version) : BROWSER_CAPTURE_CONTEXT_VERSION,
    sourceUrl,
    domain: boundedString(source.domain, BROWSER_CAPTURE_LIMITS.domain) ?? getDomain(sourceUrl),
    pageTitle: boundedString(source.pageTitle ?? source.page_title ?? fallback.pageTitle, BROWSER_CAPTURE_LIMITS.title),
    author: boundedString(source.author, BROWSER_CAPTURE_LIMITS.author),
    headingPath,
    nearbyText: boundedString(source.nearbyText ?? source.nearby_text ?? source.context ?? fallback.nearbyText, BROWSER_CAPTURE_LIMITS.nearbyText),
    captionAltText: boundedString(source.captionAltText ?? source.caption_alt_text ?? source.caption ?? source.alt, BROWSER_CAPTURE_LIMITS.captionAltText),
    contentKind: boundedString(source.contentKind ?? source.content_kind, 80),
    sourceDocumentId: boundedString(source.sourceDocumentId ?? source.source_document_id, 120),
    sourceTags: boundedList(source.sourceTags ?? source.source_tags, BROWSER_CAPTURE_LIMITS.sourceTags, BROWSER_CAPTURE_LIMITS.sourceTag),
    selector: boundedString(source.selector, 240),
    reduced: source.reduced === true,
    extensionVersion: boundedString(source.extensionVersion ?? source.extension_version, 80),
  };

  const range = source.range && typeof source.range === "object" ? source.range as Record<string, unknown> : undefined;
  if (range) {
    const startOffset = Number(range.startOffset ?? range.start_offset);
    const endOffset = Number(range.endOffset ?? range.end_offset);
    if (Number.isFinite(startOffset) || Number.isFinite(endOffset)) {
      context.range = {
        ...(Number.isFinite(startOffset) ? { startOffset: Math.max(0, Math.floor(startOffset)) } : {}),
        ...(Number.isFinite(endOffset) ? { endOffset: Math.max(0, Math.floor(endOffset)) } : {}),
      };
    }
  }

  const withoutEmpty = Object.fromEntries(Object.entries(context).filter(([, value]) => {
    if (value === undefined || value === "") return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  })) as BrowserCaptureContext;
  if (Object.keys(withoutEmpty).length <= 1) return undefined;

  // Keep the context envelope bounded even when a caller supplies many small fields.
  while (serializedByteLength(withoutEmpty) > BROWSER_CAPTURE_LIMITS.totalBytes) {
    if (withoutEmpty.captionAltText) {
      withoutEmpty.captionAltText = withoutEmpty.captionAltText.slice(0, Math.max(0, withoutEmpty.captionAltText.length - 200));
    } else if (withoutEmpty.nearbyText) {
      withoutEmpty.nearbyText = withoutEmpty.nearbyText.slice(0, Math.max(0, withoutEmpty.nearbyText.length - 300));
    } else if (withoutEmpty.sourceTags?.length) {
      withoutEmpty.sourceTags = withoutEmpty.sourceTags.slice(0, -1);
    } else if (withoutEmpty.headingPath?.length) {
      withoutEmpty.headingPath = withoutEmpty.headingPath.slice(0, -1);
    } else {
      withoutEmpty.reduced = true;
      break;
    }
    withoutEmpty.reduced = true;
  }
  return withoutEmpty;
}

function serializedByteLength(value: unknown): number {
  const text = JSON.stringify(value);
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(text).byteLength;
  return text.length;
}

/** Stable, local-only fingerprint used to coalesce browser retries. */
export function browserOrganizationFingerprint(parts: Array<unknown>): string {
  const input = JSON.stringify(parts);
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `browser-org-v${BROWSER_CAPTURE_CONTEXT_VERSION}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function confidenceBand(confidence: number): BrowserConfidenceBand {
  if (!Number.isFinite(confidence) || confidence <= 0) return "none";
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

export function isNeedsReview(organization?: BrowserOrganizationMetadata): boolean {
  return organization?.status === "needs-review" || organization?.status === "failed";
}

export function rankInheritedSourceTags(sourceTags: string[], childEvidence: string[]): string[] {
  const evidence = childEvidence.join(" ").toLocaleLowerCase();
  return sourceTags.filter((tag) => {
    const normalized = tag.trim().toLocaleLowerCase();
    if (!normalized || normalized.length < 3) return false;
    if (evidence.includes(normalized)) return true;
    const meaningfulWords = normalized.split(/[^a-z0-9]+/i).filter((word) => word.length >= 4);
    return meaningfulWords.length > 0 && meaningfulWords.every((word) => evidence.includes(word));
  });
}

export function targetEvidence(target: BrowserOrganizationTarget): string[] {
  const context = target.captureContext;
  return [
    target.title,
    target.content,
    ...(target.headings || []),
    context?.nearbyText || "",
    context?.captionAltText || "",
    context?.author || "",
    context?.domain || "",
  ].filter(Boolean);
}

export function organizationForCapture(
  target: Pick<BrowserOrganizationTarget, "itemType" | "sourceDocumentId" | "captureContext">,
  content: string,
  tags: string[] = [],
): { captureProvenance: BrowserCaptureProvenance; organization: BrowserOrganizationMetadata; fingerprint: string } {
  const capturedAt = new Date().toISOString();
  const captureProvenance: BrowserCaptureProvenance = {
    source: "browser_extension",
    itemType: target.itemType,
    sourceUrl: target.captureContext?.sourceUrl,
    capturedAt,
    sourceDocumentId: target.sourceDocumentId || target.captureContext?.sourceDocumentId,
    extensionVersion: target.captureContext?.extensionVersion,
    schemaVersion: BROWSER_CAPTURE_CONTEXT_VERSION,
  };
  const fingerprint = browserOrganizationFingerprint([
    target.itemType,
    content,
    target.captureContext?.sourceUrl,
    target.sourceDocumentId,
    tags,
  ]);
  return {
    captureProvenance,
    fingerprint,
    organization: {
      schemaVersion: BROWSER_CAPTURE_CONTEXT_VERSION,
      status: "queued",
      confidenceBand: "none",
      fingerprint,
      queuedAt: capturedAt,
      contextReduced: target.captureContext?.reduced,
    },
  };
}

export function readOrganizationMetadata(value: unknown): BrowserOrganizationMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.fingerprint !== "string" || typeof raw.status !== "string") return undefined;
  return raw as unknown as BrowserOrganizationMetadata;
}

export function readCaptureContext(value: unknown): BrowserCaptureContext | undefined {
  return normalizeBrowserCaptureContext(value);
}

export function extractOrganizationContainer(value: unknown): {
  captureContext?: BrowserCaptureContext;
  organization?: BrowserOrganizationMetadata;
} {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  return {
    captureContext: readCaptureContext(raw.browserCaptureContext ?? raw.browser_capture_context ?? raw.captureContext),
    organization: readOrganizationMetadata(raw.organization),
  };
}

export function withOrganizationContainer(
  existing: unknown,
  updates: { captureContext?: BrowserCaptureContext; organization?: BrowserOrganizationMetadata },
): Record<string, unknown> {
  const base = existing && typeof existing === "object" && !Array.isArray(existing)
    ? { ...(existing as Record<string, unknown>) }
    : {};
  if (updates.captureContext) base.browserCaptureContext = updates.captureContext;
  if (updates.organization) base.organization = updates.organization;
  return base;
}

export function toOrganizationDetails(details: SmartTagDetail[], sourceDocumentId?: string): BrowserOrganizationTagRecord[] {
  return details.map((detail) => ({
    ...detail,
    confidenceBand: confidenceBand(detail.confidence),
    ...(sourceDocumentId ? { sourceDocumentId } : {}),
  }));
}

export function buildDocumentTarget(document: Document): BrowserOrganizationTarget | null {
  const metadata = document.metadata;
  const container = extractOrganizationContainer(metadata);
  if (metadata?.captureProvenance?.source !== "browser_extension" && metadata?.source !== "browser_extension") return null;
  const itemType = metadata?.captureProvenance?.itemType || "page";
  return {
    targetType: "document",
    targetId: document.id,
    documentId: document.id,
    itemType,
    title: document.title,
    author: metadata?.author,
    category: document.category,
    fileType: document.fileType,
    content: document.content || "",
    headings: container.captureContext?.headingPath || [],
    tags: document.tags || [],
    sourceTags: container.captureContext?.sourceTags || [],
    sourceDocumentId: container.captureContext?.sourceDocumentId,
    captureContext: container.captureContext,
    captureProvenance: metadata?.captureProvenance,
    organization: container.organization || metadata?.smartTagDetails?.length
      ? {
          ...(container.organization || {
            schemaVersion: BROWSER_CAPTURE_CONTEXT_VERSION,
            status: "queued",
            confidenceBand: "none",
            fingerprint: browserOrganizationFingerprint([document.id, document.content || ""]),
          }),
          ...(metadata?.smartTagDetails ? { details: metadata.smartTagDetails } : {}),
        }
      : undefined,
  };
}

export function buildExtractTarget(extract: Extract, source?: Document): BrowserOrganizationTarget | null {
  const container = extractOrganizationContainer(extract.selectionContext);
  if (!container.captureContext && source?.metadata?.source !== "browser_extension") return null;
  return {
    targetType: "extract",
    targetId: extract.id,
    documentId: extract.documentId,
    extractId: extract.id,
    itemType: "extract",
    title: extract.pageTitle || source?.title || "Browser extract",
    author: source?.metadata?.author,
    category: extract.category || source?.category,
    fileType: source?.fileType,
    content: extract.content,
    headings: container.captureContext?.headingPath || [],
    tags: extract.tags || [],
    sourceTags: source?.tags || container.captureContext?.sourceTags || [],
    sourceDocumentId: extract.documentId,
    captureContext: container.captureContext,
    organization: container.organization,
  };
}

export function buildLearningItemTarget(item: LearningItem, source?: Document, extract?: Extract): BrowserOrganizationTarget | null {
  const container = extractOrganizationContainer(item.interactionMetadata);
  const extractContainer = extractOrganizationContainer(extract?.selectionContext);
  if (!container.captureContext && !extractContainer.captureContext && source?.metadata?.source !== "browser_extension") return null;
  const itemType = item.interactionMetadata?.interactionType === "image-occlusion"
    ? "image-occlusion"
    : item.itemType.toLowerCase() === "cloze" ? "cloze" : "qa";
  const captureContext = container.captureContext || extractContainer.captureContext;
  return {
    targetType: "learning-item",
    targetId: item.id,
    documentId: item.documentId,
    extractId: item.extractId,
    itemType,
    title: item.question,
    author: source?.metadata?.author,
    category: source?.category,
    fileType: source?.fileType,
    content: [item.question, item.answer, item.clozeText].filter(Boolean).join("\n"),
    headings: captureContext?.headingPath || [],
    tags: item.tags || [],
    sourceTags: source?.tags || captureContext?.sourceTags || [],
    sourceDocumentId: item.documentId || extract?.documentId,
    captureContext,
    organization: container.organization || extractContainer.organization,
  };
}
