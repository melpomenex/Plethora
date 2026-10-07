/**
 * AskSheet — mobile bottom-sheet question composer + docked answer cards
 * (OpenSpec `mobile-ask-sheet-library-qa`).
 *
 * Flow: select text → Ask → composer sheet (context chip, scope picker,
 * voice input, suggested questions) → submit → docked answer card over the
 * reader (document stays visible and interactive above it).
 *
 * Answering runs through `askInScope` (single `askLibrary` task for
 * Passage / Document / Library). Source citations reuse `DocumentQASources`
 * for deep-linking; flashcard creation goes through the pending-cards store;
 * read-aloud uses the TTS service.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CaretDown,
  CaretUp,
  Copy,
  Microphone,
  Plus,
  Sparkle,
  SpeakerHigh,
  X,
} from "@phosphor-icons/react";
import { MobileContextMenuSheet } from "../common/MobileContextMenuSheet";
import { useToast } from "../common/Toast";
import { DocumentQASources } from "../tabs/DocumentQASources";
import { useI18n } from "../../lib/i18n";
import { useMobileShell } from "../../hooks/useMobileShell";
import {
  askInScope,
  getAskSheetIndexState,
  type AskScope,
  type AskSheetIndexState,
} from "../../lib/ai/askSheet/scope";
import type {
  AskLibraryCitedSource,
  AskLibraryResult,
} from "../../lib/ai/tasks/definitions/libraryTask";
import { studyQuestionsTask } from "../../lib/ai/tasks/definitions/extractTasks";
import { runTask } from "../../lib/ai/tasks/runTask";
import { retrieveFromLibrary } from "../../api/ai-learning";
import { resolveEmbeddingConfigForRag } from "./ragConfig";
import type { RagHit } from "../../stores/documentQAStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { usePendingFlashcardsStore } from "../../stores/pendingFlashcardsStore";
import { generateSpeech } from "../../api/tts";

export interface AskSheetRequest {
  /** Selected passage text → context chip. */
  passage?: string;
  /** Visible section text for the no-selection "ask about this page" entry. */
  pageContext?: string;
  documentId?: string;
  documentTitle?: string;
}

interface AskSheetProps {
  open: boolean;
  onClose: () => void;
  request: AskSheetRequest | null;
}

type Phase = "compose" | "working" | "answered" | "error";

const SCOPES: AskScope[] = ["passage", "document", "library"];

/** Session cache: passage hash → suggested questions (design decision 5). */
const suggestionCache = new Map<string, string[]>();

function hashText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `q${(h >>> 0).toString(36)}`;
}

function parseQuestions(output: string, max: number): string[] {
  return output
    .split("\n")
    .map((l) => l.trim().replace(/^Q:\s*/i, "").trim())
    .filter((l) => l.length > 8 && l.endsWith("?"))
    .slice(0, max);
}

function toRagHit(source: AskLibraryCitedSource): RagHit {
  return {
    documentId: source.documentId,
    documentTitle: source.documentTitle ?? source.documentId,
    chunkIndex: source.location.ordinal,
    chunkText: source.text,
    score: source.score,
  };
}

function getSpeechRecognitionCtor(): (new () => any) | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition as new () => any) ?? (w.webkitSpeechRecognition as new () => any) ?? null;
}

