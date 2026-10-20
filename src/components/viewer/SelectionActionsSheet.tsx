/**
 * SelectionActionsSheet
 *
 * What a text selection can do on mobile: create an extract, copy, and — when
 * an AI path exists — explain / summarize / simplify / pull key terms / ask a
 * question about it. Built on `MobileContextMenuSheet` so scrim, scroll lock,
 * Escape and safe-area behaviour are the ones the user already knows.
 *
 * The sheet owns the whole AI interaction (running state, streamed output,
 * cancellation) so a host surface only passes the selection and an extract
 * callback. That is what makes it cheap to mount on documents, transcripts and
 * queue articles alike.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";
import {
  ArrowLeft,
  ArrowsClockwise,
  Copy,
  DownloadSimple,
  Lightbulb,
  Sparkle,
} from "@phosphor-icons/react";
import { MobileContextMenuSheet, mobileSheetItemClass } from "../common/MobileContextMenuSheet";
import { copySelectionTextToClipboard } from "./SelectionPopup";
import { useI18n } from "../../lib/i18n";
import { useAiAvailability } from "../../lib/ai/useAiAvailability";
import { useAskLibrary } from "../../lib/ai/useAskLibrary";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  ConceptRelationshipAnalysisOwner,
  EMPTY_PREREQUISITES_MESSAGE,
  acceptRelationshipDraft,
  dismissRelationshipLink,
  discoverRelatedContent,
  editRelationshipLink,
  removeRelationshipLink,
  saveRelationshipDrafts,
  type PrerequisiteConceptResult,
  type RelatedContentResult,
  type RelationshipAnalysisOutcome,
  type RelationshipDraft,
} from "../../lib/ai/concepts/relationships";
import {
  activityText,
  coverageLimitationText,
  evidenceCoverageText,
} from "../../lib/ai/concepts/coverage";
import {
  acceptConceptLink,
  listConceptLinksFor,
  listConceptLinksTargeting,
  type ConceptLink,
} from "../../api/concept-links";
import { CONCEPT_RELATION_TYPES } from "../../api/concept-links";
import type { ChunkLocation } from "../../api/ai-learning";
import { openConceptInKnowledgeGraph } from "../graph/conceptProjection";
import { appleFmWarmup } from "../../lib/ai/apple/foundation";
import { isAppleOsPlatform } from "../../lib/ai/apple/capabilities";
import {
  getOnDeviceRequirementStatus,
  isOnDeviceAiSupportedPlatform,
  requestModelDownload,
  warmUpOnDevicePrompt,
} from "../../lib/ai/onDeviceAI";
import { hasCloudProvider, requestCloudFallback, canOfferCloudRetryForSafety } from "../../lib/ai/provider";
import { formatAIErrorMessage } from "../../lib/ai/errors";
import {
  answerPassage,
  explainPassage,
  keyTermsPassage,
  simplifyPassage,
  summarizePassage,
  type PassageActionOptions,
  type PassageResult,
} from "../../lib/ai/passageAI";
import { LearnThisProposalSheet } from "../learn/LearnThisProposalSheet";
import { TutorSheet } from "../tutor/TutorSheet";
import { openLibrarySource } from "../../utils/openLibrarySource";
import { renderMarkdown } from "../../utils/markdown";
import type { Extract } from "../../api/extracts";
import { useOptionalLanguageLearningHost } from "../../contexts/LanguageLearningHostContext";
import { buildLearnerContext, type ContextLexiconRow } from "../../lib/languageTutor";
import { listLanguageLexicalEntries } from "../../api/languageLexicon";
import type { LanguageKnowledgeState } from "../../types/languageKnowledge";

export type { SelectionAiAction } from "./selectionInteraction/selectionActionRegistry";
import {
  getSelectionActions,
  isAiSelectionAction,
  selectionActionLabelKey,
  type SelectionActionDescriptor,
  type SelectionAiAction,
} from "./selectionInteraction/selectionActionRegistry";
import { recordSelectionActionInvocation } from "./selectionInteraction/selectionActionUsage";

/** Document context for the "Learn this" proposal (task 2.3). */
export interface LearnThisContext {
  documentId?: string;
  documentTitle?: string;
  /** Existing extract the selection belongs to, when there is one. */
  extractId?: string;
  /** Current source content revision (document content hash), when known. */
  sourceRevision?: string;
  /** Selection context payload recorded with provenance. */
  selectionContext?: unknown;
}

export interface SelectionActionsSheetProps {
  open: boolean;
  /** The selected text. */
  text: string;
  /**
   * Passage handed to the model — the selection plus whatever surrounding
   * context the surface has. Defaults to `text`.
   */
  passage?: string;
  /**
   * Run this action straight away and show only its result, skipping the action
   * list. Used by surfaces that already have their own selection menu (the
   * long-press context menu in non-PDF viewers) and just need the result view.
   */
  initialAction?: SelectionAiAction;
  /**
   * Palette library handoff: open directly in the grounded library composer
   * with this question prefilled and focused. Nothing is sent until the user
   * presses Ask.
   */
  initialQuestion?: string;
  /**
   * Passage providing document context for a handoff when there is no
   * selection text (e.g. a summary suggestion for the resume document).
   */
  initialContextPassage?: string;
  onClose: () => void;
  /** Omitted on surfaces with no extract path (e.g. transcripts). */
  onCreateExtract?: (text: string) => Promise<Extract | null> | Promise<void> | void;
  /** Omitted when the surface cannot attach an extract to an AI result. */
  onCreateExtractFromResult?: (text: string) => Promise<Extract | null> | Promise<void> | void;
  /** Document context for the "Learn this" action (task 2.3). */
  learnThis?: LearnThisContext;
  /**
   * Operation identity from the selection controller (V2): completions are
   * reported through `onSettled` so the controller can reject stale ones.
   */
  operationId?: string;
  onSettled?: (operationId: string, outcome: "success" | "failure") => void;
}

const PREVIEW_CHARS = 180;

/**
 * Minimum selection length (in chars) to consider the selection self-contained,
 * needing no surrounding context padding.
 */
export const SELF_CONTAINED_SELECTION_THRESHOLD = 150;

/** Characters of surrounding text kept on each side of a short selection (<150 chars). */
export const SHORT_SELECTION_CONTEXT_CHARS = 300;

/**
 * The passage to send to the model: the selection plus the surrounding text of
 * whatever block it sits in when the selection is short (<150 chars).
 * Self-contained selections (>=150 chars) use the selected text directly to
 * avoid prefill latency. Falls back to the selection alone when no container
 * text is reachable.
 */
export function passageAroundSelection(selection: Selection | null, text: string): string {
  const node = selection?.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  const reflowBlock = element?.closest<HTMLElement>("[data-pdf-reflow-block]") ?? null;
  const container =
    // PDF reflow first: the closest canonical block is the natural context
    // unit AND keeps this cheap. Falling through to the document-content
    // markers below would make `textContent` walk the ENTIRE reflowed
    // document (megabytes on long PDFs) — a main-thread stall on phones
    // every time a selection settles.
    reflowBlock ??
    element?.closest<HTMLElement>(
      "[data-document-content='true'], [data-transcript-scroll='true'], .prose, article, .textLayer"
    ) ??
    // Inside a reader iframe (EPUB spine section, HTML document) the document
    // *is* the content and none of the app's container markers exist. Falling
    // back to the body is only safe there — in the top-level document it would
    // sweep in the app chrome around the reader.
    (element && element.ownerDocument !== document ? element.ownerDocument.body : null);
  const full = container?.textContent?.replace(/\s+/g, " ").trim();
  if (!full) return text;

  const needle = text.replace(/\s+/g, " ").trim();
  const at = full.indexOf(needle);
  if (at < 0) return text;

  // Self-contained selection (paragraph / multiple sentences): send directly without padding
  if (needle.length >= SELF_CONTAINED_SELECTION_THRESHOLD) {
    return needle;
  }

  // In the reflow view a sentence-sized selection is self-defining: padding
  // it with the surrounding paragraph made the AI material (and the cards
  // built from it) cover the whole block even though the user carefully
  // selected one sentence. Only word/phrase selections need context.
  if (reflowBlock && needle.length >= 40) {
    return needle;
  }

  // Short selection: attach bounded local context (the reflow container is
  // one block, so this stays within the paragraph)
  return full.slice(
    Math.max(0, at - SHORT_SELECTION_CONTEXT_CHARS),
    at + needle.length + SHORT_SELECTION_CONTEXT_CHARS
  );
}

