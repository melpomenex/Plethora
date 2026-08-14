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

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowsClockwise,
  Copy,
  DownloadSimple,
  Lightbulb,
  ListBullets,
  Question,
  TextAa,
  TextAlignLeft,
} from "@phosphor-icons/react";
import { MobileContextMenuSheet, mobileSheetItemClass } from "../common/MobileContextMenuSheet";
import { copySelectionTextToClipboard } from "./SelectionPopup";
import { useI18n } from "../../lib/i18n";
import { useAiAvailability } from "../../lib/ai/useAiAvailability";
import {
  getOnDeviceRequirementStatus,
  isOnDeviceAiSupportedPlatform,
  requestModelDownload,
  toOnDeviceAiError,
} from "../../lib/ai/onDeviceAI";
import { hasCloudProvider } from "../../lib/ai/provider";
import {
  answerPassage,
  explainPassage,
  keyTermsPassage,
  simplifyPassage,
  summarizePassage,
  type PassageActionOptions,
  type PassageResult,
} from "../../lib/ai/passageAI";

export type SelectionAiAction = "explain" | "summarize" | "simplify" | "keyTerms" | "ask";

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
  onCreateExtract?: (text: string) => void;
  /** Omitted when the surface cannot attach an extract to an AI result. */
  onCreateExtractFromResult?: (text: string) => void;
}

const PREVIEW_CHARS = 180;

/** Characters of surrounding text kept on each side of the selection. */
const CONTEXT_CHARS = 1500;

/**
 * The passage to send to the model: the selection plus the surrounding text of
 * whatever block it sits in, so "explain this" on a one-line selection has
 * something to work with. Falls back to the selection alone when no container
 * text is reachable.
 */
export function passageAroundSelection(selection: Selection | null, text: string): string {
  const node = selection?.anchorNode;
  const element = node instanceof Element ? node : node?.parentElement;
  const container =
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

  return full.slice(Math.max(0, at - CONTEXT_CHARS), at + needle.length + CONTEXT_CHARS);
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
}: SelectionActionsSheetProps) {
  const { t } = useI18n();
  const ai = useAiAvailability("prompt");

  const [mode, setMode] = useState<"menu" | "asking" | "result">("menu");
  const [action, setAction] = useState<SelectionAiAction>("explain");
  const [question, setQuestion] = useState("");
  const [output, setOutput] = useState("");
  const [result, setResult] = useState<PassageResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [downloadState, setDownloadState] = useState<"idle" | "downloadable" | "downloading">(
    "idle"
  );

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
    setRunning(false);
  }, []);

  // Closing the sheet aborts whatever is in flight; a cancelled request must
  // never fall back to the cloud.
  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  useEffect(() => () => abortRef.current?.abort(), []);

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
    (next: SelectionAiAction, nextQuestion = question) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setAction(next);
      setMode("result");
      setOutput("");
      setResult(null);
      setError(null);
      setRunning(true);

      void runAction(next, sourcePassage, nextQuestion, {
        signal: controller.signal,
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
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setError(toOnDeviceAiError(err).message || String(err));
          setRunning(false);
        });
    },
    [question, sourcePassage]
  );

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

  const startDownload = useCallback(() => {
    setDownloadState("downloading");
    void requestModelDownload("all").catch(() => setDownloadState("downloadable"));
  }, []);

  if (!open) return null;

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
              <button className={mobileSheetItemClass} onClick={() => onCreateExtract(text)}>
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

        {mode === "result" && (
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
                {t(`selectionSheet.${action}`)}
              </span>
            </div>

            {result?.truncated && (
              <p className="text-[12px] text-muted-foreground">{t("selectionSheet.truncated")}</p>
            )}

            {error ? (
              <p className="text-[14px] text-destructive">
                {t("selectionSheet.error", { message: error })}
              </p>
            ) : (
              <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-foreground">
                {output || (running ? t("selectionSheet.running") : "")}
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
                      className="rounded-lg bg-primary px-3 py-2 text-[14px] text-primary-foreground"
                      onClick={() => onCreateExtractFromResult(output)}
                    >
                      {t("selectionSheet.createExtractFromResult")}
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
