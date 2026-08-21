/**
 * TutorSheet — the Socratic tutoring surface (task 7.3, design D24).
 *
 * Deliberately distinct from the Q&A surfaces: a scrolling conversation of
 * tutor turns (move chip + hint pips + stuck indicator) and user bubbles, a
 * live streaming preview of the incoming tutor turn, the always-visible
 * "just explain it" escape hatch, and a session-end state whose
 * "create card from this concept" hands the wrap-up concept to the standard
 * Learn-this preview flow (static-candidates path) — never a direct write.
 *
 * The pure policy lives in `src/lib/ai/tutor/session.ts`; this component only
 * drives it (start, submit, escape hatch) and renders its transcript.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle } from "@phosphor-icons/react";
import { MobileContextMenuSheet } from "../common/MobileContextMenuSheet";
import { useI18n } from "../../lib/i18n";
import { toAIError } from "../../lib/ai/errors";
import { useAiAvailability } from "../../lib/ai/useAiAvailability";
import {
  TutorSession,
  type TutorTranscriptTurn,
} from "../../lib/ai/tutor/session";
import {
  deriveTopicFromMaterial,
  extractStreamingTutorContent,
} from "../../lib/ai/tutor/context";
import { LearnThisProposalSheet } from "../learn/LearnThisProposalSheet";
import { TutorTurnBubble } from "./TutorTurnBubble";
import { TutorComposer } from "./TutorComposer";
import { redactTutorContext, redactTutorMaterial, resolveTutorPrivacyPolicy, type LearnerContextPacket, type TutorMode } from "../../lib/languageTutor";
import { useLLMProvidersStore } from "../../stores/llmProvidersStore";

export interface TutorSheetProps {
  open: boolean;
  /** The selection/passage the session is grounded in. */
  material: string;
  /** Session topic; defaults to a deterministic derivation from the material. */
  topic?: string;
  documentTitle?: string;
  documentId?: string;
  extractId?: string;
  /** Selection context payload recorded with card provenance. */
  selectionContext?: unknown;
  /** Optional bounded language context from LanguageTutorHost. */
  languageContext?: LearnerContextPacket;
  languageMode?: TutorMode;
  onLanguageModeChange?: (mode: TutorMode) => void;
  onWritingPractice?: (prompt: string) => void;
  onClose: () => void;
}

