/**
 * Session-level state for the optional free-response assessment (task 5.8,
 * design D20 / flashcard-review-session spec).
 *
 * The state lives HERE, above the card component, because the session
 * renders the question-phase and answer-phase card in different JSX
 * branches — component-local state would be lost the moment the card is
 * revealed. The typed answer, the running assessment, and its result all
 * survive the flip; the review card itself only renders what it is handed.
 *
 * Gating mirrors the spec: nothing runs when `features.aiAnswerAssessment`
 * is off or no assessment-capable provider is available (identical flow,
 * no errors surfaced).
 */

import { useEffect, useRef, useState } from "react";
import type { LearningItem } from "../../api/review";
import type { AnswerAssessment } from "../../lib/ai/schemas/answerAssessment";
import { runAssessAnswer } from "../../lib/ai/tasks/definitions/assessmentTask";
import { useAiAvailability } from "../../lib/ai/useAiAvailability";
import { useSettingsStore } from "../../stores/settingsStore";
import type { CardAssessmentPayload } from "./answerAssessmentIntegration";

export function plainTextFromHtml(html: string): string {
  if (typeof DOMParser === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent || "";
}

export interface CardAnswerAssessmentState {
  /** Typed free response for the current card ("" = skipped). */
  freeResponse: string;
  setFreeResponse: (value: string) => void;
  /** Assessment result after reveal (null until done / forever if skipped). */
  assessment: AnswerAssessment | null;
  assessmentError: string | null;
  assessmentPending: boolean;
  /** The persistence payload once an assessment succeeded. */
  payload: CardAssessmentPayload | null;
  /** True when the free-response input should render for this card. */
  inputEnabled: boolean;
}

export function useCardAnswerAssessment(params: {
  card: LearningItem | null;
  showAnswer: boolean;
}): CardAnswerAssessmentState {
  const { card, showAnswer } = params;
  const flagEnabled = useSettingsStore((s) => s.settings.features.aiAnswerAssessment);
  const availability = useAiAvailability("prompt");
  const available = flagEnabled && availability.available && !availability.loading;

  const [freeResponse, setFreeResponse] = useState("");
  const [assessment, setAssessment] = useState<AnswerAssessment | null>(null);
  const [assessmentError, setAssessmentError] = useState<string | null>(null);
  const [assessmentPending, setAssessmentPending] = useState(false);
  const [payload, setPayload] = useState<CardAssessmentPayload | null>(null);
  const firedRef = useRef(false);

  // Fresh card → fresh capture. Also drop the payload so a stale assessment
  // can never be recorded against the next card.
  useEffect(() => {
    setFreeResponse("");
    setAssessment(null);
    setAssessmentError(null);
    setAssessmentPending(false);
    setPayload(null);
    firedRef.current = false;
  }, [card?.id]);

  // Interaction cards (multiple choice, image occlusion) answer through
  // their own flow; a typed response makes no sense there.
  const interactionMetadata = (
    (card as unknown as Record<string, unknown>)?.interaction_metadata ??
    (card as unknown as Record<string, unknown>)?.interactionMetadata
  ) as Record<string, unknown> | undefined;
  const isInteractionCard = Boolean(
    interactionMetadata &&
      (Array.isArray(interactionMetadata.multipleChoiceOptions) ||
        Array.isArray(interactionMetadata.imageOcclusionRegions))
  );

  const question = card ? plainTextFromHtml(card.question || card.cloze_text || "") : "";
  const expectedAnswer = card ? plainTextFromHtml(card.answer || "") : "";

  // Assess on reveal, once per card, only when the user actually typed an
  // answer. Failures degrade to a neutral note — grading is never blocked.
  useEffect(() => {
    if (!showAnswer || firedRef.current) return;
    const userAnswer = freeResponse.trim();
    if (!available || !card || userAnswer.length === 0 || !expectedAnswer) return;
    firedRef.current = true;
    let cancelled = false;
    setAssessmentPending(true);
    void runAssessAnswer({ question, expectedAnswer, userAnswer })
      .then(({ assessment: result, run }) => {
        if (cancelled) return;
        setAssessment(result);
        setAssessmentPending(false);
        setPayload({
          cardId: card.id,
          question,
          expectedAnswer,
          userAnswer,
          assessment: result,
          provider: run.providerId,
          model: run.baseModelName ?? null,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setAssessmentPending(false);
        setAssessmentError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
    // question/expectedAnswer derive from `card`; freeResponse is read at
    // flip time from the current closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAnswer, card?.id, available]);

  return {
    freeResponse,
    setFreeResponse,
    assessment,
    assessmentError,
    assessmentPending,
    payload,
    inputEnabled: available && !isInteractionCard,
  };
}
