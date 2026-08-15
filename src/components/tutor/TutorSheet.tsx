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
  onClose,
}: TutorSheetProps) {
  const { t } = useI18n();
  const ai = useAiAvailability("prompt");

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

  const resolvedTopic = topic?.trim() || deriveTopicFromMaterial(material);

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
  }, []);

  useEffect(() => {
    if (!open) {
      reset();
      return;
    }
    if (sessionRef.current || startAttemptedRef.current) return;

    startAttemptedRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setStarting(true);
    setError(null);

    TutorSession.start(
      { topic: resolvedTopic, material },
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
  }, [open, reset, resolvedTopic, material]);

  // Abort whatever is in flight when the sheet unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

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
              {resolvedTopic}
            </p>
            {session && policy && (
              <p className="text-[11px] text-muted-foreground">
                {t("aiTutor.turns", {
                  count: policy.tutorTurnCount,
                  max: session.limits.maxSessionTurns,
                })}
              </p>
            )}
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
        </div>

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
            <p className="text-[13px] text-destructive" data-tutor-error="true">
              {t("aiTutor.error", { message: error })}
            </p>
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
          !starting && (
            <TutorComposer
              value={answer}
              onChange={setAnswer}
              onSubmit={submitAnswer}
              onExplain={justExplain}
              disabled={running}
            />
          )
        )}
      </div>
    </MobileContextMenuSheet>
  );
}
