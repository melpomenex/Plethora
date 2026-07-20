/**
 * Hands-free audio read-aloud review mode.
 *
 * Orchestrates the per-card flow:
 *   speak-question → (auto-flip | await-flip) → speak-answer → advance → repeat
 *
 * Built on top of the existing `useTTS` hook, which already handles provider
 * fallback (fal/groq/pocket → Web Speech API). This hook only adds the
 * state machine and integration glue; all TTS provider logic stays in useTTS.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTTS } from "./useTTS";
import { useSettingsStore } from "../stores/settingsStore";

export type AudioReviewStatus =
  | "idle"
  | "speaking-question"
  | "awaiting-flip"
  | "speaking-answer"
  | "advancing"
  | "announcing-schedule";

export interface AudioReviewModeOptions {
  /** Card identifier currently in view (used to trigger the flow on card change). */
  cardId: string | null;
  /** Plain-text question/prompt to speak. */
  questionText: string;
  /** Plain-text answer to speak (empty = no answer step). */
  answerText: string;
  /** Whether the answer is currently revealed. */
  isAnswerShown: boolean;
  /** Triggered when the flow wants to flip the card. */
  onFlip: () => void;
  /**
   * Triggered when the flow wants to advance to the next card. Returning text
   * lets a scheduling flow announce its committed interval before the next
   * question begins.
   */
  onAdvance: () => string | void | Promise<string | void>;
}

export interface AudioReviewModeReturn {
  isEnabled: boolean;
  enable: () => void;
  disable: () => void;
  toggle: () => void;
  status: AudioReviewStatus;
  /** Short-circuit the current utterance and move to the next step. */
  onUserAdvance: () => void;
  lastError: string | null;
  isSupported: boolean;
}

