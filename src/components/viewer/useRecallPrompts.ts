/**
 * Active-recall prompt controller (task 5.5, design D19).
 *
 * Wires the interruption policy, the recall-question task, fingerprint
 * dedup, and the recall-prompt history into one viewer-level state machine:
 *
 *   eligibility tick (every 30 s) → policy verdict → sample already-read
 *   chunks → RecallQuestionTask → fingerprint dedup vs 30-day history →
 *   record → overlay.
 *
 * The overlay is rendered by the viewer as a SIBLING of the reading surface
 * (never a modal), so answering or dismissing never remounts the document
 * and the reading position is preserved.
 *
 * Testing seams: every side-effectful dependency is injectable
 * (`deps`) — history API, retrieval, DOM text sampling, and the clock — so
 * the decision logic is unit-testable without a Tauri runtime.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { runRecallQuestion } from "../../lib/ai/tasks/definitions/recallTask";
import { runAssessAnswer } from "../../lib/ai/tasks/definitions/assessmentTask";
import type { AnswerAssessment } from "../../lib/ai/schemas/answerAssessment";
import { fingerprintRecallQuestion, findDuplicatePrompt } from "../../lib/ai/recall/fingerprint";
import {
  decidePromptsEligible,
  localDayString,
  type ActiveRecallMode,
} from "../../lib/ai/recall/interruptionPolicy";
import {
  getRecentRecallPrompts,
  recordRecallPrompt,
  setRecallPromptOutcome,
  type RecallPromptOutcome,
  type RecallPromptRecord,
} from "../../api/recall-history";
import { retrieveFromLibrary } from "../../api/ai-learning";
import {
  approximateReadParagraphs,
  buildApproxChunks,
  chunkTextOverlapsRead,
  chooseRecallChunks,
  estimateConceptDensity,
  type ReadChunkCandidate,
} from "./recallChunkSampling";

/** Eligibility check cadence (task 5.5: low-frequency, ≥ 30 s). */
export const RECALL_TICK_MS = 30_000;

const DISMISSAL_STORAGE_KEY = "plethora-recall-dismissed-until";
const systemNow = () => new Date();

export interface ActiveRecallPrompt {
  promptId: string;
  question: string;
  expectedAnswer: string;
  conceptKeys: string[];
  chunkIds: string[];
  /** Joined chunk texts — used as the passage when promoting to a card. */
  chunkTexts: string[];
  fingerprint: string;
}

export interface RecallPromptControllerOptions {
  /** `features.aiActiveRecall` gate — the master switch for the whole flow. */
  enabled: boolean;
  /** `settings.ai.activeRecallMode` (off/low/adaptive/intensive). */
  mode: ActiveRecallMode;
  /** Resolved AI availability (on-device or cloud) for task execution. */
  aiAvailable: boolean;
  documentId?: string | null;
  documentTitle?: string | null;
  isSelecting: boolean;
  isReflowActive: boolean;
  isPlaybackActive: boolean;
  /** Current scroll percent 0–100 from the viewer's scroll tracking. */
  getScrollPercent: () => number | null;
  /** Optional existing-card coverage of read material, 0–1 (default 0). */
  coverageRatio?: () => number;
  /** Optional recent review-grade trend, -1..1 (default 0). */
  recentGradeTrend?: () => number;
}

export interface RecallPromptDeps {
  fetchRecentPrompts?: typeof getRecentRecallPrompts;
  recordPrompt?: typeof recordRecallPrompt;
  setOutcome?: typeof setRecallPromptOutcome;
  retrieveChunks?: (query: string, documentId: string) => Promise<ReadChunkCandidate[]>;
  readDocumentText?: () => string | null;
  now?: () => Date;
  tickMs?: number;
}

export type RecallPhase = "idle" | "prompt" | "assessing" | "feedback";

export interface RecallControllerState {
  phase: RecallPhase;
  prompt: ActiveRecallPrompt | null;
  assessment: AnswerAssessment | null;
  assessmentError: string | null;
}

function readDismissedUntilToday(now: Date): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(DISMISSAL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeDismissedUntilToday(day: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISSAL_STORAGE_KEY, day);
  } catch {
    // Storage unavailable — the dismissal just won't survive a reload.
  }
}

/** Default DOM sampler: the viewer's scroll container text. */
function defaultReadDocumentText(): string | null {
  if (typeof document === "undefined") return null;
  const container = document.querySelector<HTMLElement>("[data-document-scroll-container]");
  return container?.innerText ?? null;
}

/**
 * Prefer semantically indexed chunks that overlap the read region (real
 * chunk ids); fall back to nothing so the caller can build approx chunks.
 */
async function defaultRetrieveChunks(query: string, documentId: string): Promise<ReadChunkCandidate[]> {
  try {
    const response = await retrieveFromLibrary(query, {
      k: 6,
      filters: { documentIds: [documentId] },
    });
    return response.results.map((result) => ({ id: result.chunkId, text: result.text }));
  } catch {
    return [];
  }
}

