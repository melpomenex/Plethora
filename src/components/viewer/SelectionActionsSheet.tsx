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

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import DOMPurify from "dompurify";
import {
  ArrowLeft,
  ArrowsClockwise,
  ChalkboardTeacher,
  Copy,
  DownloadSimple,
  GraduationCap,
  Lightbulb,
  ListBullets,
  Question,
  Sparkle,
  TextAa,
  TextAlignLeft,
  TreeStructure,
} from "@phosphor-icons/react";
import { MobileContextMenuSheet, mobileSheetItemClass } from "../common/MobileContextMenuSheet";
import { copySelectionTextToClipboard } from "./SelectionPopup";
import { useI18n } from "../../lib/i18n";
import { useAiAvailability } from "../../lib/ai/useAiAvailability";
import { useAskLibrary } from "../../lib/ai/useAskLibrary";
import { useSettingsStore } from "../../stores/settingsStore";
import { runPrerequisiteAnalysis } from "../../lib/ai/tasks/definitions/prerequisiteTask";
import type { PrerequisiteAnalysis } from "../../lib/ai/schemas/prerequisite";
import { appleFmWarmup } from "../../lib/ai/apple/foundation";
import { isAppleOsPlatform } from "../../lib/ai/apple/capabilities";
import {
  getOnDeviceRequirementStatus,
  isOnDeviceAiSupportedPlatform,
  requestModelDownload,
  toOnDeviceAiError,
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

export type SelectionAiAction = "explain" | "summarize" | "simplify" | "keyTerms" | "ask";

/** Document context for the "Learn this" proposal (task 2.3). */
export interface LearnThisContext {
  documentId?: string;
  documentTitle?: string;
  /** Existing extract the selection belongs to, when there is one. */
  extractId?: string;
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

function SelectionMarkdown({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
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
  const library = useAskLibrary();
  const { reset: resetLibrary } = library;

  const [mode, setMode] = useState<"menu" | "asking" | "result" | "library" | "prerequisites">("menu");
  const [action, setAction] = useState<SelectionAiAction>("explain");
  const [question, setQuestion] = useState("");
  const [output, setOutput] = useState("");
  const [result, setResult] = useState<PassageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCloudRetry, setShowCloudRetry] = useState(false);
  const [running, setRunning] = useState(false);
  const [showLearnThis, setShowLearnThis] = useState(false);
  const [showTutor, setShowTutor] = useState(false);
  const [prereqRunning, setPrereqRunning] = useState(false);
  const [prereqError, setPrereqError] = useState<string | null>(null);
  const [prereqResult, setPrereqResult] = useState<PrerequisiteAnalysis | null>(null);
  const [downloadState, setDownloadState] = useState<"idle" | "downloadable" | "downloading">(
    "idle"
  );
  const [extractSaveState, setExtractSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle"
  );
  const [languageContext, setLanguageContext] = useState<ReturnType<typeof buildLearnerContext> | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // `||`, not `??`: a surface with no reachable surrounding text (EPUB/HTML
  // render in an iframe) passes an empty string, and an empty passage would
  // make every adapter throw `invalid_argument`.
  const sourcePassage = (passage || text).trim();

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
    setExtractSaveState("idle");
    resetLibrary();
  }, [resetLibrary]);

  // Closing the sheet aborts whatever is in flight; a cancelled request must
  // never fall back to the cloud.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => () => abortRef.current?.abort(), []);

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

  const startPrerequisites = useCallback(() => {
    setMode("prerequisites");
    setPrereqRunning(true);
    setPrereqError(null);
    setPrereqResult(null);

    void runPrerequisiteAnalysis({
      passage: sourcePassage,
      documentTitle: learnThis?.documentTitle,
    })
      .then((run) => {
        setPrereqResult(run.analysis);
        setPrereqRunning(false);
      })
      .catch((err) => {
        setPrereqError(toOnDeviceAiError(err).message || String(err));
        setPrereqRunning(false);
      });
  }, [sourcePassage, learnThis?.documentTitle]);

  // Back/Cancel returns to the action list, unless there is no list to return
  // to because the caller drove us straight into one action.
  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setRunning(false);
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

  const aiRows: Array<{ action: SelectionAiAction; label: string; icon: ReactNode }> = [
    { action: "explain", label: t("selectionSheet.explain"), icon: <Lightbulb className="w-5 h-5" /> },
    {
      action: "summarize",
      label: t("selectionSheet.summarize"),
      icon: <TextAlignLeft className="w-5 h-5" />,
    },
    { action: "simplify", label: t("selectionSheet.simplify"), icon: <TextAa className="w-5 h-5" /> },
    {
      action: "keyTerms",
      label: t("selectionSheet.keyTerms"),
      icon: <ListBullets className="w-5 h-5" />,
    },
  ];

  return (
    <MobileContextMenuSheet open={open} onClose={onClose} variant="content">
      <div data-selection-actions-sheet="true">
        {mode === "menu" && !initialAction && (
          <>
            <p className="px-4 pb-2 text-[13px] leading-snug text-muted-foreground line-clamp-3">
              {preview}
            </p>

            {onCreateExtract && (
              <button
                className={mobileSheetItemClass}
                disabled={extractSaveState === "saving"}
                onClick={async () => {
                  if (extractSaveState === "saving") return;
                  setExtractSaveState("saving");
                  try {
                    const res = await onCreateExtract(text);
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
                }}
              >
                <Lightbulb className="w-5 h-5" aria-hidden="true" />
                {t("selectionSheet.createExtract")}
              </button>
            )}

            <button
              className={mobileSheetItemClass}
              onClick={() => {
                void copySelectionTextToClipboard(text);
                onClose();
              }}
            >
              <Copy className="w-5 h-5" aria-hidden="true" />
              {t("selectionSheet.copy")}
            </button>

            {ai.available && (
              <>
                <div className="px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t("selectionSheet.aiSection")}
                </div>
                {aiRows.map((row) => (
                  <button
                    key={row.action}
                    className={mobileSheetItemClass}
                    onClick={() => start(row.action)}
                  >
                    <span aria-hidden="true">{row.icon}</span>
                    {row.label}
                  </button>
                ))}
                <button className={mobileSheetItemClass} onClick={() => setMode("asking")}>
                  <Question className="w-5 h-5" aria-hidden="true" />
                  {t("selectionSheet.ask")}
                </button>
                {aiLearnThisEnabled && (
                  <button className={mobileSheetItemClass} onClick={() => setShowLearnThis(true)}>
                    <GraduationCap className="w-5 h-5" aria-hidden="true" />
                    {t("aiLearning.learnThis")}
                  </button>
                )}
                {aiLibraryRagEnabled && (
                  <button className={mobileSheetItemClass} onClick={() => setMode("library")}>
                    <Sparkle className="w-5 h-5" aria-hidden="true" />
                    {t("aiLibrary.askLibrary")}
                  </button>
                )}
                {aiSocraticTutorEnabled && (
                  <button className={mobileSheetItemClass} onClick={() => setShowTutor(true)}>
                    <ChalkboardTeacher className="w-5 h-5" aria-hidden="true" />
                    {t("aiTutor.title")}
                  </button>
                )}
                {aiPrerequisitesEnabled && (
                  <button className={mobileSheetItemClass} onClick={startPrerequisites}>
                    <TreeStructure className="w-5 h-5" aria-hidden="true" />
                    {t("aiLearning.prerequisites") || "Find prerequisites"}
                  </button>
                )}
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
            <p className="text-[13px] leading-snug text-muted-foreground line-clamp-3">{preview}</p>
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

            <p className="text-[13px] leading-snug text-muted-foreground line-clamp-3">{preview}</p>

            <input
              autoFocus
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && question.trim()) {
                  void library.ask(question.trim(), { contextPassage: sourcePassage });
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
                onClick={() => void library.ask(question.trim(), { contextPassage: sourcePassage })}
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

            <p className="text-[13px] leading-snug text-muted-foreground line-clamp-3">{preview}</p>

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
                {prereqResult.prerequisites.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    This passage appears self-contained and does not require missing foundational concepts.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {prereqResult.prerequisites.map((p, idx) => (
                      <div key={idx} className="p-2.5 bg-muted/30 border border-border rounded-lg text-xs space-y-1">
                        <div className="font-semibold text-foreground">
                          {p.concept}
                        </div>
                        <p className="text-muted-foreground leading-relaxed">{p.why}</p>
                      </div>
                    ))}
                  </div>
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
                          <span>{t("common.saving") || "Saving..."}</span>
                        </>
                      ) : extractSaveState === "error" ? (
                        <>
                          <ArrowsClockwise className="w-4 h-4" aria-hidden="true" />
                          <span>{t("selectionSheet.retryCreateExtract") || "Retry create extract"}</span>
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
