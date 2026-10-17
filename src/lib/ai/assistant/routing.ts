/**
 * Deterministic context routing (design D3, task 2.1).
 *
 * A *pure* ordered resolver: user intent + typed attachments + viewer
 * snapshot + prior typed references + explicit policy + permissions →
 * one visible route (mode, frozen allowed set, evidence plan). Side-effect
 * free and table-testable, so the visible plan and the actual outgoing
 * evidence cannot diverge.
 *
 * Fixed ordering (design D3 rows 1–7, highest first):
 *   1. authorization/exclusions/constraints — intersect; empty strict set blocks
 *   2. explicit strict choice / strict entry
 *   3. explicit mentions or picker attachments
 *   4. explicit library request / collection chip
 *   5. explicit general-knowledge action
 *   6. selection or typed follow-up reference / source-directed deictic
 *   7. fallback: Chat with authorized optional active context
 *
 * The recognizer is deliberately bounded: explicit UI actions and mentions
 * win; then localized tested patterns; then the documented fallback. No
 * model output can widen an authorized set.
 */

import type {
  ContextPolicy,
  ContextPolicyMode,
  SelectionSnapshot,
  SourceAttachment,
} from "./conversations/types";
import { isStrictPolicy } from "./conversations/types";
import type { AssistantScope } from "./scopes";

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

/** What the viewer currently exposes (already source-appropriate). */
export interface ViewerSnapshot {
  kind: "document" | "video" | "web" | "general";
  /** Real library id when the open source is an authorized document. */
  libraryId?: string;
  /** Ephemeral identity for unsaved viewer content (live capability only). */
  ephemeral?: { ownerToken: string; sourceType: string; localOnly: true };
  title?: string;
  /** Position/selection actually available right now. */
  position?: {
    page?: number;
    cfi?: string;
    sectionId?: string;
    timeSeconds?: number;
    anchor?: string;
  };
  selection?: string;
  /** Live capability token for unsaved viewer content. */
  liveCapability?: { ownerToken: string; sourceType: string };
}

export interface RoutingPermissions {
  /** Every library document currently authorized for this profile. */
  authorizedDocumentIds: ReadonlySet<string>;
  /** Documents the user has AI-excluded (never eligible). */
  excludedDocumentIds?: ReadonlySet<string>;
  /** Collection restriction the user explicitly chose, if any. */
  collectionId?: string;
  /** Documents inside that collection (intersected with authorization). */
  collectionDocumentIds?: ReadonlySet<string>;
  /** Web lookup explicitly allowed for this conversation. */
  webAllowed?: boolean;
}

/** Explicit entry the surface already decided (wins over wording). */
export type ExplicitAction =
  | "ask-library"
  | "ask-document"
  | "explain-selection"
  | "compare-documents"
  | "general-question";