export function TutorSheet({
  open,
  material,
  topic,
  documentTitle,
  documentId,
  extractId,
  selectionContext,
  languageContext,
  languageMode,
  onLanguageModeChange,
  onWritingPractice,
  onClose,
}: TutorSheetProps) {
  const { t } = useI18n();
  const ai = useAiAvailability("prompt");
  const hasByoProvider = useLLMProvidersStore((state) => state.providers.some((provider) => provider.enabled && provider.apiKey.trim().length > 0));

  const sessionRef = useRef<TutorSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startAttemptedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [transcript, setTranscript] = useState<TutorTranscriptTurn[]>([]);
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [showPromotion, setShowPromotion] = useState(false);
  const [cloudConsent, setCloudConsent] = useState<boolean | null>(null);

  const resolvedTopic = topic?.trim() || deriveTopicFromMaterial(material);
  const safeLanguageContext = redactTutorContext(languageContext);
  const languageContextText = safeLanguageContext && safeLanguageContext.items.length > 0
    ? `\n\nLanguage tutor instructions: respond in ${safeLanguageContext.targetLanguage} when practical and explain in ${safeLanguageContext.baseLanguage}; use this bounded learner context only as background: ${safeLanguageContext.items.map((item) => `${item.surface} (${item.state})`).join(", ")}`
    : "";
  const modeInstruction = languageMode === "conversation"
    ? "Practice a short conversation in the target language and correct only material errors."
    : languageMode === "practice"
      ? "Target the learner's bounded vocabulary context with short production prompts."
      : languageMode === "correction"
        ? "Focus on correction categories, explain the reason, and preserve the learner's original wording."
        : "Explain the selected source in a source-grounded way, separating quoted facts from general guidance.";
  const sourceCitation = documentId ? `\n\nSource reference: document ${documentId}; selected material must remain the grounding boundary.` : "";
  const safeMaterial = redactTutorMaterial(material);
  const sessionMaterial = `${modeInstruction}${sourceCitation}\n\n${safeMaterial}${languageContextText}`;
  const sessionTopic = languageMode ? `${resolvedTopic} · ${languageMode}` : resolvedTopic;
  const privacyPolicy = resolveTutorPrivacyPolicy({ aiPath: ai.path, cloudConsent, hasByoProvider });
  const cloudBlocked = privacyPolicy.requiresConsent && Boolean(languageMode) && !privacyPolicy.consented;

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    sessionRef.current = null;
    startAttemptedRef.current = false;
    setTranscript([]);
    setStarting(false);
    setRunning(false);
    setStreamText("");
    setError(null);
    setAnswer("");
    setShowPromotion(false);
    setCloudConsent(null);
  }, []);

  const sessionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      sessionKeyRef.current = null;
      return;
    }
    const key = `${sessionTopic}\u001f${sessionMaterial}`;
    if (sessionKeyRef.current && sessionKeyRef.current !== key) reset();
    sessionKeyRef.current = key;
  }, [open, reset, sessionMaterial, sessionTopic]);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    if (sessionRef.current || startAttemptedRef.current || cloudBlocked) return;

    startAttemptedRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setStarting(true);
    setError(null);

    TutorSession.start(
      { topic: sessionTopic, material: sessionMaterial },
      {},
      {
        signal: controller.signal,
        onChunk: (chunk) => {
          if (!controller.signal.aborted) setStreamText((prev) => prev + chunk);
        },
      }
    )
      .then((session) => {
        if (controller.signal.aborted) return;
        sessionRef.current = session;
        setTranscript([...session.getTranscript()]);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(toAIError(err).message || String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setStarting(false);
      });
  }, [cloudBlocked, open, reset, sessionMaterial, sessionTopic]);

  // Abort whatever is in flight when the sheet unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const exportTranscript = useCallback(() => {
    if (typeof document === "undefined") return;
    const blob = new Blob([JSON.stringify({ topic: sessionTopic, transcript }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "plethora-tutor-session.json";
    link.click();
    URL.revokeObjectURL(url);
  }, [sessionTopic, transcript]);

  // Keep the newest turn in view.
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [transcript, running, streamText]);

  const runCall = useCallback(
    async (
      call: (
        session: TutorSession,
        options: { signal: AbortSignal; onChunk: (chunk: string) => void }
      ) => Promise<unknown>
    ): Promise<boolean> => {
      const session = sessionRef.current;
      if (!session || session.ended || running) return false;
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      setError(null);
      setStreamText("");
      let succeeded = false;
      try {
        await call(session, {
          signal: controller.signal,
          onChunk: (chunk) => {
            if (!controller.signal.aborted) setStreamText((prev) => prev + chunk);
          },
        });
        succeeded = true;
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(toAIError(err).message || String(err));
        }
      } finally {
        if (!controller.signal.aborted) setRunning(false);
        setStreamText("");
      }
      if (!controller.signal.aborted && sessionRef.current) {
        setTranscript([...sessionRef.current.getTranscript()]);
      }
      return succeeded;
    },
    [running]
  );

  const submitAnswer = useCallback(() => {
    const text = answer.trim();
    if (!text) return;
    void runCall((session, options) => session.submitUserAnswer(text, options)).then((ok) => {
      // Keep the typed answer on failure so the learner can retry verbatim.
      if (ok) setAnswer("");
    });
  }, [answer, runCall]);

  const justExplain = useCallback(() => {
    if (answer.trim()) setAnswer("");
    void runCall((session, options) =>
      session.requestExplain(t("aiTutor.justExplainMessage"), options)
    );
  }, [answer, runCall, t]);

  const retryOpening = useCallback(() => {
    startAttemptedRef.current = false;
    setError(null);
  }, []);

  if (!open) return null;

  // Card promotion takes over the surface (standard preview flow).
  if (showPromotion && sessionRef.current) {
    const session = sessionRef.current;
    const promotion = session.getPromotion();
    const meta = session.lastRunMeta;
    return (
      <LearnThisProposalSheet
        open
        text={promotion?.answer ?? material}
        passage={material}
        documentId={documentId}
        documentTitle={documentTitle}
        extractId={extractId}
        selectionContext={selectionContext}
        staticCandidates={
          promotion
            ? [
                {
                  question: promotion.question,
                  answer: promotion.answer,
                  cardType: "qa" as const,
                  conceptKeys: [resolvedTopic],
                },
              ]
            : []
        }
        staticProvenance={{
          provider: meta?.providerId ?? "tutor",
          model: meta?.baseModelName,
          modelClass: meta?.servedModelClass ?? "reasoning",
        }}
        onClose={() => setShowPromotion(false)}
      />
    );
  }

  const session = sessionRef.current;
  const policy = session?.getPolicyState();
  const ended = session?.ended ?? false;
  const streamPreview = running ? extractStreamingTutorContent(streamText) : "";

  return (
    <MobileContextMenuSheet open={open} onClose={onClose} variant="content" title={t("aiTutor.title")}>
      <div data-tutor-sheet="true" className="px-4 pb-4 space-y-3">
        {/* Header: topic, provider indicator, bounded turn budget */}
        <div className="flex items-start gap-2 pt-1">
          <button
            className="p-1 -ml-1 text-muted-foreground"
            aria-label={t("aiTutor.close")}
            onClick={onClose}
          >
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground" data-tutor-topic="true">
              {sessionTopic}
            </p>
            {session && policy && (
              <p className="text-[11px] text-muted-foreground">
                {t("aiTutor.turns", {
                  count: policy.tutorTurnCount,
                  max: session.limits.maxSessionTurns,
                })}
              </p>
            )}
            {languageContext && <p className="text-[11px] text-muted-foreground" data-tutor-context-freshness="true">Language context: {languageContext.freshness}</p>}
            <p className="text-[11px] text-muted-foreground" data-tutor-privacy="true">{privacyPolicy.disclosure} Session retention only.</p>
          </div>
          <span
            className={`text-[11px] px-2 py-0.5 rounded ${
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
            {languageMode && onLanguageModeChange && (
            <select
              aria-label="Language tutor mode"
              className="rounded border border-border bg-background px-1.5 py-1 text-[11px] text-foreground"
              value={languageMode}
              onChange={(event) => onLanguageModeChange(event.target.value as TutorMode)}
            >
              <option value="explain">Explain</option>
              <option value="conversation">Conversation</option>
              <option value="practice">Vocabulary practice</option>
              <option value="correction">Correction</option>
            </select>
            )}
          </div>

        {cloudBlocked && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs" role="alert">
            <p className="font-medium">Cloud tutor consent required</p>
            <p className="mt-1 text-muted-foreground">{privacyPolicy.disclosure}</p>
            {cloudConsent === null ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="rounded bg-primary px-2 py-1 text-primary-foreground" onClick={() => setCloudConsent(true)}>Allow cloud for this session</button>
                <button type="button" className="rounded border border-border px-2 py-1 hover:bg-muted" onClick={() => setCloudConsent(false)}>Keep local</button>
              </div>
            ) : <p className="mt-2 text-muted-foreground">Cloud use is blocked for this session. Configure a local provider or allow cloud to continue.</p>}
          </div>
        )}

        {/* Conversation */}
        <div
          ref={scrollRef}
          className="max-h-[46vh] overflow-y-auto space-y-3 py-1"
          data-tutor-transcript="true"
        >
          {transcript.map((turn, index) => (
            <TutorTurnBubble key={index} turn={turn} />
          ))}

          {(starting || running) && (
            <p
              className="text-[13px] text-muted-foreground"
              data-tutor-pending="true"
            >
              {streamPreview || (starting ? t("aiTutor.opening") : t("aiTutor.thinking"))}
              …
            </p>
          )}

          {error && (
            <div className="space-y-1">
              <p className="text-[13px] text-destructive" data-tutor-error="true">{t("aiTutor.error", { message: error })}</p>
              {!session && <button type="button" className="rounded border border-border px-2 py-1 text-xs hover:bg-muted" onClick={retryOpening}>Retry tutor</button>}
            </div>
          )}
        </div>

        {/* Session end: wrap-up summary + card promotion */}
        {ended ? (
          <div className="space-y-2 pt-1" data-tutor-ended="true">
            <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-success">
              <CheckCircle className="w-4 h-4" aria-hidden="true" />
              {t("aiTutor.sessionEnded")}
            </p>
            <button
              className="w-full rounded-lg bg-primary px-3 py-2 text-[15px] text-primary-foreground"
              onClick={() => setShowPromotion(true)}
            >
              {t("aiTutor.createCard")}
            </button>
            <button
              className="w-full rounded-lg border border-border px-3 py-2 text-[14px] text-foreground"
              onClick={onClose}
            >
              {t("aiTutor.close")}
            </button>
          </div>
        ) : (
          !starting && !cloudBlocked && (
            <div className="space-y-2">
              <TutorComposer
                value={answer}
                onChange={setAnswer}
                onSubmit={submitAnswer}
                onExplain={justExplain}
                disabled={running}
              />
              {languageMode && onWritingPractice && (
                <button
                  type="button"
                  className="w-full rounded-lg border border-primary/40 px-3 py-2 text-xs text-primary hover:bg-primary/10"
                  onClick={() => onWritingPractice(material)}
                >
                  Start writing practice
                </button>
              )}
            </div>
          )
        )}
        {transcript.length > 0 && (
          <div className="flex justify-end gap-2 text-[11px]">
            <button type="button" className="rounded border border-border px-2 py-1 hover:bg-muted" onClick={exportTranscript}>Export session</button>
            <button type="button" className="rounded border border-border px-2 py-1 hover:bg-muted" onClick={reset}>Delete session</button>
          </div>
        )}
      </div>
    </MobileContextMenuSheet>
  );
}