export function useAudioReviewMode(opts: AudioReviewModeOptions): AudioReviewModeReturn {
  const { cardId, questionText, answerText, isAnswerShown, onFlip, onAdvance } = opts;
  const tts = useTTS();
  const settings = useSettingsStore((state) => state.settings);
  const updateSettings = useSettingsStore((state) => state.updateSettings);

  const audioConfig = settings.audioReviewMode ?? {
    enabled: false,
    autoFlip: true,
    autoFlipDelayMs: 1500,
    defaultRating: 3 as const,
  };

  const [isEnabled, setIsEnabled] = useState<boolean>(audioConfig.enabled);
  const [status, setStatus] = useState<AudioReviewStatus>("idle");

  // Refs so the TTS callbacks always see fresh values without re-subscribing.
  const stateRef = useRef({
    cardId,
    questionText,
    answerText,
    isAnswerShown,
    autoFlip: audioConfig.autoFlip,
    autoFlipDelayMs: audioConfig.autoFlipDelayMs,
    onFlip,
    onAdvance,
  });
  stateRef.current = {
    cardId,
    questionText,
    answerText,
    isAnswerShown,
    autoFlip: audioConfig.autoFlip,
    autoFlipDelayMs: audioConfig.autoFlipDelayMs,
    onFlip,
    onAdvance,
  };

  const advanceStepRef = useRef<(() => void) | null>(null);
  const flowGenerationRef = useRef(0);
  const isAdvancingRef = useRef(false);
  const startQuestionRef = useRef<() => void>(() => {});

  const enable = useCallback(() => {
    setIsEnabled(true);
    updateSettings({ audioReviewMode: { ...audioConfig, enabled: true } });
  }, [audioConfig, updateSettings]);

  const disable = useCallback(() => {
    flowGenerationRef.current += 1;
    isAdvancingRef.current = false;
    advanceStepRef.current = null;
    setIsEnabled(false);
    setStatus("idle");
    tts.stop();
    updateSettings({ audioReviewMode: { ...audioConfig, enabled: false } });
  }, [audioConfig, updateSettings, tts]);

  const toggle = useCallback(() => {
    if (isEnabled) disable();
    else enable();
  }, [isEnabled, enable, disable]);

  /**
   * Speak the question, then transition based on autoFlip setting.
   * Bound as the active step so user-advance can short-circuit it.
   */
  const speakQuestion = useCallback(async () => {
    const generation = flowGenerationRef.current;
    const question = stateRef.current.questionText.trim();

    if (question) {
      setStatus("speaking-question");
      advanceStepRef.current = tts.stop;
      await tts.speak(question);
      if (generation !== flowGenerationRef.current) return;
    }

    const { autoFlip, autoFlipDelayMs, onFlip } = stateRef.current;
    setStatus("awaiting-flip");
    if (!autoFlip) {
      advanceStepRef.current = onFlip;
      return;
    }

    await new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, Math.max(0, autoFlipDelayMs));
      advanceStepRef.current = () => {
        window.clearTimeout(timer);
        resolve();
      };
    });
    if (generation !== flowGenerationRef.current) return;
    advanceStepRef.current = null;
    onFlip();
  }, [tts]);

  const speakAnswer = useCallback(async () => {
    const generation = flowGenerationRef.current;
    const startingCardId = stateRef.current.cardId;
    const answer = stateRef.current.answerText.trim();

    if (answer) {
      setStatus("speaking-answer");
      advanceStepRef.current = tts.stop;
      await tts.speak(answer);
      if (generation !== flowGenerationRef.current) return;
    }

    setStatus("advancing");
    advanceStepRef.current = null;
    isAdvancingRef.current = true;
    await new Promise<void>((resolve) => window.setTimeout(resolve, 400));
    if (generation !== flowGenerationRef.current) {
      isAdvancingRef.current = false;
      return;
    }

    try {
      const announcement = await stateRef.current.onAdvance();
      if (generation !== flowGenerationRef.current) return;
      if (typeof announcement === "string" && announcement.trim()) {
        setStatus("announcing-schedule");
        advanceStepRef.current = tts.stop;
        await tts.speak(announcement);
      }
    } catch {
      if (generation === flowGenerationRef.current) setStatus("idle");
      return;
    } finally {
      isAdvancingRef.current = false;
      advanceStepRef.current = null;
    }

    if (generation !== flowGenerationRef.current) return;
    const nextCardId = stateRef.current.cardId;
    if (nextCardId && nextCardId !== startingCardId) {
      flowGenerationRef.current += 1;
      startQuestionRef.current();
    } else {
      setStatus("idle");
    }
  }, [tts]);

  startQuestionRef.current = () => {
    void speakQuestion();
  };

  const onUserAdvance = useCallback(() => {
    const step = advanceStepRef.current;
    if (step) {
      advanceStepRef.current = null;
      step();
    }
  }, []);

  // Drive the flow: (re)start with the question whenever the card changes.
  useEffect(() => {
    if (!isEnabled || !cardId) {
      if (!isAdvancingRef.current) {
        flowGenerationRef.current += 1;
        advanceStepRef.current = null;
        tts.stop();
      }
      setStatus("idle");
      return;
    }
    // Committing an Arena decision changes the card while the interval
    // announcement is still pending. The advancing flow owns that handoff and
    // starts the next question only after the announcement completes.
    if (isAdvancingRef.current) return;

    flowGenerationRef.current += 1;
    tts.stop();
    advanceStepRef.current = null;
    startQuestionRef.current();
    return () => {
      if (!isAdvancingRef.current) {
        flowGenerationRef.current += 1;
        advanceStepRef.current = null;
        tts.stop();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, isEnabled]);

  // When the answer becomes shown (either via auto-flip or manual flip), speak it.
  useEffect(() => {
    if (!isEnabled || !cardId) return;
    if (isAnswerShown && status === "awaiting-flip") {
      speakAnswer();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnswerShown, status, isEnabled, cardId]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      flowGenerationRef.current += 1;
      isAdvancingRef.current = false;
      advanceStepRef.current = null;
      tts.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    isEnabled,
    enable,
    disable,
    toggle,
    status,
    onUserAdvance,
    lastError: tts.lastError,
    isSupported: tts.isSupported,
  };
}