export interface RoutingInput {
  question: string;
  /** Current conversation policy (may be inferred/optional). */
  policy: ContextPolicy;
  /** Visible attachments with their origin/role. */
  attachments: SourceAttachment[];
  /** Mentions typed in the question (raw tokens resolved by the caller). */
  mentionDocumentIds?: string[];
  mentionSectionIds?: string[];
  viewer?: ViewerSnapshot;
  /** Pinned selection captured for this thread (survives highlight loss). */
  pinnedSelection?: SelectionSnapshot;
  /** Source ids from earlier turns usable to resolve "that paper". */
  priorSourceIds?: string[];
  /** Titles by id for label/clarification copy. */
  sourceTitles?: ReadonlyMap<string, string>;
  permissions: RoutingPermissions;
  /** Explicit UI action from the entry point. */
  explicitAction?: ExplicitAction;
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

export type RoutingRule =
  | "authorization" // row 1
  | "strict-choice" // row 2
  | "explicit-mention" // row 3
  | "library-request" // row 4
  | "general-question" // row 5
  | "source-reference" // row 6
  | "fallback"; // row 7

export interface RouteSource {
  /** Library id or ephemeral token owner for this planned source. */
  libraryId?: string;
  ephemeral?: { ownerToken: string; sourceType: string; localOnly: true };
  title?: string;
  attachmentId?: string;
  role: "optional" | "required" | "strict";
  /** Where the source entered the plan. */
  origin: SourceAttachment["origin"];
  /** Which element of the viewer state it came from, if any. */
  viewerPosition?: ViewerSnapshot["position"];
  selectionText?: string;
}

export interface RouteDecision {
  rule: RoutingRule;
  mode: ContextPolicyMode;
  /** Engine scope the mode maps to (never a fourth mode). */
  scope: AssistantScope;
  strict: boolean;
  /** Frozen allowed library ids. `undefined` = no explicit restriction. */
  allowedDocumentIds?: string[];
  /** Web lookup authorized for this turn. */
  webAllowed: boolean;
  /** Sources the plan will actually include. */
  plannedSources: RouteSource[];
  /** True when the plan may consult the wider authorized library. */
  usesLibraryRetrieval: boolean;
  /** True when the plan may extract the active source. */
  usesSourceExtraction: boolean;
  /** Why the route was blocked (no request may be sent). */
  blocked?: { reason: string; recoverable: boolean };
  /** Visible user question the surface must ask before retrieval. */
  clarification?: {
    kind: "ambiguous-source" | "include-source" | "empty-strict-set";
    message: string;
    candidates?: Array<{ id: string; title: string }>;
  };
  /** Human-visible plan summary (what the user sees == what is sent). */
  visiblePlan: string;
}

/* ------------------------------------------------------------------ */
/* Bounded intent recognition                                          */
/* ------------------------------------------------------------------ */

/**
 * Source-deictic patterns per supported locale (de, en, es, fr, ja, zh).
 * Deliberately bounded: a fixed list, no stemming, no model calls.
 */
const SOURCE_DEICTIC_PATTERNS: Record<string, RegExp[]> = {
  en: [/\bthis (page|chapter|section|paragraph|passage|document|paper|article|video|transcript|quote)\b/i, /\bthat (page|chapter|section|paragraph|passage|document|paper|article|video)\b/i, /\bthe (current|above|selected) (page|passage|text|chapter|document)\b/i, /\bhere\b/i],
  de: [/\bdiese[rn]? (seite|kapitel|abschnitt|absatz|passage|dokument|video|zitat)\b/i, /\bder (aktuelle|ausgewählte) (abschnitt|text)\b/i, /\bhier\b/i],
  es: [/\besta (página|página|sección|sección|párrafo|pasaje|documento|cita)\b/i, /\bel (texto|pasaje) (actual|seleccionado)\b/i, /\baquí\b/i],
  fr: [/\bcette (page|section|paragraphe|passage|cit(?:e|ation)|document)\b/i, /\ble (texte|passage) (actuel|sélectionné)\b/i, /\bici\b/i],
  ja: [/(この|その|該当の)(ページ|章|節|段落|文章|ドキュメント|動画)/, /(ここ|上記)/],
  zh: [/(这|那|该)(一)?(页|章|节|段|文章|文档|视频)/, /(这里|上述)/],
};

/** Library-request patterns ("in my library", "where else", "search library"). */
const LIBRARY_REQUEST_PATTERNS: Record<string, RegExp[]> = {
  en: [/\bmy library\b/i, /\b(across|in) (my|the) library\b/i, /\bwhere else\b/i, /\bsearch (my|the) library\b/i, /\bother (documents|papers|books)\b/i],
  de: [/\bmeine bibliothek\b/i, /\bin (meiner|der) bibliothek\b/i, /\bwo sonst\b/i],
  es: [/\bmi biblioteca\b/i, /\ben (mi|la) biblioteca\b/i, /\bdónde más\b/i],
  fr: [/\bma bibliothèque\b/i, /\bdans (ma|la) bibliothèque\b/i, /\boù ailleurs\b/i],
  ja: [/(自分の|マイ)?ライブラリ(から|で|全体|内)?/, /(他に|ほかに)/],
  zh: [/(我的|整个)?(文库|图书馆)/, /(其他地方|别处)/],
};

/** Explicit general-knowledge questions (row 5). */
const GENERAL_KNOWLEDGE_PATTERNS: Record<string, RegExp[]> = {
  en: [/\bfrom (general|your) knowledge\b/i, /\bwithout (using|the) (sources?|documents?)\b/i, /\bnot? (?:using|from) the (pdf|document)\b/i],
  de: [/\bohne (die )?(quelle|dokument)/i, /\ballgemein(es)? wissen\b/i],
  es: [/\bsin (usar )?(el |la )?(documento|fuente)/i, /\bconocimientos? general(es)?\b/i],
  fr: [/\bsans (le|la) (document|source)/i, /\bconnaissances? générales?\b/i],
  ja: [/(資料|文書)を使わず/, /一般知識/],
  zh: [/(不(要)?(使用|用))(文档|资料)/, /一般知识/],
};

/** Which locale pattern set applies; falls back to English. */
export function selectPatternLocale(question: string): string {
  // Cheap script detection so localized patterns still match when the UI
  // locale differs from the question's language.
  if (/[\u3040-\u30ff]/.test(question)) return "ja";
  if (/[\u4e00-\u9fff]/.test(question)) return "zh";
  if (/\b(esta|este|aquí|página|sección|párrafo)\b/i.test(question)) return "es";
  if (/\b(cette|dans ma|ici|paragraphe|section)\b/i.test(question)) return "fr";
  if (/\b(diese|dieser|hier|abschnitt|kapitel|bibliothek)\b/i.test(question)) return "de";
  return "en";
}

/**
 * Match against every supported locale's pattern set. Matching unions the
 * locales on purpose: a question may be typed in any language regardless of
 * the UI locale, and a false positive only ever routes to a *more* explicit
 * policy that the user can see and change.
 */
function matchesAny(question: string, patterns: Record<string, RegExp[]>): boolean {
  for (const set of Object.values(patterns)) {
    for (const pattern of set) {
      pattern.lastIndex = 0;
      if (pattern.test(question)) return true;
    }
  }
  return false;
}

export function isSourceDeictic(question: string): boolean {
  return matchesAny(question, SOURCE_DEICTIC_PATTERNS);
}

export function isLibraryRequest(question: string): boolean {
  return matchesAny(question, LIBRARY_REQUEST_PATTERNS);
}

export function isGeneralKnowledgeRequest(question: string): boolean {
  return matchesAny(question, GENERAL_KNOWLEDGE_PATTERNS);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Intersect a candidate id list with authorization minus exclusions. */
export function intersectAuthorized(
  candidates: readonly string[],
  permissions: RoutingPermissions,
): string[] {
  const authorized = new Set<string>();
  for (const id of candidates) {
    if (!permissions.authorizedDocumentIds.has(id)) continue;
    if (permissions.excludedDocumentIds?.has(id)) continue;
    if (permissions.collectionDocumentIds && !permissions.collectionDocumentIds.has(id)) continue;
    authorized.add(id);
  }
  return [...authorized];
}

function titleFor(id: string, titles?: ReadonlyMap<string, string>): string {
  return titles?.get(id) ?? id;
}

function selectionSource(selection: SelectionSnapshot): RouteSource {
  return {
    libraryId: selection.documentId,
    ephemeral: selection.ephemeral,
    title: selection.title,
    role: "required",
    origin: "selection",
    viewerPosition: selection.locator
      ? {
          page: selection.locator.page,
          cfi: selection.locator.cfi,
          sectionId: selection.locator.sectionId,
          timeSeconds: selection.locator.timeSeconds,
          anchor: selection.locator.anchor,
        }
      : undefined,
    selectionText: selection.originalText,
  };
}

function currentViewerSource(viewer?: ViewerSnapshot): RouteSource | null {
  if (!viewer || viewer.kind === "general") return null;
  // A viewer source is only attachable with a real identity: a library id or
  // a live ephemeral capability. A source with neither fails closed.
  if (!viewer.libraryId && !viewer.ephemeral && !viewer.liveCapability) return null;
  return {
    libraryId: viewer.libraryId,
    ephemeral: viewer.ephemeral,
    title: viewer.title,
    role: "optional",
    origin: "active-view",
    viewerPosition: viewer.position,
  };
}

function summarizePlan(sources: RouteSource[], mode: ContextPolicyMode, webAllowed: boolean): string {
  const labels: string[] = [];
  for (const source of sources) {
    const name = source.title ?? source.libraryId ?? "current source";
    if (source.viewerPosition?.page) {
      labels.push(`${name} · page ${source.viewerPosition.page}`);
    } else if (source.viewerPosition?.sectionId || source.viewerPosition?.cfi) {
      labels.push(`${name} · ${source.viewerPosition.sectionId ?? "section"}`);
    } else if (source.viewerPosition?.timeSeconds !== undefined) {
      const total = Math.floor(source.viewerPosition.timeSeconds);
      const minutes = Math.floor(total / 60).toString().padStart(2, "0");
      const seconds = (total % 60).toString().padStart(2, "0");
      labels.push(`${name} · ${minutes}:${seconds}`);
    } else if (source.selectionText) {
      labels.push(`${name} · selected passage`);
    } else {
      labels.push(name);
    }
  }
  if (mode === "library") {
    return labels.length
      ? `My library (only these sources: ${labels.join(", ")})`
      : "My library";
  }
  if (mode === "document") return labels.length ? `Only these sources: ${labels.join(", ")}` : "This document";
  if (labels.length) return `Current: ${labels.join(", ")}${webAllowed ? " · web lookup allowed" : ""}`;
  return webAllowed ? "General question · web lookup allowed" : "General question";
}

/**
 * Return a copy of `decision` whose `visiblePlan` is derived from its
 * `plannedSources` — the invariant that the shown plan equals what is sent.
 */
function withPlan(
  decision: RouteDecision,
  sources: RouteSource[],
  mode: ContextPolicyMode,
  webAllowed: boolean,
): RouteDecision {
  return {
    ...decision,
    plannedSources: sources,
    webAllowed,
    visiblePlan: summarizePlan(sources, mode, webAllowed),
  };
}

function modeToScope(mode: ContextPolicyMode): AssistantScope {
  return mode === "library" ? "library" : mode === "document" ? "document" : "chat";
}

/* ------------------------------------------------------------------ */
/* The ordered resolver                                                */
/* ------------------------------------------------------------------ */

export function resolveRoute(input: RoutingInput): RouteDecision {
  const {
    question,
    policy,
    attachments,
    permissions,
    viewer,
    pinnedSelection,
    priorSourceIds,
    sourceTitles,
    explicitAction,
  } = input;

  const activeAttachments = attachments.filter(
    (attachment) => attachment.active && !attachment.removedAt,
  );
  const attachedLibraryIds = activeAttachments
    .map((attachment) => attachment.libraryId)
    .filter((id): id is string => Boolean(id));
  const viewerSource = currentViewerSource(viewer);
  const locale = selectPatternLocale(question);
  void locale;

  /**
   * Explicit library identities the surface already put in front of the user:
   * active attachments plus the viewer's own source when it has a real
   * library id. The viewer's ephemeral content is handled separately and
   * never masquerades as a library document.
   */
  const explicitlyAttachedOrViewerIds = (): string[] => {
    const ids = [...attachedLibraryIds];
    if (viewerSource?.libraryId && !ids.includes(viewerSource.libraryId)) {
      ids.push(viewerSource.libraryId);
    }
    return ids;
  };

  /* Row 1: authorization, exclusions, constraints ------------------- */

  // A strict policy must carry a non-empty allowed set; an empty or fully
  // unauthorized strict set blocks instead of silently widening (spec:
  // "empty strict subset does not become a whole-library query").
  if (isStrictPolicy(policy) && policy.mode !== "auto") {
    const declared = policy.allowedDocumentIds;
    if (policy.mode === "document" || policy.mode === "library") {
      if (declared && declared.length === 0) {
        return blockedDecision({
          rule: "authorization",
          mode: policy.mode,
          reason: "the restricted source set is empty",
          clarification: {
            kind: "empty-strict-set",
            message: "No sources are selected for this restriction. Choose a source or switch to Chat.",
          },
        });
      }
      if (declared) {
        const allowed = intersectAuthorized(declared, permissions);
        if (allowed.length === 0) {
          return blockedDecision({
            rule: "authorization",
            mode: policy.mode,
            reason: "every selected source is unavailable, excluded or unauthorized",
            clarification: {
              kind: "empty-strict-set",
              message: "The selected sources are no longer available. Choose other sources or switch to Chat.",
            },
          });
        }
      }
    }
  }

  /* Row 2: explicit strict choice / strict entry --------------------- */

  const strictLock = isStrictPolicy(policy) && policy.mode !== "auto";
  if (explicitAction === "ask-document" || (strictLock && policy.mode === "document")) {
    const declared =
      policy.allowedDocumentIds && policy.allowedDocumentIds.length > 0
        ? policy.allowedDocumentIds
        : explicitlyAttachedOrViewerIds();
    const allowed = intersectAuthorized(declared, permissions);
    if (allowed.length === 0) {
      return blockedDecision({
        rule: "strict-choice",
        mode: "document",
        reason: "no authorized document is available for this strict document request",
        clarification: {
          kind: "empty-strict-set",
          message: "This document is unavailable. Choose another source or switch to Chat.",
        },
      });
    }
    // Out-of-set mention: prompt a visible restriction change; never widen.
    const mentioned = input.mentionDocumentIds ?? [];
    const outOfSet = mentioned.filter((id) => !allowed.includes(id));
    if (outOfSet.length) {
      return {
        ...baseDecision("strict-choice", "document", allowed),
        // No request may be sent until the user resolves the restriction.
        blocked: {
          reason: "a mentioned source is outside the current restriction",
          recoverable: true,
        },
        usesLibraryRetrieval: false,
        usesSourceExtraction: true,
        clarification: {
          kind: "include-source",
          message: `This question mentions ${outOfSet
            .map((id) => titleFor(id, sourceTitles))
            .join(", ")} outside the current restriction. Include it explicitly to proceed.`,
          candidates: outOfSet.map((id) => ({ id, title: titleFor(id, sourceTitles) })),
        },
        visiblePlan: summarizePlan(
          [
            ...allowed.map((id) => ({
              libraryId: id,
              role: "strict" as const,
              origin: "history" as const,
              title: titleFor(id, sourceTitles),
            })),
            // The visible plan mentions the out-of-set source so the user can
            // act on the clarification; it is NOT in the sent evidence yet.
            ...outOfSet.map((id) => ({
              libraryId: id,
              role: "optional" as const,
              origin: "mention" as const,
              title: `${titleFor(id, sourceTitles)} (needs Include)`,
            })),
          ],
          "document",
          false,
        ),
      };
    }
    const sources = allowed.map<RouteSource>((id) => {
      const attached = activeAttachments.find((attachment) => attachment.libraryId === id);
      return {
        libraryId: id,
        title: titleFor(id, sourceTitles),
        attachmentId: attached?.attachmentId,
        role: "strict",
        origin: attached?.origin ?? "history",
        selectionText: attached?.locator?.quote,
      };
    });
    return {
      ...withPlan(
        baseDecision("strict-choice", "document", allowed),
        [...sources, ...(pinnedSelection ? [selectionSource(pinnedSelection)] : [])],
        "document",
        false,
      ),
      usesSourceExtraction: true,
    };
  }

  /* Row 3: explicit mentions or picker attachments ------------------- */

  const explicitIds = explicitlyAttachedOrViewerIds();
  const mentioned = input.mentionDocumentIds ?? [];
  if (mentioned.length || explicitIds.length > 1) {
    const union = intersectAuthorized([...mentioned, ...explicitIds], permissions);
    if (union.length === 0) {
      // A mention outside authorization must not expand to the library.
      return blockedDecision({
        rule: "explicit-mention",
        mode: "library",
        reason: mentioned.length
          ? "the mentioned sources are not authorized for this profile"
          : "the attached sources are no longer available",
        clarification: {
          kind: "include-source",
          message: mentioned.length
            ? "The mentioned source is not available in your library. Pick another source or ask without it."
            : "The attached sources are unavailable. Choose another source.",
          candidates: mentioned.map((id) => ({ id, title: titleFor(id, sourceTitles) })),
        },
      });
    }
    const oneSource = union.length === 1;
    const mode: ContextPolicyMode = oneSource ? "document" : "library";
    const sources = union.map<RouteSource>((id) => {
      const attached = activeAttachments.find((attachment) => attachment.libraryId === id);
      return {
        libraryId: id,
        title: titleFor(id, sourceTitles),
        attachmentId: attached?.attachmentId,
        role: "required",
        origin: attached?.origin ?? "mention",
      };
    });
    if (pinnedSelection) sources.unshift(selectionSource(pinnedSelection));
    const webAllowed = Boolean(permissions.webAllowed && policy.webAllowed);
    return {
      ...withPlan(baseDecision("explicit-mention", mode, union), sources, mode, webAllowed),
      // A single explicit source is strictly extracted; a multi-source union
      // may retrieve within the frozen set.
      usesSourceExtraction: true,
      usesLibraryRetrieval: union.length > 1,
    };
  }

  /* Row 4: explicit library request, My library entry, collection ---- */

  if (explicitAction === "ask-library" || isLibraryRequest(question) || (policy.mode === "library" && policy.origin === "explicit")) {
    const allowed =
      policy.allowedDocumentIds && policy.allowedDocumentIds.length
        ? intersectAuthorized(policy.allowedDocumentIds, permissions)
        : permissions.collectionDocumentIds
          ? intersectAuthorized([...permissions.collectionDocumentIds], permissions)
          : undefined;
    if (allowed && allowed.length === 0) {
      return blockedDecision({
        rule: "library-request",
        mode: "library",
        reason: "the restricted collection/library subset is empty",
        clarification: {
          kind: "empty-strict-set",
          message: "That collection has no available sources. Choose another collection or switch to Chat.",
        },
      });
    }
    const webAllowed = Boolean(permissions.webAllowed && policy.webAllowed);
    return {
      ...withPlan(
        baseDecision("library-request", "library", allowed),
        pinnedSelection ? [selectionSource(pinnedSelection)] : [],
        "library",
        webAllowed,
      ),
      usesLibraryRetrieval: true,
      usesSourceExtraction: false,
    };
  }

  /* Row 5: explicit general-knowledge question ----------------------- */

  if (explicitAction === "general-question" || isGeneralKnowledgeRequest(question)) {
    const webAllowed = Boolean(permissions.webAllowed && policy.webAllowed);
    return {
      // General knowledge needs no source extraction or retrieval, but may use
      // authorized optional context when it resolves the topic.
      ...withPlan(baseDecision("general-question", "chat", undefined), [], "chat", webAllowed),
      usesLibraryRetrieval: false,
      usesSourceExtraction: false,
    };
  }

  /* Row 6: selection or typed follow-up reference -------------------- */

  if (explicitAction === "explain-selection" || pinnedSelection || (viewerSource && isSourceDeictic(question))) {
    if (pinnedSelection) {
      return {
        ...withPlan(
          baseDecision("source-reference", "document", pinnedSelection.documentId ? [pinnedSelection.documentId] : undefined),
          [
            selectionSource(pinnedSelection),
            ...(viewerSource && viewerSource.libraryId !== pinnedSelection.documentId ? [viewerSource] : []),
          ],
          "document",
          false,
        ),
        usesSourceExtraction: true,
      };
    }
    if (viewerSource) {
      return {
        ...withPlan(
          baseDecision("source-reference", "document", viewerSource.libraryId ? [viewerSource.libraryId] : undefined),
          [viewerSource],
          "document",
          false,
        ),
        usesSourceExtraction: true,
      };
    }
  }

  if (explicitAction === "compare-documents" && explicitIds.length > 1) {
    const union = intersectAuthorized(explicitIds, permissions);
    return {
      ...withPlan(
        baseDecision("explicit-mention", "library", union),
        union.map((id) => ({
          libraryId: id,
          title: titleFor(id, sourceTitles),
          role: "required" as const,
          origin: "picker" as const,
        })),
        "library",
        false,
      ),
      usesSourceExtraction: true,
    };
  }

  // A deictic question with no resolvable source asks a short clarification
  // rather than guessing a target among prior sources.
  if (isSourceDeictic(question) && !viewerSource && !pinnedSelection) {
    const candidates = (priorSourceIds ?? []).filter((id) => permissions.authorizedDocumentIds.has(id));
    if (candidates.length > 1) {
      return blockedDecision({
        rule: "source-reference",
        mode: "chat",
        reason: "the question refers to an earlier source but is ambiguous",
        clarification: {
          kind: "ambiguous-source",
          message: "Which source should I use?",
          candidates: candidates.map((id) => ({ id, title: titleFor(id, sourceTitles) })),
        },
      });
    }
    if (candidates.length === 1) {
      return {
        ...withPlan(
          baseDecision("source-reference", "document", [candidates[0]]),
          [{
            libraryId: candidates[0],
            title: titleFor(candidates[0], sourceTitles),
            role: "required",
            origin: "history",
          }],
          "document",
          false,
        ),
        usesSourceExtraction: true,
      };
    }
    // No resolvable source: keep the draft, ask, never search implicitly.
    return blockedDecision({
      rule: "source-reference",
      mode: "chat",
      reason: "the question refers to a source that is not resolvable",
      clarification: {
        kind: "ambiguous-source",
        message: "I could not tell which source you mean. Open a document or attach one to this conversation.",
      },
    });
  }

  /* Row 7: fallback --------------------------------------------------- */

  {
    const optionalContext = viewerSource && viewerSource.libraryId
      ? intersectAuthorized([viewerSource.libraryId], permissions)
      : [];
    const includeViewer = viewerSource && (viewerSource.libraryId ? optionalContext.length > 0 : true);
    const webAllowed = Boolean(permissions.webAllowed && policy.webAllowed);
    return {
      // Chat does not search the library implicitly; optional active context
      // is the only material included.
      ...withPlan(
        baseDecision("fallback", "chat", optionalContext.length ? optionalContext : undefined),
        includeViewer && viewerSource ? [viewerSource] : [],
        "chat",
        webAllowed,
      ),
      usesLibraryRetrieval: false,
      usesSourceExtraction: Boolean(includeViewer),
    };
  }
}

/* ------------------------------------------------------------------ */
/* Decision builders                                                   */
/* ------------------------------------------------------------------ */

function baseDecision(
  rule: RoutingRule,
  mode: ContextPolicyMode,
  allowedDocumentIds: string[] | undefined,
): RouteDecision {
  const sources: RouteSource[] = [];
  return {
    rule,
    mode,
    scope: modeToScope(mode),
    strict: mode === "document" || mode === "library",
    allowedDocumentIds,
    webAllowed: false,
    plannedSources: sources,
    usesLibraryRetrieval: false,
    usesSourceExtraction: false,
    visiblePlan: summarizePlan(sources, mode, false),
  };
}

function blockedDecision(options: {
  rule: RoutingRule;
  mode: ContextPolicyMode;
  reason: string;
  clarification: RouteDecision["clarification"];
}): RouteDecision {
  return {
    ...baseDecision(options.rule, options.mode, undefined),
    blocked: { reason: options.reason, recoverable: true },
    clarification: options.clarification,
    visiblePlan: options.clarification?.message ?? options.reason,
  };
}