export function useRecallPrompts(
  options: RecallPromptControllerOptions,
  deps: RecallPromptDeps = {}
) {
  const {
    fetchRecentPrompts = getRecentRecallPrompts,
    recordPrompt = recordRecallPrompt,
    setOutcome = setRecallPromptOutcome,
    retrieveChunks = defaultRetrieveChunks,
    readDocumentText = defaultReadDocumentText,
    // Keep the default clock referentially stable. An inline default function
    // changes identity on every hook invocation, which re-runs the
    // document-reset effect below and can create an infinite render loop.
    now = systemNow,
    tickMs = RECALL_TICK_MS,
  } = deps;

  const [state, setState] = useState<RecallControllerState>({
    phase: "idle",
    prompt: null,
    assessment: null,
    assessmentError: null,
  });

  // Session-scoped budget bookkeeping (refs, not state — no re-renders).
  const sessionRef = useRef({
    startedAt: now().getTime(),
    lastPromptAt: null as number | null,
    promptsThisSession: 0,
    maxScrollPercent: 0,
    scrollAtLastPrompt: 0,
    chunksSeen: 0,
  });
  const inFlightRef = useRef(false);

  // Latest option values for the interval closure (registered once).
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const eligibilitySignals = useCallback(() => {
    const session = sessionRef.current;
    const current = optionsRef.current.getScrollPercent() ?? 0;
    session.maxScrollPercent = Math.max(session.maxScrollPercent, current);
    const minutes = (now().getTime() - session.startedAt) / 60_000;
    return {
      mode: optionsRef.current.mode,
      minutesSinceLastPrompt:
        session.lastPromptAt === null
          ? null
          : (now().getTime() - session.lastPromptAt) / 60_000,
      promptsThisSession: session.promptsThisSession,
      isSelecting: optionsRef.current.isSelecting,
      isReflowActive: optionsRef.current.isReflowActive,
      isPlaybackActive: optionsRef.current.isPlaybackActive,
      dismissedUntilTomorrow: readDismissedUntilToday(now()),
      today: localDayString(now()),
      readingProgressDelta:
        Math.max(0, session.maxScrollPercent - session.scrollAtLastPrompt) / 100,
      conceptDensity: estimateConceptDensity(session.chunksSeen, minutes),
      recentGradeTrend: optionsRef.current.recentGradeTrend?.() ?? 0,
      coverageRatio: optionsRef.current.coverageRatio?.() ?? 0,
      minutesReadThisSession: minutes,
    };
  }, [now]);

  const tryGeneratePrompt = useCallback(async () => {
    const current = optionsRef.current;
    const session = sessionRef.current;
    const documentText = readDocumentText();
    if (!documentText) return;

    const readFraction = session.maxScrollPercent / 100;
    const readParagraphs = approximateReadParagraphs(documentText, readFraction);
    if (readParagraphs.length === 0) return;
    const readText = readParagraphs.join("\n\n");

    // Indexed chunks that verifiably sit in the read region (real ids);
    // otherwise approximate with the recently-passed paragraphs themselves.
    let chunks: ReadChunkCandidate[] = [];
    if (current.documentId) {
      const retrieved = await retrieveChunks(readText.slice(0, 400), current.documentId);
      chunks = retrieved.filter((chunk) => chunkTextOverlapsRead(chunk.text, readText));
    }
    if (chunks.length === 0) {
      // Approximation path: the recently-passed paragraphs ARE the chunks.
      chunks = buildApproxChunks(readParagraphs);
    }
    session.chunksSeen = Math.max(session.chunksSeen, chunks.length);

    // Recent history for the 30-day dedup window (document-scoped).
    let history: RecallPromptRecord[] = [];
    try {
      history = await fetchRecentPrompts(current.documentId ?? null);
    } catch {
      history = []; // dedup degrades to session-only, prompts still work
    }

    // Up to 3 attempts with shrinking chunk counts, dropping near-dupes.
    for (let attempt = 3; attempt >= 1 && chunks.length > 0; attempt--) {
      const selected = chooseRecallChunks(chunks, attempt);
      let proposal;
      try {
        ({ proposal } = await runRecallQuestion({
          chunks: selected,
          documentTitle: current.documentTitle ?? undefined,
        }));
      } catch {
        return; // generation failed — silently skip this tick
      }

      const fingerprint = fingerprintRecallQuestion(proposal.question, proposal.conceptKeys);
      const duplicate = findDuplicatePrompt(
        { question: proposal.question, conceptKeys: proposal.conceptKeys, fingerprint },
        history
      );
      if (duplicate) {
        chunks = chunks.filter((chunk) => !proposal.chunkRefs.includes(chunk.id));
        continue;
      }

      try {
        const record = await recordPrompt({
          documentId: current.documentId ?? null,
          chunkIds: proposal.chunkRefs,
          fingerprint,
          question: proposal.question,
          outcome: "asked",
        });
        session.lastPromptAt = now().getTime();
        session.promptsThisSession += 1;
        session.scrollAtLastPrompt = session.maxScrollPercent;
        setState({
          phase: "prompt",
          prompt: {
            promptId: record.id,
            question: proposal.question,
            expectedAnswer: proposal.expectedAnswer,
            conceptKeys: proposal.conceptKeys,
            chunkIds: proposal.chunkRefs,
            chunkTexts: selected.map((chunk) => chunk.text),
            fingerprint,
          },
          assessment: null,
          assessmentError: null,
        });
      } catch {
        return; // history write failed — do not show an unrecorded prompt
      }
      return;
    }
    // Every candidate duplicated recent history: no prompt this tick
    // (spec: "it is discarded and another candidate (or no prompt) is used").
  }, [fetchRecentPrompts, recordPrompt, retrieveChunks, readDocumentText, now]);

  // Low-frequency eligibility loop. Skips entirely when the feature is off
  // or AI is unavailable — zero timers, zero work.
  useEffect(() => {
    if (!options.enabled || options.mode === "off" || !options.aiAvailable) return;
    const evaluate = () => {
      if (inFlightRef.current || state.phase !== "idle") return;
      const verdict = decidePromptsEligible(eligibilitySignals());
      if (!verdict.eligible) return;
      inFlightRef.current = true;
      void tryGeneratePrompt()
        .catch(() => undefined)
        .finally(() => {
          inFlightRef.current = false;
        });
    };
    const timer = window.setInterval(evaluate, tickMs);
    return () => window.clearInterval(timer);
    // `state.phase` in the deps re-registers the interval when a prompt
    // appears/disappears so `evaluate` always sees the live phase.
  }, [options.enabled, options.mode, options.aiAvailable, tickMs, eligibilitySignals, tryGeneratePrompt, state.phase]);

  // Reset the session when the document changes.
  useEffect(() => {
    sessionRef.current = {
      startedAt: now().getTime(),
      lastPromptAt: null,
      promptsThisSession: 0,
      maxScrollPercent: 0,
      scrollAtLastPrompt: 0,
      chunksSeen: 0,
    };
    inFlightRef.current = false;
    setState({ phase: "idle", prompt: null, assessment: null, assessmentError: null });
  }, [options.documentId, now]);

  /** Submit an answer: assess it, then show feedback in place. */
  const submitAnswer = useCallback(
    async (answer: string) => {
      const prompt = state.prompt;
      if (!prompt || state.phase !== "prompt") return;
      setState((prev) => ({ ...prev, phase: "assessing", assessmentError: null }));
      try {
        const { assessment } = await runAssessAnswer({
          question: prompt.question,
          expectedAnswer: prompt.expectedAnswer,
          userAnswer: answer,
          sourceContext: prompt.chunkTexts.join("\n\n"),
        });
        setState((prev) => ({ ...prev, phase: "feedback", assessment }));
        void setOutcome(prompt.promptId, "answered").catch(() => undefined);
      } catch (err) {
        // Assessment is advisory: show the error, keep the answer flow.
        setState((prev) => ({
          ...prev,
          phase: "feedback",
          assessment: null,
          assessmentError: err instanceof Error ? err.message : String(err),
        }));
        void setOutcome(prompt.promptId, "answered").catch(() => undefined);
      }
    },
    [state.prompt, state.phase, setOutcome]
  );

  /** Dismiss the overlay without answering. */
  const dismiss = useCallback(
    (outcome: Extract<RecallPromptOutcome, "dismissed" | "promoted"> = "dismissed") => {
      const prompt = state.prompt;
      if (prompt) {
        void setOutcome(prompt.promptId, outcome).catch(() => undefined);
      }
      setState({ phase: "idle", prompt: null, assessment: null, assessmentError: null });
    },
    [state.prompt, setOutcome]
  );

  /** "Don't ask again today" — suppressed until the next calendar day. */
  const notToday = useCallback(() => {
    writeDismissedUntilToday(localDayString(now()));
    dismiss("dismissed");
  }, [dismiss, now]);

  /** "Keep this question" — the viewer promotes it through the preview flow. */
  const keepQuestion = useCallback(() => {
    const prompt = state.prompt;
    if (!prompt) return null;
    dismiss("promoted");
    return {
      question: prompt.question,
      expectedAnswer: prompt.expectedAnswer,
      conceptKeys: prompt.conceptKeys,
      chunkIds: prompt.chunkIds,
      passage: prompt.chunkTexts.join("\n\n"),
    };
  }, [state.prompt, dismiss]);

  const eligibilityRef = useRef(eligibilitySignals);
  eligibilityRef.current = eligibilitySignals;

  /** Exposed for tests/diagnostics: the current policy verdict. */
  const currentVerdict = useRef(decidePromptsEligible(eligibilityRef.current()));
  currentVerdict.current = decidePromptsEligible(eligibilityRef.current());

  return { ...state, submitAnswer, dismiss, notToday, keepQuestion, currentVerdict: currentVerdict.current };
}