/** Safe, short provenance summary for a saved concept link. */
function linkProvenanceSummary(link: ConceptLink): string | null {
  const parts: string[] = [];
  if (link.analysisId) parts.push(`analysis ${link.analysisId}`);
  if (link.provenanceJson) {
    try {
      const value = JSON.parse(link.provenanceJson) as Record<string, unknown>;
      for (const key of ["taskId", "providerId", "modelClass", "policyVersion"]) {
        const field = value[key];
        if (typeof field === "string" && field.trim()) parts.push(field);
      }
    } catch {
      // Malformed legacy provenance is displayed as unknown, never thrown.
    }
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

function SelectionMarkdown({ content }: { content: string }) {  const html = useMemo(() => renderMarkdown(content), [content]);
  const safeHtml = useMemo(
    () =>
      DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
          "strong",
          "em",
          "p",
          "br",
          "code",
          "pre",
          "a",
          "ul",
          "ol",
          "li",
          "h1",
          "h2",
          "h3",
          "h4",
          "h5",
          "h6",
          "blockquote",
          "table",
          "thead",
          "tbody",
          "tr",
          "th",
          "td",
          "hr",
          "div",
          "span",
          "sub",
          "sup",
        ],
        ALLOWED_ATTR: ["href", "class", "target", "rel", "data-language"],
      }),
    [html],
  );
  return (
    <div
      className="prose prose-sm dark:prose-invert max-w-none text-[15px] leading-relaxed text-foreground"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

function runAction(
  action: SelectionAiAction,
  passage: string,
  question: string,
  options: PassageActionOptions
): Promise<PassageResult> {
  switch (action) {
    case "summarize":
      return summarizePassage(passage, options);
    case "simplify":
      return simplifyPassage(passage, options);
    case "keyTerms":
      return keyTermsPassage(passage, options);
    case "ask":
      return answerPassage(question, passage, options);
    case "explain":
    default:
      return explainPassage(passage, options);
  }
}

export function SelectionActionsSheet({
  open,
  text,
  passage,
  initialAction,
  initialQuestion,
  initialContextPassage,
  onClose,
  onCreateExtract,
  onCreateExtractFromResult,
  learnThis,
  operationId,
  onSettled,
}: SelectionActionsSheetProps) {
  const { t } = useI18n();
  const ai = useAiAvailability("prompt");
  const languageHost = useOptionalLanguageLearningHost();
  // "Learn this" ships behind its phase flag (default off) AND the generative
  // requirement (`ai.available`) — task 2.3 gating.
  const aiLearnThisEnabled = useSettingsStore((s) => s.settings.features.aiLearnThis);
  // "Ask library" ships behind its phase flag (default off) AND availability —
  // task 4.10 gating, same pattern as "Learn this".
  const aiLibraryRagEnabled = useSettingsStore((s) => s.settings.features.aiLibraryRag);
  // "Socratic tutor" ships behind its phase flag (default off) AND the
  // generative requirement — task 7.3 gating, same pattern as above.
  const aiSocraticTutorEnabled = useSettingsStore((s) => s.settings.features.aiSocraticTutor);
  // "Prerequisites" analysis flag
  const aiPrerequisitesEnabled = useSettingsStore((s) => s.settings.features.aiPrerequisites);
  // Concept links / related content is INDEPENDENT of prerequisites.
  const aiConceptLinksEnabled = useSettingsStore((s) => s.settings.features.aiConceptLinks);
  const library = useAskLibrary();
  const { reset: resetLibrary } = library;

  const [mode, setMode] = useState<
    "menu" | "asking" | "result" | "library" | "prerequisites" | "related"
  >(initialQuestion ? "library" : "menu");
  const [action, setAction] = useState<SelectionAiAction>("explain");
  const [question, setQuestion] = useState(initialQuestion ?? "");
  const [output, setOutput] = useState("");
  const [result, setResult] = useState<PassageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCloudRetry, setShowCloudRetry] = useState(false);
  const [running, setRunning] = useState(false);
  const [showLearnThis, setShowLearnThis] = useState(false);
  const [showTutor, setShowTutor] = useState(false);
  const [prereqRunning, setPrereqRunning] = useState(false);
  const [prereqError, setPrereqError] = useState<string | null>(null);
  const [prereqResult, setPrereqResult] = useState<RelationshipAnalysisOutcome | null>(null);
  const [savedDraftLinks, setSavedDraftLinks] = useState<Record<string, ConceptLink>>({});
  const [linkActionState, setLinkActionState] = useState<
    Record<string, "saving" | "saved" | "error">
  >({});
  const [savedLinks, setSavedLinks] = useState<ConceptLink[]>([]);
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const linkRetryRef = useRef<Record<string, () => void>>({});
  const [editRelation, setEditRelation] = useState("related-to");
  const [editConfidence, setEditConfidence] = useState(0.8);
  const [relatedRunning, setRelatedRunning] = useState(false);
  const [relatedResult, setRelatedResult] = useState<RelatedContentResult | null>(null);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [downloadState, setDownloadState] = useState<"idle" | "downloadable" | "downloading">(
    "idle"
  );
  const [extractSaveState, setExtractSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [languageContext, setLanguageContext] = useState<ReturnType<typeof buildLearnerContext> | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const relationshipOwnerRef = useRef<ConceptRelationshipAnalysisOwner | null>(null);
  const relatedAbortRef = useRef<AbortController | null>(null);
  const analysisEpochRef = useRef(0);
  // `||`, not `??`: a surface with no reachable surrounding text (EPUB/HTML
  // render in an iframe) passes an empty string, and an empty passage would
  // make every adapter throw `invalid_argument`. A palette handoff may carry
  // no selection at all and supplies its own document-context passage.
  const sourcePassage = (passage || text || initialContextPassage || "").trim();

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setMode("menu");
    setQuestion("");
    setOutput("");
    setResult(null);
    setError(null);
    setShowCloudRetry(false);
    setRunning(false);
    setShowLearnThis(false);
    setShowTutor(false);
    setPrereqRunning(false);
    setPrereqError(null);
    setPrereqResult(null);
    setSavedDraftLinks({});
    setLinkActionState({});
    setSavedLinks([]);
    setEditingLinkId(null);
    setRelatedRunning(false);
    setRelatedResult(null);
    setRelatedError(null);
    analysisEpochRef.current += 1;
    relatedAbortRef.current?.abort();
    relationshipOwnerRef.current?.cancel();
    setExtractSaveState("idle");
    resetLibrary();
  }, [resetLibrary]);

  // Closing the sheet aborts whatever is in flight; a cancelled request must
  // never fall back to the cloud.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // Palette handoff: open directly in the grounded library composer with the
  // question prefilled and focused. The user still presses Ask; no request is
  // started by the handoff itself.
  useEffect(() => {
    if (!open || !initialQuestion) return;
    setMode("library");
    setQuestion(initialQuestion);
  }, [open, initialQuestion]);

  useEffect(() => () => {
    abortRef.current?.abort();
    relatedAbortRef.current?.abort();
    relationshipOwnerRef.current?.cancel();
  }, []);

  // A replacement selection/source invalidates in-flight relationship work.
  useEffect(() => {
    analysisEpochRef.current += 1;
    relationshipOwnerRef.current?.cancel();
    relatedAbortRef.current?.abort();
    setPrereqRunning(false);
    setPrereqResult(null);
    setRelatedRunning(false);
    setRelatedResult(null);
  }, [text, sourcePassage]);

  useEffect(() => {
    let disposed = false;
    const snapshot = languageHost?.snapshot;
    if (!showTutor || !snapshot || snapshot.status !== "ready" || !snapshot.profile) {
      setLanguageContext(null);
      return () => { disposed = true; };
    }
    if (learnThis?.documentId && learnThis.documentId !== snapshot.source.contentId) {
      setLanguageContext(null);
      return () => { disposed = true; };
    }
    void listLanguageLexicalEntries(snapshot.profile.id, { languageTag: snapshot.profile.targetLanguage, offset: 0, limit: 500 })
      .then((page) => {
        if (disposed) return;
        const lexicon: ContextLexiconRow[] = page.items.flatMap((entry) => {
          const state = entry.knowledgeState as LanguageKnowledgeState;
          if (!["new", "encountered", "learning", "familiar", "known", "ignored"].includes(state)) return [];
          return [{ entryId: entry.id, surface: entry.canonicalForm || entry.normalizedForm, lemma: entry.lemma, state: state as any, evidenceCount: entry.activeEvidenceCount + entry.passiveEvidenceCount }];
        });
        setLanguageContext(buildLearnerContext({
          profile: { id: snapshot.profile!.id, targetLanguage: snapshot.profile!.targetLanguage, baseLanguage: snapshot.profile!.baseLanguage },
          lexicon,
          currentSource: { documentId: snapshot.source.contentId, text: sourcePassage },
          budget: { maxItems: 24, maxTextCodeUnits: 1200, includeSourceText: false },
        }));
      })
      .catch(() => { if (!disposed) setLanguageContext(null); });
    return () => { disposed = true; };
  }, [languageHost, learnThis?.documentId, showTutor, sourcePassage]);

  // Speculatively warm up the active on-device model while the user reads the menu.
  useEffect(() => {
    if (!open || !ai.available) return;
    if (isOnDeviceAiSupportedPlatform()) {
      void warmUpOnDevicePrompt().catch(() => {
        // Non-blocking background warmup; silently ignore failure
      });
    }
    if (isAppleOsPlatform()) {
      void appleFmWarmup().catch(() => {
        // Non-blocking background warmup; silently ignore failure
      });
    }
  }, [open, ai.available]);

  // When nothing can run, say whether the on-device model is merely missing.
  useEffect(() => {
    if (!open || ai.loading || ai.available || hasCloudProvider()) {
      setDownloadState("idle");
      return;
    }
    if (!isOnDeviceAiSupportedPlatform()) return;
    let cancelled = false;
    void getOnDeviceRequirementStatus("prompt").then((status) => {
      if (cancelled) return;
      if (status.status === "downloadable" || status.status === "downloading") {
        setDownloadState(status.status);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, ai.loading, ai.available]);

  const start = useCallback(
    (next: SelectionAiAction, nextQuestion = question, cloudOnly = false) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setAction(next);
      setMode("result");
      setOutput("");
      setResult(null);
      setError(null);
      setShowCloudRetry(false);
      setRunning(true);

      void runAction(next, sourcePassage, nextQuestion, {
        signal: controller.signal,
        cloudOnly,
        onChunk: (chunk) => {
          if (controller.signal.aborted) return;
          setOutput((prev) => prev + chunk);
        },
      })
        .then((res) => {
          if (controller.signal.aborted) return;
          setResult(res);
          setOutput(res.text);
          setRunning(false);
          if (operationId) onSettled?.(operationId, "success");
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(formatAIErrorMessage(err));
          setShowCloudRetry(canOfferCloudRetryForSafety(err));
          setRunning(false);
          if (operationId) onSettled?.(operationId, "failure");
        });
    },
    [question, sourcePassage, operationId, onSettled],
  );

  const retryOnCloud = useCallback(async () => {
    const ok = await requestCloudFallback(t(`selectionSheet.${action}`));
    if (!ok) {
      setError(t("aiErrors.safetyBlockedCloudFallbackDenied"));
      setShowCloudRetry(false);
      return;
    }
    start(action, question, true);
  }, [action, question, start, t]);

  const refreshSavedLinks = useCallback(
    async (outcome: RelationshipAnalysisOutcome) => {
      const rows = new Map<string, ConceptLink>();
      const add = (links: ConceptLink[]) => {
        for (const link of links) rows.set(link.id, link);
      };
      try {
        if (learnThis?.documentId) {
          add(await listConceptLinksFor("document", learnThis.documentId, false));
          add(await listConceptLinksTargeting("document", learnThis.documentId, false));
        }
        for (const prerequisite of outcome.prerequisites) {
          if (!prerequisite.conceptId) continue;
          add(await listConceptLinksFor("concept", prerequisite.conceptId, false));
          add(await listConceptLinksTargeting("concept", prerequisite.conceptId, false));
        }
      } catch {
        return;
      }
      setSavedLinks((prev) => {
        const byId = new Map(prev.map((link) => [link.id, link]));
        for (const link of rows.values()) byId.set(link.id, link);
        return [...byId.values()].slice(0, 40);
      });
    },
    [learnThis?.documentId]
  );

  const startPrerequisites = useCallback(() => {
    const epoch = ++analysisEpochRef.current;
    setMode("prerequisites");
    setPrereqRunning(true);
    setPrereqError(null);
    setPrereqResult(null);
    setSavedDraftLinks({});
    setLinkActionState({});
    setSavedLinks([]);
    setEditingLinkId(null);

    if (!aiPrerequisitesEnabled && !aiConceptLinksEnabled) {
      setPrereqError("Prerequisite analysis is disabled in Settings.");
      setPrereqRunning(false);
      return;
    }

    if (!relationshipOwnerRef.current) {
      relationshipOwnerRef.current = new ConceptRelationshipAnalysisOwner({
        prerequisitesEnabled: aiPrerequisitesEnabled,
        linksEnabled: aiConceptLinksEnabled,
      });
    } else {
      relationshipOwnerRef.current.cancel();
      relationshipOwnerRef.current = new ConceptRelationshipAnalysisOwner({
        prerequisitesEnabled: aiPrerequisitesEnabled,
        linksEnabled: aiConceptLinksEnabled,
      });
    }

    void relationshipOwnerRef.current
      .start({
        passage: sourcePassage,
        documentTitle: learnThis?.documentTitle,
        documentId: learnThis?.documentId,
        sourceRevision: learnThis?.sourceRevision,
      })
      .then((outcome) => {
        // Late results never replace another selection/analysis.
        if (epoch !== analysisEpochRef.current) return;
        if (outcome.status === "cancelled") return;
        setPrereqResult(outcome);
        setPrereqRunning(false);
        if (outcome.status === "denied") {
          setPrereqError("Remote processing was not authorized; no analysis was run.");
        } else if (outcome.error) {
          setPrereqError(outcome.error);
        }
        void refreshSavedLinks(outcome);
      })
      .catch((err) => {
        if (epoch !== analysisEpochRef.current) return;
        setPrereqError(formatAIErrorMessage(err));
        setPrereqRunning(false);
      });
  }, [
    aiConceptLinksEnabled,
    aiPrerequisitesEnabled,
    learnThis?.documentId,
    learnThis?.documentTitle,
    learnThis?.sourceRevision,
    sourcePassage,
    refreshSavedLinks,
  ]);

  const saveAllDrafts = useCallback(async () => {
    if (!prereqResult) return;
    const unsaved = prereqResult.drafts.filter((draft) => !savedDraftLinks[draft.id]);
    if (unsaved.length === 0) return;
    setLinkActionState((prev) => {
      const next = { ...prev };
      for (const draft of unsaved) next[draft.id] = "saving";
      return next;
    });
    try {
      const saved = await saveRelationshipDrafts(prereqResult.analysis.analysisId, unsaved);
      setSavedDraftLinks((prev) => {
        const next = { ...prev };
        for (const row of saved.results) next[row.draft.id] = row.link;
        return next;
      });
      setLinkActionState((prev) => {
        const next = { ...prev };
        for (const draft of unsaved) next[draft.id] = "saved";
        return next;
      });
      const links = saved.results.map((row) => row.link);
      setSavedLinks((prev) => {
        const byId = new Map(prev.map((link) => [link.id, link]));
        for (const link of links) byId.set(link.id, link);
        return [...byId.values()];
      });
    } catch (error) {
      setLinkActionState((prev) => {
        const next = { ...prev };
        for (const draft of unsaved) next[draft.id] = "error";
        return next;
      });
      setPrereqError(formatAIErrorMessage(error));
    }
  }, [prereqResult, savedDraftLinks]);

  const acceptDraft = useCallback(
    async (draft: RelationshipDraft) => {
      if (!prereqResult) return;
      setLinkActionState((prev) => ({ ...prev, [draft.id]: "saving" }));
      try {
        const link = await acceptRelationshipDraft(
          prereqResult.analysis.analysisId,
          draft,
          savedDraftLinks[draft.id] ?? null
        );
        if (!link) throw new Error("No link was created.");
        setSavedDraftLinks((prev) => ({ ...prev, [draft.id]: link }));
        setLinkActionState((prev) => ({ ...prev, [draft.id]: "saved" }));
        setSavedLinks((prev) => [link, ...prev.filter((row) => row.id !== link.id)]);
      } catch (error) {
        setLinkActionState((prev) => ({ ...prev, [draft.id]: "error" }));
        linkRetryRef.current[draft.id] = () => void acceptDraft(draft);
        setPrereqError(formatAIErrorMessage(error));
      }
    },
    [prereqResult, savedDraftLinks]
  );

  const dismissDraft = useCallback(
    async (draft: RelationshipDraft) => {
      if (!prereqResult) return;
      setLinkActionState((prev) => ({ ...prev, [draft.id]: "saving" }));
      try {
        // A dismissal is an explicit durable action: persist the pending row
        // (so its canonical fingerprint survives restart) then dismiss it.
        let link = savedDraftLinks[draft.id] ?? null;
        if (!link) {
          const saved = await saveRelationshipDrafts(prereqResult.analysis.analysisId, [draft]);
          link = saved.results[0]?.link ?? null;
        }
        if (link) await dismissRelationshipLink(link.id);
        setPrereqResult((prev) =>
          prev
            ? { ...prev, drafts: prev.drafts.filter((row) => row.id !== draft.id) }
            : prev
        );
        setSavedLinks((prev) => prev.filter((row) => row.id !== link?.id));
        setLinkActionState((prev) => ({ ...prev, [draft.id]: "saved" }));
      } catch (error) {
        setLinkActionState((prev) => ({ ...prev, [draft.id]: "error" }));
        linkRetryRef.current[draft.id] = () => void dismissDraft(draft);
        setPrereqError(formatAIErrorMessage(error));
      }
    },
    [prereqResult, savedDraftLinks]
  );

  const acceptSavedLink = useCallback(async (link: ConceptLink) => {
    setLinkActionState((prev) => ({ ...prev, [link.id]: "saving" }));
    try {
      const accepted = await acceptConceptLink(link.id);
      if (!accepted) throw new Error("Link not found.");
      setSavedLinks((prev) => prev.map((row) => (row.id === accepted.id ? accepted : row)));
      setLinkActionState((prev) => ({ ...prev, [link.id]: "saved" }));
    } catch (error) {
      setLinkActionState((prev) => ({ ...prev, [link.id]: "error" }));
      linkRetryRef.current[link.id] = () => void acceptSavedLink(link);
      setPrereqError(formatAIErrorMessage(error));
    }
  }, []);

  const dismissSavedLink = useCallback(async (link: ConceptLink) => {
    setLinkActionState((prev) => ({ ...prev, [link.id]: "saving" }));
    try {
      await dismissRelationshipLink(link.id);
      setSavedLinks((prev) => prev.filter((row) => row.id !== link.id));
    } catch (error) {
      setLinkActionState((prev) => ({ ...prev, [link.id]: "error" }));
      linkRetryRef.current[link.id] = () => void dismissSavedLink(link);
      setPrereqError(formatAIErrorMessage(error));
    }
  }, []);

  const removeSavedLink = useCallback(async (link: ConceptLink) => {
    setLinkActionState((prev) => ({ ...prev, [link.id]: "saving" }));
    try {
      await removeRelationshipLink(link.id);
      setSavedLinks((prev) => prev.filter((row) => row.id !== link.id));
      setLinkActionState((prev) => {
        const next = { ...prev };
        delete next[link.id];
        return next;
      });
    } catch (error) {
      setLinkActionState((prev) => ({ ...prev, [link.id]: "error" }));
      linkRetryRef.current[link.id] = () => void removeSavedLink(link);
      setPrereqError(formatAIErrorMessage(error));
    }
  }, []);

  const applyLinkEdit = useCallback(
    async (link: ConceptLink) => {
      setLinkActionState((prev) => ({ ...prev, [link.id]: "saving" }));
      try {
        const result = await editRelationshipLink({
          linkId: link.id,
          relationType: editRelation,
          confidence: editConfidence,
        });
        if (result.outcome !== "updated" || !result.link) {
          throw new Error("This relationship conflicts with an existing link.");
        }
        setSavedLinks((prev) => prev.map((row) => (row.id === link.id ? result.link! : row)));
        setEditingLinkId(null);
        setLinkActionState((prev) => ({ ...prev, [link.id]: "saved" }));
      } catch (error) {
        setLinkActionState((prev) => ({ ...prev, [link.id]: "error" }));
        linkRetryRef.current[link.id] = () => void applyLinkEdit(link);
        setPrereqError(formatAIErrorMessage(error));
      }
    },
    [editConfidence, editRelation]
  );

  const startRelatedContent = useCallback(() => {
    setMode("related");
    setRelatedRunning(true);
    setRelatedResult(null);
    setRelatedError(null);
    relatedAbortRef.current?.abort();
    const controller = new AbortController();
    relatedAbortRef.current = controller;
    const epoch = ++analysisEpochRef.current;
    void discoverRelatedContent({
      passage: sourcePassage,
      documentId: learnThis?.documentId,
      signal: controller.signal,
    })
      .then((result) => {
        if (epoch !== analysisEpochRef.current || controller.signal.aborted) return;
        setRelatedResult(result);
        setRelatedRunning(false);
        if (result.error) setRelatedError(result.error);
      })
      .catch((error) => {
        if (epoch !== analysisEpochRef.current || controller.signal.aborted) return;
        setRelatedError(formatAIErrorMessage(error));
        setRelatedRunning(false);
      });
  }, [learnThis?.documentId, sourcePassage]);

  // Back/Cancel returns to the action list, unless there is no list to return
  // to because the caller drove us straight into one action.
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    analysisEpochRef.current += 1;
    relationshipOwnerRef.current?.cancel();
    relatedAbortRef.current?.abort();
    setRunning(false);
    setPrereqRunning(false);
    setRelatedRunning(false);
    if (initialAction) onClose();
    else setMode("menu");
  }, [initialAction, onClose]);

  // Caller-driven action: run it as soon as the sheet opens, once.
  const startedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || !initialAction) {
      startedForRef.current = null;
      return;
    }
    const key = `${initialAction}:${text}`;
    if (startedForRef.current === key) return;
    startedForRef.current = key;
    if (initialAction === "ask") {
      setAction("ask");
      setMode("asking");
    } else {
      start(initialAction);
    }
  }, [open, initialAction, text, start]);

  const handleCreateExtractFromResult = useCallback(async () => {
    if (!onCreateExtractFromResult || !output || extractSaveState === "saving") return;
    setExtractSaveState("saving");
    try {
      const res = await onCreateExtractFromResult(output);
      if (res === null) {
        setExtractSaveState("error");
        return;
      }
      setExtractSaveState("saved");
      if (operationId) {
        onSettled?.(operationId, "success");
      }
      onClose();
    } catch (err) {
      console.error("Failed to create extract from AI result:", err);
      setExtractSaveState("error");
    }
  }, [onCreateExtractFromResult, output, extractSaveState, operationId, onSettled, onClose]);

  const startDownload = useCallback(() => {
    setDownloadState("downloading");
    void requestModelDownload("all").catch(() => setDownloadState("downloadable"));
  }, []);

  const navigateEvidence = useCallback(
    (ref: { documentId?: string; text: string; locator: unknown }) => {
      if (!ref.documentId) return;
      const locator = ref.locator as { kind?: string; [key: string]: unknown };
      let location: ChunkLocation | undefined;
      if (locator?.kind === "chunk") {
        location = {
          sourceType: String(locator.sourceType ?? "text") as ChunkLocation["sourceType"],
          documentId: ref.documentId,
          ordinal: Number(locator.ordinal ?? 0),
          startOffset: Number(locator.startOffset ?? 0),
          endOffset: Number(locator.endOffset ?? 0),
          pageNumber: locator.pageNumber as number | undefined,
          cfiRange: locator.cfiRange as string | undefined,
          headingPath: locator.headingPath as string[] | undefined,
          timestampMs: locator.timestampMs as number | undefined,
          endTimestampMs: locator.endTimestampMs as number | undefined,
        };
      } else if (locator?.kind === "extract") {
        location = {
          sourceType: String(locator.sourceType ?? "text") as ChunkLocation["sourceType"],
          documentId: ref.documentId,
          ordinal: 0,
          startOffset: 0,
          endOffset: 0,
          pageNumber: locator.pageNumber as number | undefined,
          extractId: locator.extractId as string | undefined,
        };
      } else if (locator?.kind === "annotation") {
        location = {
          sourceType: String(locator.sourceType ?? "text") as ChunkLocation["sourceType"],
          documentId: ref.documentId,
          ordinal: 0,
          startOffset: 0,
          endOffset: 0,
          pageNumber: locator.pageNumber as number | undefined,
          anchorId: locator.annotationId as string | undefined,
        };
      } else if (locator?.kind === "card" && locator.pageNumber != null) {
        location = {
          sourceType: "pdf",
          documentId: ref.documentId,
          ordinal: 0,
          startOffset: 0,
          endOffset: 0,
          pageNumber: Number(locator.pageNumber),
          extractId: locator.extractId as string | undefined,
        };
      }
      const text =
        locator?.kind === "card" && typeof locator.snippet === "string" && locator.snippet.trim()
          ? locator.snippet
          : ref.text;
      onClose();
      void openLibrarySource(ref.documentId, text, location);
    },
    [onClose]
  );

  if (!open) return null;

  // "Learn this" preview takes over the sheet surface (its own overlay).
  if (showLearnThis) {
    return (
      <LearnThisProposalSheet
        open
        text={text}
        passage={sourcePassage}
        documentId={learnThis?.documentId}
        documentTitle={learnThis?.documentTitle}
        extractId={learnThis?.extractId}
        selectionContext={learnThis?.selectionContext}
        onClose={() => {
          setShowLearnThis(false);
          if (initialAction) onClose();
        }}
      />
    );
  }

  // Socratic tutoring takes over the sheet surface (task 7.3 entry).
  if (showTutor) {
    return (
      <TutorSheet
        open
        material={sourcePassage}
        documentTitle={learnThis?.documentTitle}
        documentId={learnThis?.documentId}
        extractId={learnThis?.extractId}
        selectionContext={learnThis?.selectionContext}
        languageContext={languageContext ?? undefined}
        languageMode="explain"
        onClose={() => {
          setShowTutor(false);
          if (initialAction) onClose();
        }}
      />
    );
  }

  const preview =
    text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS).trimEnd()}…` : text;

  // The sheet's items derive from the shared selection-action registry
  // (change: hyperlink-selection-context-actions, design D1). Each action
  // renders through its one route below; availability flags come from the
  // host (onCreateExtract presence) and the feature settings.
  const sheetActions = getSelectionActions("sheet", {
    aiAvailable: ai.available,
    canExtract: Boolean(onCreateExtract),
    learnThisEnabled: aiLearnThisEnabled,
    libraryRagEnabled: aiLibraryRagEnabled,
    socraticTutorEnabled: aiSocraticTutorEnabled,
    prerequisitesEnabled: aiPrerequisitesEnabled,
    linksEnabled: aiConceptLinksEnabled,
  });
  const coreActions = sheetActions.filter((a) => !isAiSelectionAction(a));
  const aiSectionActions = sheetActions.filter(isAiSelectionAction);

  const renderSheetAction = (action: SelectionActionDescriptor) => {
    const label = t(selectionActionLabelKey(action, "sheet"));
    const Icon = action.icon;
    // Content-free usage signal for every sheet row (design D8): which
    // action was chosen, never the selected text.
    const track = (run: () => void) => () => {
      recordSelectionActionInvocation(action.id);
      run();
    };
    switch (action.id) {
      case "extract":
        return (
          <button
            key={action.id}
            className={mobileSheetItemClass}
            disabled={extractSaveState === "saving"}
            onClick={track(async () => {
              if (extractSaveState === "saving") return;
              setExtractSaveState("saving");
              try {
                const res = await onCreateExtract?.(text);
                if (res !== null) {
                  setExtractSaveState("saved");
                  if (operationId) onSettled?.(operationId, "success");
                  onClose();
                } else {
                  setExtractSaveState("error");
                }
              } catch (err) {
                console.error("Failed to create extract:", err);
                setExtractSaveState("error");
              }
            })}
          >
            <Lightbulb className="w-5 h-5" aria-hidden="true" />
            {label}
          </button>
        );
      case "copy":
        return (
          <button
            key={action.id}
            className={mobileSheetItemClass}
            onClick={track(() => {
              void copySelectionTextToClipboard(text);
              onClose();
            })}
          >
            <Copy className="w-5 h-5" aria-hidden="true" />
            {label}
          </button>
        );
      case "ask":
        return (
          <button key={action.id} className={mobileSheetItemClass} onClick={track(() => setMode("asking"))}>
            <span aria-hidden="true">
              <Icon className="w-5 h-5" />
            </span>
            {label}
          </button>
        );
      case "learnThis":
        return (
          <button key={action.id} className={mobileSheetItemClass} onClick={track(() => setShowLearnThis(true))}>
            <span aria-hidden="true">
              <Icon className="w-5 h-5" />
            </span>
            {label}
          </button>
        );
      case "askLibrary":
        return (
          <button key={action.id} className={mobileSheetItemClass} onClick={track(() => setMode("library"))}>
            <span aria-hidden="true">
              <Icon className="w-5 h-5" />
            </span>
            {label}
          </button>
        );
      case "socraticTutor":
        return (
          <button key={action.id} className={mobileSheetItemClass} onClick={track(() => setShowTutor(true))}>
            <span aria-hidden="true">
              <Icon className="w-5 h-5" />
            </span>
            {label}
          </button>
        );
      case "prerequisites":
        return (
          <button key={action.id} className={mobileSheetItemClass} onClick={track(startPrerequisites)}>
            <span aria-hidden="true">
              <Icon className="w-5 h-5" />
            </span>
            {label || "Find prerequisites"}
          </button>
        );
      case "relatedContent":
        return (
          <button key={action.id} className={mobileSheetItemClass} onClick={track(startRelatedContent)}>
            <span aria-hidden="true">
              <Icon className="w-5 h-5" />
            </span>
            {label && label !== "aiLearning.relatedContent" ? label : "Find related content"}
          </button>
        );
      default:
        return (
          <button
            key={action.id}
            className={mobileSheetItemClass}
            onClick={track(() => start(action.id as SelectionAiAction))}
          >
            <span aria-hidden="true">
              <Icon className="w-5 h-5" />
            </span>
            {label}
          </button>
        );
    }
  };

  return (
    <MobileContextMenuSheet open={open} onClose={onClose} variant="content">
      <div data-selection-actions-sheet="true">
        {mode === "menu" && !initialAction && (
          <>
            <p className="px-4 pb-2 text-[13px] leading-snug text-muted-foreground line-clamp-3">
              {preview}
            </p>

            {coreActions.map(renderSheetAction)}

            {aiSectionActions.length > 0 && (
              <>
                <div className="px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("selectionSheet.aiSection")}
                </div>
                {aiSectionActions.map(renderSheetAction)}
              </>
            )}

            {!ai.available && downloadState !== "idle" && (
              <button
                className={mobileSheetItemClass}
                disabled={downloadState === "downloading"}
                onClick={startDownload}
              >
                <DownloadSimple className="w-5 h-5" aria-hidden="true" />
                {downloadState === "downloading"
                  ? t("selectionSheet.modelDownloading")
                  : t("selectionSheet.downloadModel")}
              </button>
            )}
          </>
        )}

        {mode === "asking" && (
          <div className="px-4 pb-4 space-y-3">
            {preview && (
              <p className="text-[13px] leading-snug text-muted-foreground line-clamp-3">{preview}</p>
            )}
            <input
              autoFocus
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && question.trim()) start("ask");
              }}
              placeholder={t("selectionSheet.askPlaceholder")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px] text-foreground"
            />
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-lg border border-border px-3 py-2 text-[15px] text-foreground"
                onClick={cancel}
              >
                {t("selectionSheet.back")}
              </button>
              <button
                className="flex-1 rounded-lg bg-primary px-3 py-2 text-[15px] text-primary-foreground disabled:opacity-50"
                disabled={!question.trim()}
                onClick={() => start("ask")}
              >
                {t("selectionSheet.askSubmit")}
              </button>
            </div>
          </div>
        )}

        {mode === "library" && (
          <div className="px-4 pb-4 space-y-3">
            <div className="flex items-center gap-2">
              <button
                className="p-1 -ml-1 text-muted-foreground"
                aria-label={t("selectionSheet.back")}
                onClick={cancel}
              >
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              </button>
              <span className="text-sm font-medium text-foreground">
                {t("aiLibrary.askLibrary")}
              </span>
              <span
                className={`ml-auto text-[11px] px-2 py-0.5 rounded ${
                  ai.path === "ondevice"
                    ? "bg-success/15 text-success"
                    : ai.path === "cloud"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {ai.path === "ondevice"
                  ? t("aiLibrary.onDevice")
                  : ai.path === "cloud"
                    ? t("aiLibrary.cloud")
                    : t("aiLibrary.noProvider")}
              </span>
            </div>

            {preview && (
              <p className="text-[13px] leading-snug text-muted-foreground line-clamp-3">{preview}</p>
            )}

            <input
              autoFocus
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && question.trim()) {
                  void library.ask(question.trim(), { contextPassage: sourcePassage || undefined });
                }
              }}
              placeholder={t("aiLibrary.selectionPlaceholder")}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[15px] text-foreground"
            />
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-lg border border-border px-3 py-2 text-[15px] text-foreground"
                onClick={cancel}
              >
                {t("selectionSheet.back")}
              </button>
              <button
                className="flex-1 rounded-lg bg-primary px-3 py-2 text-[15px] text-primary-foreground disabled:opacity-50"
                disabled={!question.trim() || library.running}
                onClick={() => void library.ask(question.trim(), { contextPassage: sourcePassage || undefined })}
              >
                {library.running ? t("aiLibrary.thinking") : t("aiLibrary.ask")}
              </button>
            </div>

            {library.error && (
              <p className="text-[13px] text-destructive">
                {t("aiLibrary.askError", { message: library.error })}
              </p>
            )}

            {library.result && !library.running && (
              <div className="space-y-2 pt-1">
                <span
                  className={`inline-block text-[11px] px-2 py-0.5 rounded font-medium ${
                    library.result.answer.evidenceLevel === "supported"
                      ? "bg-success/15 text-success"
                      : library.result.answer.evidenceLevel === "weak"
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : library.result.answer.evidenceLevel === "conflicting"
                          ? "bg-accent/15 text-accent-foreground"
                          : "bg-muted text-muted-foreground"
                  }`}
                >
                  {t(`aiLibrary.evidence_${library.result.answer.evidenceLevel}`)}
                </span>
                <p className="whitespace-pre-wrap text-[14px] leading-relaxed text-foreground">
                  {library.result.answer.answer}
                </p>
                {library.result.sources.length > 0 && (
                  <div className="pt-1.5 border-t border-border/70 space-y-1">
                    {library.result.sources.map((source, index) => (
                      <button
                        key={`${source.chunkId}-${index}`}
                        type="button"
                        onClick={() => {
                          onClose();
                          void openLibrarySource(source.documentId, source.text, source.location);
                        }}
                        className="w-full text-left flex items-start gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted/70"
                      >
                        <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold text-primary">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                          {source.documentTitle ?? source.documentId}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {mode === "prerequisites" && (
          <div className="px-4 pb-4 space-y-3">
            <div className="flex items-center gap-2">
              <button
                className="p-1 -ml-1 text-muted-foreground hover:text-foreground"
                aria-label={t("selectionSheet.back")}
                onClick={cancel}
              >
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              </button>
              <span className="text-sm font-medium text-foreground">
                {t("aiLearning.prerequisites") || "Prerequisites Analysis"}
              </span>
            </div>

            {preview && (
              <p className="text-[13px] leading-snug text-muted-foreground line-clamp-3">{preview}</p>
            )}

            {prereqRunning && (
              <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                <ArrowsClockwise className="w-4 h-4 animate-spin text-primary" />
                <span>Analyzing prerequisite concepts…</span>
              </div>
            )}

            {prereqError && (
              <p className="text-[13px] text-destructive">
                {prereqError}
              </p>
            )}

            {prereqResult && !prereqRunning && (
              <div className="space-y-2.5 pt-1">
                {prereqResult.status === "empty" ? (
                  <p className="text-xs text-muted-foreground py-2" data-testid="prereq-empty">
                    {prereqResult.emptyMessage ?? EMPTY_PREREQUISITES_MESSAGE}
                  </p>
                ) : prereqResult.prerequisites.length === 0 ? null : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground" data-testid="coverage-summary">
                      {`${prereqResult.prerequisites.filter((p) => p.coverage?.evidenceCoverage === "supported").length} of ${prereqResult.prerequisites.length} prerequisites have direct indexed evidence`}
                    </p>
                    {prereqResult.prerequisites.map((p: PrerequisiteConceptResult) => {
                      const coverage = p.coverage;
                      return (
                        <div
                          key={p.conceptKey}
                          data-testid="prereq-concept"
                          className="p-2.5 bg-muted/30 border border-border rounded-lg text-xs space-y-1.5"
                        >
                          <div className="font-semibold text-foreground">{p.concept}</div>
                          <p className="text-muted-foreground leading-relaxed">{p.why}</p>

                          {coverage && (
                            <div className="space-y-1.5 border-t border-border/60 pt-1.5">
                              <div className="flex flex-wrap gap-1.5">
                                <span
                                  data-testid="coverage-badge"
                                  className="inline-flex rounded px-1.5 py-0.5 bg-primary/10 text-primary"
                                >
                                  {evidenceCoverageText(coverage.evidenceCoverage)}
                                </span>
                                <span
                                  data-testid="activity-badge"
                                  className="inline-flex rounded px-1.5 py-0.5 bg-muted text-muted-foreground"
                                >
                                  {activityText(coverage.activity)}
                                </span>
                                <span
                                  data-testid="index-badge"
                                  className="inline-flex rounded px-1.5 py-0.5 bg-muted text-muted-foreground"
                                >
                                  {`index: ${coverage.indexCompleteness}`}
                                </span>
                              </div>

                              {coverage.evidenceRefs.length > 0 && (
                                <div className="space-y-1">
                                  <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                    {`Evidence (${coverage.evidenceRefs.length})`}
                                  </p>
                                  {coverage.evidenceRefs.map((ref) => (
                                    <button
                                      key={`${ref.kind}:${ref.id}`}
                                      type="button"
                                      data-testid="evidence-row"
                                      disabled={!ref.documentId}
                                      onClick={() => navigateEvidence(ref)}
                                      className="w-full text-left flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-muted/70 disabled:opacity-60"
                                    >
                                      <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold text-primary">
                                        {ref.strength === "direct" ? "D" : "M"}
                                      </span>
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium text-foreground">
                                          {ref.documentTitle ?? ref.kind}
                                        </span>
                                        <span className="block truncate text-[11px] text-muted-foreground">
                                          {ref.kind} · {ref.strength} · {ref.text.slice(0, 90)}
                                        </span>
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}

                              {coverage.limitations.length > 0 && (
                                <ul className="space-y-0.5 text-[11px] text-muted-foreground">
                                  {coverage.limitations.slice(0, 3).map((limitation) => (
                                    <li key={limitation}>{coverageLimitationText(limitation)}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {prereqResult.status === "coverage-only" && (
                  <p className="text-[11px] text-muted-foreground" data-testid="coverage-only-note">
                    Relationship suggestions are off; showing evidence coverage only. Nothing was
                    saved.
                  </p>
                )}

                {prereqResult.drafts.filter((draft) => !savedDraftLinks[draft.id]).length > 0 && (
                  <div className="space-y-1.5 border-t border-border/70 pt-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      AI suggestions (not saved)
                    </p>
                    {prereqResult.drafts
                      .filter((draft) => !savedDraftLinks[draft.id])
                      .map((draft) => {
                      const state = linkActionState[draft.id];
                      return (
                        <div
                          key={draft.id}
                          data-testid="relationship-draft"
                          className="rounded-lg border border-border bg-background p-2 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground truncate">
                              {draft.source.label} → {draft.target.label}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {Math.round(draft.confidence * 100)}%
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {draft.relationType} · AI suggested
                          </p>
                          <p className="text-muted-foreground leading-relaxed">{draft.rationale}</p>
                          <div className="flex gap-1.5 pt-0.5">
                            <button
                              type="button"
                              className="rounded border border-border px-2 py-1 text-[11px] text-foreground disabled:opacity-50"
                              disabled={state === "saving"}
                              onClick={() => void acceptDraft(draft)}
                            >
                              {state === "error" ? "Retry accept" : "Accept"}
                            </button>
                            <button
                              type="button"
                              className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground disabled:opacity-50"
                              disabled={state === "saving"}
                              onClick={() => void dismissDraft(draft)}
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      );
                    })}
                    <button
                      type="button"
                      data-testid="save-suggestions"
                      className="w-full rounded-lg border border-border px-3 py-2 text-[13px] text-foreground disabled:opacity-50"
                      disabled={Object.values(linkActionState).some((state) => state === "saving")}
                      onClick={() => void saveAllDrafts()}
                    >
                      {Object.values(linkActionState).some((state) => state === "error")
                        ? "Retry saving suggestions"
                        : "Save suggestions"}
                    </button>
                  </div>
                )}

                {savedLinks.length > 0 && (
                  <div className="space-y-1.5 border-t border-border/70 pt-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Relationships
                    </p>
                    {savedLinks.map((link) => {
                      const state = linkActionState[link.id];
                      const confirmed = link.createdBy === "user";
                      const knownConcept = prereqResult.prerequisites.find(
                        (p) => p.conceptId && (p.conceptId === link.sourceId || p.conceptId === link.targetId)
                      );
                      return (
                        <div
                          key={link.id}
                          data-testid="saved-link"
                          className="rounded-lg border border-border bg-background p-2 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-foreground truncate">
                              {knownConcept?.concept ?? `${link.sourceKind} → ${link.targetKind}`}
                            </span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {confirmed ? "Confirmed" : "AI suggested"}
                            </span>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            {link.relationType} · {Math.round(link.confidence * 100)}% ·{" "}
                            {link.origin === "unknown" ? "origin unknown" : `origin ${link.origin}`}
                          </p>
                          {linkProvenanceSummary(link) && (
                            <p className="text-[10px] text-muted-foreground/80">
                              {linkProvenanceSummary(link)}
                            </p>
                          )}

                          {editingLinkId === link.id ? (
                            <div className="space-y-1.5 pt-0.5">
                              <select
                                aria-label="Relationship type"
                                className="w-full rounded border border-border bg-background px-2 py-1 text-[12px]"
                                value={editRelation}
                                onChange={(event) => setEditRelation(event.target.value)}
                              >
                                {CONCEPT_RELATION_TYPES.map((relation) => (
                                  <option key={relation} value={relation}>
                                    {relation}
                                  </option>
                                ))}
                              </select>
                              <input
                                aria-label="Confidence"
                                type="number"
                                min={0}
                                max={1}
                                step={0.05}
                                value={editConfidence}
                                onChange={(event) => setEditConfidence(Number(event.target.value))}
                                className="w-full rounded border border-border bg-background px-2 py-1 text-[12px]"
                              />
                              <div className="flex gap-1.5">
                                <button
                                  type="button"
                                  className="rounded border border-border px-2 py-1 text-[11px] disabled:opacity-50"
                                  disabled={state === "saving"}
                                  onClick={() => void applyLinkEdit(link)}
                                >
                                  Save edit
                                </button>
                                <button
                                  type="button"
                                  className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground"
                                  onClick={() => setEditingLinkId(null)}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-1.5 pt-0.5">
                              {!confirmed && (
                                <button
                                  type="button"
                                  className="rounded border border-border px-2 py-1 text-[11px] disabled:opacity-50"
                                  disabled={state === "saving"}
                                  onClick={() => void acceptSavedLink(link)}
                                >
                                  Accept
                                </button>
                              )}
                              <button
                                type="button"
                                className="rounded border border-border px-2 py-1 text-[11px]"
                                onClick={() => {
                                  setEditingLinkId(link.id);
                                  setEditRelation(link.relationType);
                                  setEditConfidence(link.confidence);
                                }}
                              >
                                Edit
                              </button>
                              {!confirmed && (
                                <button
                                  type="button"
                                  className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground disabled:opacity-50"
                                  disabled={state === "saving"}
                                  onClick={() => void dismissSavedLink(link)}
                                >
                                  Dismiss
                                </button>
                              )}
                              <button
                                type="button"
                                className="rounded border border-border px-2 py-1 text-[11px] text-destructive disabled:opacity-50"
                                disabled={state === "saving"}
                                onClick={() => void removeSavedLink(link)}
                              >
                                Remove
                              </button>
                              {knownConcept?.conceptId && (
                                <button
                                  type="button"
                                  className="rounded border border-border px-2 py-1 text-[11px] text-muted-foreground"
                                  onClick={() => {
                                    onClose();
                                    void openConceptInKnowledgeGraph(knownConcept.conceptId!);
                                  }}
                                >
                                  Open concept
                                </button>
                              )}
                            </div>
                          )}
                          {state === "error" && (
                            <button
                              type="button"
                              className="text-[11px] text-destructive underline"
                              onClick={() => {
                                setEditingLinkId(null);
                                const retry = linkRetryRef.current[link.id];
                                if (retry) retry();
                                else void refreshSavedLinks(prereqResult);
                              }}
                            >
                              Retry
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2">
              {prereqResult && !prereqRunning && (
                <button
                  type="button"
                  data-testid="reanalyze"
                  className="flex-1 rounded-lg border border-border px-3 py-2 text-[14px] text-foreground hover:bg-muted"
                  onClick={startPrerequisites}
                >
                  Reanalyze
                </button>
              )}
              <button
                className="flex-1 rounded-lg border border-border px-3 py-2 text-[14px] text-foreground hover:bg-muted"
                onClick={cancel}
              >
                {t("selectionSheet.back")}
              </button>
            </div>
          </div>
        )}

        {mode === "related" && (
          <div className="px-4 pb-4 space-y-3">
            <div className="flex items-center gap-2">
              <button
                className="p-1 -ml-1 text-muted-foreground hover:text-foreground"
                aria-label={t("selectionSheet.back")}
                onClick={cancel}
              >
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              </button>
              <span className="text-sm font-medium text-foreground">
                {t("aiLearning.relatedContent") || "Related content"}
              </span>
            </div>

            {preview && (
              <p className="text-[13px] leading-snug text-muted-foreground line-clamp-3">{preview}</p>
            )}

            {relatedRunning && (
              <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                <ArrowsClockwise className="w-4 h-4 animate-spin text-primary" />
                <span>Searching indexed library evidence…</span>
              </div>
            )}

            {relatedError && (
              <div className="space-y-2">
                <p className="text-[13px] text-destructive">{relatedError}</p>
                <button
                  type="button"
                  className="rounded-lg border border-border px-3 py-2 text-[13px] text-foreground"
                  onClick={startRelatedContent}
                >
                  Retry
                </button>
              </div>
            )}

            {relatedResult && !relatedRunning && (
              <div className="space-y-2.5 pt-1">
                {relatedResult.status === "empty" && (
                  <p className="text-xs text-muted-foreground py-2" data-testid="related-empty">
                    No related indexed material was found for this passage.
                  </p>
                )}
                {relatedResult.status === "unavailable" && (
                  <p className="text-xs text-muted-foreground py-2" data-testid="related-unavailable">
                    Related material could not be searched without the required local or approved
                    remote access.
                  </p>
                )}

                {relatedResult.items.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Source evidence
                    </p>
                    {relatedResult.items.map((item) => (
                      <button
                        key={`${item.kind}:${item.id}`}
                        type="button"
                        data-testid="related-item"
                        onClick={() => navigateEvidence(item)}
                        className="w-full text-left flex items-start gap-2 rounded-md border border-border px-2 py-1.5 hover:bg-muted/70"
                      >
                        <span className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-semibold text-primary">
                          {item.kind === "card" ? "C" : item.kind === "extract" ? "E" : "D"}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-foreground">
                            {item.documentTitle ?? item.documentId}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {item.text.slice(0, 120)}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {relatedResult.concepts.length > 0 && (
                  <div className="space-y-1.5 border-t border-border/70 pt-2">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Confirmed concepts
                    </p>
                    {relatedResult.concepts.map((concept) => (
                      <button
                        key={`${concept.conceptId}:${concept.relationType}`}
                        type="button"
                        data-testid="related-concept"
                        onClick={() => {
                          onClose();
                          void openConceptInKnowledgeGraph(concept.conceptId);
                        }}
                        className="w-full text-left rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted/70"
                      >
                        <span className="font-medium text-foreground">{concept.name}</span>
                        <span className="ml-1.5 text-[11px] text-muted-foreground">
                          {concept.relationType}
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {relatedResult.limitations.length > 0 && (
                  <ul className="text-[11px] text-muted-foreground space-y-0.5">
                    {relatedResult.limitations.slice(0, 3).map((limitation) => (
                      <li key={limitation}>{coverageLimitationText(limitation)}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <button
              className="w-full rounded-lg border border-border px-3 py-2 text-[14px] text-foreground hover:bg-muted"
              onClick={cancel}
            >
              {t("selectionSheet.back")}
            </button>
          </div>
        )}

        {mode === "result" && (
          <div className="px-4 pb-4 space-y-3" aria-busy={running}>
            {/* Polite announcements: loading → success/failure (a11y task 3.6). */}
            <div aria-live="polite" className="sr-only">
              {running
                ? t("selectionBar.loadingAnnouncement")
                : error
                  ? t("selectionBar.errorAnnouncement")
                  : result
                    ? t("selectionBar.resultAnnouncement")
                    : ""}
            </div>
            <div className="flex items-center gap-2">
              <button
                className="p-1 -ml-1 text-muted-foreground"
                aria-label={t("selectionSheet.back")}
                onClick={cancel}
              >
                <ArrowLeft className="w-5 h-5" aria-hidden="true" />
              </button>
              <span className="text-sm font-medium text-foreground">
                {t(`selectionSheet.${action}`)}
              </span>
            </div>

            {result?.truncated && (
              <p className="text-[12px] text-muted-foreground">{t("selectionSheet.truncated")}</p>
            )}

            {error ? (
              <div className="space-y-2">
                <p className="text-[14px] text-destructive">
                  {t("selectionSheet.error", { message: error })}
                </p>
                {showCloudRetry && (
                  <button
                    type="button"
                    className="rounded-lg border border-border px-3 py-2 text-[14px] text-foreground inline-flex items-center gap-2"
                    onClick={() => void retryOnCloud()}
                  >
                    <Sparkle className="w-4 h-4" aria-hidden="true" />
                    {t("aiErrors.safetyBlockedRetryCloud")}
                  </button>
                )}
              </div>
            ) : output ? (
              <SelectionMarkdown content={output} />
            ) : (
              <p className="text-[15px] leading-relaxed text-foreground">
                {running ? t("selectionSheet.running") : ""}
              </p>
            )}

            {result?.grounded === false && (
              <p className="text-[12px] text-muted-foreground">{t("selectionSheet.ungrounded")}</p>
            )}

            <div className="flex flex-wrap gap-2">
              {running ? (
                <button
                  className="rounded-lg border border-border px-3 py-2 text-[14px] text-foreground"
                  onClick={cancel}
                >
                  {t("selectionSheet.cancel")}
                </button>
              ) : (
                <>
                  <button
                    className="rounded-lg border border-border px-3 py-2 text-[14px] text-foreground inline-flex items-center gap-2"
                    onClick={() => start(action)}
                  >
                    <ArrowsClockwise className="w-4 h-4" aria-hidden="true" />
                    {t("selectionSheet.retry")}
                  </button>
                  {!error && output && (
                    <button
                      className="rounded-lg border border-border px-3 py-2 text-[14px] text-foreground inline-flex items-center gap-2"
                      onClick={() => void copySelectionTextToClipboard(output)}
                    >
                      <Copy className="w-4 h-4" aria-hidden="true" />
                      {t("selectionSheet.copy")}
                    </button>
                  )}
                  {!error && output && onCreateExtractFromResult && (
                    <button
                      className="rounded-lg bg-primary px-3 py-2 text-[14px] text-primary-foreground disabled:opacity-50 inline-flex items-center gap-2"
                      disabled={extractSaveState === "saving"}
                      aria-busy={extractSaveState === "saving"}
                      onClick={handleCreateExtractFromResult}
                    >
                      {extractSaveState === "saving" ? (
                        <>
                          <ArrowsClockwise className="w-4 h-4 animate-spin" aria-hidden="true" />
                          <span>{t("common.saving")}</span>
                        </>
                      ) : extractSaveState === "error" ? (
                        <>
                          <ArrowsClockwise className="w-4 h-4" aria-hidden="true" />
                          <span>{t("selectionSheet.retryCreateExtract")}</span>
                        </>
                      ) : (
                        t("selectionSheet.createExtractFromResult")
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </MobileContextMenuSheet>
  );
}