export function AskSheet({ open, onClose, request }: AskSheetProps) {
  const { t } = useI18n();
  const toast = useToast();
  const isMobile = useMobileShell();

  const [phase, setPhase] = useState<Phase>("compose");
  const [scope, setScope] = useState<AskScope>("passage");
  const [chipText, setChipText] = useState<string | null>(null);
  const [editingChip, setEditingChip] = useState(false);
  const [draftChip, setDraftChip] = useState("");
  const [question, setQuestion] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [answer, setAnswer] = useState<AskLibraryResult | null>(null);
  const [lastQuestion, setLastQuestion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [followUps, setFollowUps] = useState<string[]>([]);
  const [indexState, setIndexState] = useState<AskSheetIndexState | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceHint, setVoiceHint] = useState<string | null>(null);
  const [tracing, setTracing] = useState(false);
  const [traceHits, setTraceHits] = useState<RagHit[] | null>(null);
  const [speaking, setSpeaking] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const recognitionRef = useRef<any | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const touchStartY = useRef<number | null>(null);
  const requestRef = useRef<AskSheetRequest | null>(null);
  requestRef.current = request;

  // Reset + initialize whenever the sheet opens with a new request.
  useEffect(() => {
    if (!open) return;
    const req = requestRef.current;
    const context = req?.passage ?? req?.pageContext ?? null;
    setPhase("compose");
    setScope(req?.passage ? "passage" : "document");
    setChipText(context);
    setEditingChip(false);
    setDraftChip(context ?? "");
    setQuestion("");
    setSuggestions([]);
    setAnswer(null);
    setLastQuestion("");
    setError(null);
    setExpanded(false);
    setFollowUps([]);
    setTraceHits(null);
    setTracing(false);
    setVoiceHint(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Honest state: index freshness + answering mode (task 5.1).
    void getAskSheetIndexState()
      .then((s) => {
        if (!controller.signal.aborted) setIndexState(s);
      })
      .catch(() => {});

    // Suggested questions from the passage (design decision 5).
    if (context && context.trim().length > 0) {
      const key = hashText(context);
      const cached = suggestionCache.get(key);
      if (cached) {
        setSuggestions(cached);
      } else {
        void runTask(studyQuestionsTask, { text: context.slice(0, 4000), count: 3 }, { signal: controller.signal })
          .then((run) => {
            if (controller.signal.aborted) return;
            const parsed = parseQuestions(run.output ?? "", 3);
            suggestionCache.set(key, parsed);
            setSuggestions(parsed);
          })
          .catch(() => {
            // Suggestions are a convenience — never block the composer.
          });
      }
    }

    return () => controller.abort();
  }, [open]);

  // Stop voice recognition when the sheet closes.
  useEffect(() => {
    if (!open) {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* already stopped */
      }
      setListening(false);
    }
  }, [open ]);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      /* already stopped */
    }
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) {
      setVoiceHint(t("askSheet.voiceNotSupported"));
      return;
    }
    if (!window.isSecureContext) {
      setVoiceHint(t("askSheet.voiceDenied"));
      return;
    }
    setVoiceHint(null);
    // Request the mic permission inside the tap gesture so the prompt appears.
    navigator.mediaDevices
      ?.getUserMedia({ audio: true })
      .then((stream) => stream.getTracks().forEach((tr) => tr.stop()))
      .catch(() => {
        setVoiceHint(t("askSheet.voiceDenied"));
      });
    const recognition = new Ctor();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = true;
    let finalText = "";
    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript ?? "";
        if (event.results[i].isFinal) finalText += transcript;
        else interim += transcript;
      }
      setQuestion((finalText + (interim ? ` ${interim}` : "")).trim());
    };
    recognition.onerror = () => {
      setVoiceHint(t("askSheet.voiceDenied"));
      stopListening();
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      setListening(false);
    };
    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      stopListening();
    }
  }, [stopListening, t]);

  const submitQuestion = useCallback(
    async (queryText: string, submitScope?: AskScope) => {
      const req = requestRef.current;
      const q = queryText.trim();
      if (!q || phase === "working") return;
      stopListening();
      const activeScope = submitScope ?? scope;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase("working");
      setError(null);
      setExpanded(false);
      setFollowUps([]);
      setTraceHits(null);
      try {
        const result = await askInScope({
          scope: activeScope,
          query: q,
          contextPassage: chipText ?? undefined,
          documentId: req?.documentId,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setAnswer(result);
        setLastQuestion(q);
        setQuestion("");
        setPhase("answered");
        // Follow-up chips from the answer (no keyboard needed for turn two).
        if (!result.retrievalOnly && result.answer.answer.trim()) {
          void runTask(
            studyQuestionsTask,
            { text: result.answer.answer.slice(0, 4000), count: 3 },
            { signal: controller.signal },
          )
            .then((run) => {
              if (!controller.signal.aborted) setFollowUps(parseQuestions(run.output ?? "", 3));
            })
            .catch(() => {});
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    },
    [phase, scope, chipText, stopListening],
  );

  const runConceptTrace = useCallback(async () => {
    const req = requestRef.current;
    const concept = (chipText ?? "").trim();
    if (!concept || tracing) return;
    setTracing(true);
    setTraceHits(null);
    try {
      const config = await resolveEmbeddingConfigForRag().catch(() => undefined);
      const res = await retrieveFromLibrary(concept.slice(0, 500), { k: 8, config });
      const hits: RagHit[] = res.results
        .filter((r) => r.documentId !== req?.documentId)
        .slice(0, 5)
        .map((r) => ({
          documentId: r.documentId,
          documentTitle: r.documentTitle ?? r.documentId,
          chunkIndex: r.location.ordinal,
          chunkText: r.text,
          score: r.score,
        }));
      setTraceHits(hits);
    } catch {
      setTraceHits([]);
    } finally {
      setTracing(false);
    }
  }, [chipText, tracing]);

  const removeChip = useCallback(() => {
    setChipText(null);
    setEditingChip(false);
    // Spec: removing the chip falls back to the current document scope.
    setScope((s) => (s === "passage" ? "document" : s));
  }, []);

  const makeFlashcard = useCallback(() => {
    if (!answer) return;
    const answerText = answer.answer.answer.trim();
    const sources =
      answer.sources.length > 0
        ? "\n\nSources:\n" +
          answer.sources
            .map((s, i) => `[${i + 1}] ${s.documentTitle ?? s.documentId}`)
            .join("\n")
        : "";
    usePendingFlashcardsStore.getState().addCards(
      [
        {
          question: lastQuestion || t("askSheet.title"),
          answer: answerText + sources,
          card_type: "qa",
          tags: ["ask-sheet"],
        },
      ],
      "ask-sheet",
    );
    toast.success(t("askSheet.flashcardCreated"));
  }, [answer, lastQuestion, t, toast]);

  const readAloud = useCallback(async () => {
    const text = answer?.answer.answer.trim();
    if (!text || speaking) return;
    setSpeaking(true);
    try {
      const settings = useSettingsStore.getState().settings;
      const result = await generateSpeech(settings, { text: text.slice(0, 2000) });
      const audio = new Audio(result.audioUrl);
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => setSpeaking(false);
      await audio.play();
    } catch {
      setSpeaking(false);
      toast.error(t("askSheet.askFailed"));
    }
  }, [answer, speaking, t, toast]);

  const copyAnswer = useCallback(async () => {
    const text = answer?.answer.answer.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("askSheet.copied"));
    } catch {
      toast.error(t("askSheet.askFailed"));
    }
  }, [answer, t, toast]);

  const modeLabel = useMemo(() => {
    const kind = indexState?.generatorKind;
    if (kind === "cloud") return t("askSheet.modeCloud");
    if (kind === "none") return t("askSheet.modeRetrievalOnly");
    return t("askSheet.modeOnDevice");
  }, [indexState, t]);

  const answerSummary = useMemo(() => {
    const text = answer?.answer.answer.trim() ?? "";
    if (text.length <= 200) return text;
    return `${text.slice(0, 200).trimEnd()}…`;
  }, [answer]);

  // Card swipe gestures: up expands, down collapses/dismisses.
  const onCardTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0]?.clientY ?? null;
  };
  const onCardTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartY.current;
    touchStartY.current = null;
    if (start == null) return;
    const dy = (e.changedTouches[0]?.clientY ?? start) - start;
    if (dy < -40) setExpanded(true);
    else if (dy > 60) {
      if (expanded) setExpanded(false);
      else onClose();
    }
  };

  if (!isMobile) return null;

  const showFreshness =
    scope === "library" && (indexState?.unindexedCount ?? 0) > 0;

  return (
    <>
      {/* Composer sheet */}
      <MobileContextMenuSheet
        open={open && phase !== "answered"}
        onClose={onClose}
        title={t("askSheet.title")}
        variant="content"
      >
        <div className="px-4 pt-1 pb-4 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
          {phase === "error" && error && (
            <div className="rounded-xl bg-destructive/10 text-destructive text-sm px-3 py-2">
              {t("askSheet.askFailed")}
            </div>
          )}

          {/* Context chip */}
          {chipText != null && !editingChip && (
            <button
              type="button"
              onClick={() => {
                setDraftChip(chipText);
                setEditingChip(true);
              }}
              className="text-left rounded-xl bg-muted/60 border border-border px-3 py-2"
            >
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
                {t("askSheet.contextLabel")}
              </div>
              <div className="text-sm text-foreground line-clamp-3">{chipText}</div>
              <div className="mt-1 flex gap-3">
                <span className="text-xs text-primary">{t("askSheet.editPassage")}</span>
                <span
                  role="button"
                  tabIndex={0}
                  className="text-xs text-muted-foreground"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeChip();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      removeChip();
                    }
                  }}
                >
                  {t("askSheet.removePassage")}
                </span>
              </div>
            </button>
          )}
          {editingChip && (
            <div className="rounded-xl bg-muted/60 border border-border px-3 py-2">
              <textarea
                value={draftChip}
                onChange={(e) => setDraftChip(e.target.value)}
                rows={4}
                className="w-full bg-transparent text-sm text-foreground outline-none resize-y"
              />
              <div className="mt-1 flex gap-3 justify-end">
                <button
                  type="button"
                  className="text-xs text-muted-foreground"
                  onClick={() => setEditingChip(false)}
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="text-xs text-primary font-medium"
                  onClick={() => {
                    setChipText(draftChip.trim() ? draftChip.trim() : null);
                    if (!draftChip.trim()) setScope((s) => (s === "passage" ? "document" : s));
                    setEditingChip(false);
                  }}
                >
                  {t("common.done")}
                </button>
              </div>
            </div>
          )}

          {/* Scope picker */}
          <div>
            <div className="flex rounded-full bg-muted/60 border border-border p-1" role="tablist">
              {SCOPES.map((s) => (
                <button
                  key={s}
                  type="button"
                  role="tab"
                  aria-selected={scope === s}
                  onClick={() => setScope(s)}
                  className={`flex-1 rounded-full px-2 py-1.5 text-[13px] font-medium transition-colors ${
                    scope === s ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  {t(`askSheet.scope${s[0].toUpperCase()}${s.slice(1)}`)}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground px-1">
              {t(`askSheet.scope${scope[0].toUpperCase()}${scope.slice(1)}Hint`)}
            </div>
          </div>

          {/* Question input + voice */}
          <div className="rounded-2xl border border-border bg-card px-3 py-2 flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void submitQuestion(question);
                }
              }}
              rows={2}
              placeholder={t("askSheet.questionPlaceholder")}
              aria-label={t("askSheet.questionPlaceholder")}
              className="flex-1 bg-transparent text-[15px] text-foreground outline-none resize-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => (listening ? stopListening() : startListening())}
              aria-label={t("askSheet.voiceInput")}
              aria-pressed={listening}
              className={`shrink-0 rounded-full p-2.5 transition-colors ${
                listening ? "bg-destructive text-destructive-foreground animate-pulse" : "bg-primary text-primary-foreground"
              }`}
            >
              <Microphone className="w-5 h-5" weight="fill" aria-hidden="true" />
            </button>
          </div>
          {listening && (
            <div className="text-xs text-muted-foreground px-1">{t("askSheet.voiceListening")}</div>
          )}
          {voiceHint && (
            <div className="text-xs text-muted-foreground px-1">{voiceHint}</div>
          )}

          {/* Suggested questions */}
          {suggestions.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void submitQuestion(s)}
                  className="text-left rounded-xl border border-border/70 px-3 py-2 text-sm text-foreground active:bg-muted"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {chipText && (
            <button
              type="button"
              onClick={() => void runConceptTrace()}
              disabled={tracing}
              className="text-left rounded-xl border border-dashed border-border px-3 py-2 text-sm text-primary disabled:opacity-60"
            >
              {tracing ? t("askSheet.retrieving") : t("askSheet.whereElse")}
            </button>
          )}
          {traceHits && (
            <div className="rounded-xl border border-border/70 px-1 py-1">
              {traceHits.length === 0 ? (
                <div className="px-3 py-2 text-sm text-muted-foreground">{t("askSheet.noAnswer")}</div>
              ) : (
                <DocumentQASources citations={traceHits} />
              )}
            </div>
          )}

          {/* Footer: mode + freshness + submit */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="flex flex-col gap-0.5">
              <span className="text-[11px] text-muted-foreground">• {modeLabel}</span>
              {showFreshness && (
                <span className="text-[11px] text-muted-foreground">
                  {t("askSheet.unindexedDisclosure", { count: indexState!.unindexedCount })}
                </span>
              )}
            </div>
            <button
              type="button"
              disabled={!question.trim() || phase === "working"}
              onClick={() => void submitQuestion(question)}
              className="rounded-full bg-primary text-primary-foreground px-5 py-2.5 text-[15px] font-semibold disabled:opacity-40"
            >
              {phase === "working" ? t("askSheet.answering") : t("askSheet.ask")}
            </button>
          </div>
        </div>
      </MobileContextMenuSheet>

      {/* Docked answer card (no scrim — the document stays interactive above it) */}
      {open && (phase === "working" || phase === "answered") && (
        <div className="fixed inset-x-0 bottom-0 z-[9000] flex justify-center pointer-events-none px-3">
          <div
            role="dialog"
            aria-label={t("askSheet.title")}
            onTouchStart={onCardTouchStart}
            onTouchEnd={onCardTouchEnd}
            className="pointer-events-auto w-full max-w-2xl bg-card border border-border rounded-t-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ maxHeight: expanded ? "75dvh" : "32dvh" }}
          >
            <div className="flex justify-center pt-2 pb-1 shrink-0">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="flex items-center justify-between px-4 pb-1 shrink-0">
              <div className="text-sm font-semibold text-foreground truncate">{t("askSheet.title")}</div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={expanded ? t("askSheet.collapse") : t("askSheet.expand")}
                  onClick={() => setExpanded((v) => !v)}
                  className="p-2 rounded-full text-muted-foreground active:bg-muted"
                >
                  {expanded ? <CaretDown className="w-4 h-4" /> : <CaretUp className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  aria-label={t("askSheet.close")}
                  onClick={onClose}
                  className="p-2 rounded-full text-muted-foreground active:bg-muted"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto overscroll-contain px-4 pb-4">
              {phase === "working" && (
                <div className="py-6 flex flex-col items-center gap-2 text-muted-foreground">
                  <div className="h-6 w-6 rounded-full border-2 border-muted-foreground/30 border-t-primary animate-spin" />
                  <div className="text-sm">{t("askSheet.answering")}</div>
                </div>
              )}

              {phase === "answered" && answer && (
                <>
                  {!expanded ? (
                    <button
                      type="button"
                      onClick={() => setExpanded(true)}
                      className="text-left w-full text-[15px] text-foreground leading-relaxed"
                    >
                      {answer.retrievalOnly ? t("askSheet.retrievalOnlyNote") : answerSummary}
                    </button>
                  ) : (
                    <>
                      {answer.retrievalOnly ? (
                        <div className="text-sm text-muted-foreground mb-2">
                          {t("askSheet.retrievalOnlyNote")}
                        </div>
                      ) : (
                        <div className="text-[15px] text-foreground leading-relaxed whitespace-pre-wrap">
                          {answer.answer.answer}
                        </div>
                      )}

                      {answer.sources.length > 0 && (
                        <div className="mt-3">
                          <DocumentQASources
                            citations={answer.sources.map(toRagHit)}
                          />
                        </div>
                      )}

                      {/* Actions */}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={makeFlashcard}
                          className="flex items-center gap-1.5 rounded-full bg-primary text-primary-foreground px-3.5 py-2 text-sm font-medium"
                        >
                          <Sparkle className="w-4 h-4" />
                          {t("askSheet.makeFlashcard")}
                        </button>
                        {!answer.retrievalOnly && (
                          <button
                            type="button"
                            onClick={() => void readAloud()}
                            disabled={speaking}
                            className="flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-sm text-foreground disabled:opacity-50"
                          >
                            <SpeakerHigh className="w-4 h-4" />
                            {t("askSheet.readAloud")}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void copyAnswer()}
                          className="flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-sm text-foreground"
                        >
                          <Copy className="w-4 h-4" />
                          {t("askSheet.copy")}
                        </button>
                      </div>

                      {/* Follow-ups */}
                      {followUps.length > 0 && (
                        <div className="mt-3 flex flex-col gap-1.5">
                          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                            {t("askSheet.followUps")}
                          </div>
                          {followUps.map((f) => (
                            <button
                              key={f}
                              type="button"
                              onClick={() => void submitQuestion(f)}
                              className="text-left rounded-xl border border-border/70 px-3 py-2 text-sm text-foreground active:bg-muted"
                            >
                              {f}
                            </button>
                          ))}
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setPhase("compose");
                          setAnswer(null);
                        }}
                        className="mt-3 flex items-center gap-1.5 text-sm text-primary"
                      >
                        <Plus className="w-4 h-4" />
                        {t("askSheet.newQuestion")}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>

            <div style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom, 0px))" }} className="shrink-0" />
          </div>
        </div>
      )}
    </>
  );
}
