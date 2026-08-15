/**
 * Task adapters for Flashcard Studio customization and Review Assistance.
 *
 * Hint generation and card explanation execute their `AITaskDefinition`s
 * through `runTask` (design D4/D30). `explainCard` keeps its resilient
 * execution chain: streaming attempt → non-streaming attempt → canned
 * fallback; card text and source context enter prompts only inside untrusted
 * blocks (design D9).
 */

import { OnDeviceAiError } from "./onDeviceAI";
import { extractClozeDeletion, normalizeText } from "./cardValidator";
import { resolveAiPath } from "./provider";
import { fnv1aHash } from "./providers/types";
import { runTask } from "./tasks/runTask";
import {
  explainCardTask,
  reviewHintTask,
} from "./tasks/definitions/studioTasks";

export interface ReviewHintResult {
  hint: string;
  baseModelName?: string;
}

export interface CardExplanationResult {
  explanation: string;
  baseModelName?: string;
}

/**
 * Helper to resolve question and answer text, extracting cloze deletions if answer is empty.
 */
function resolveCardText(card: { question: string; answer?: string; cloze_text?: string }) {
  const rawQ = card.question?.trim() || "";
  const rawA = card.answer?.trim() || "";
  const rawC = card.cloze_text?.trim() || "";

  if (!rawQ && !rawC) {
    throw new OnDeviceAiError("invalid_argument", "Card question and answer cannot be empty.");
  }
  if (!rawA && !rawC && !rawQ) {
    throw new OnDeviceAiError("invalid_argument", "Card question and answer cannot be empty.");
  }

  let q = rawQ;
  let a = rawA;

  if (!a && rawC) {
    a = extractClozeDeletion(rawC) || rawC;
  }
  if (!a && q) {
    a = extractClozeDeletion(q) || "the key concept in the question";
  }
  if (!q && rawC) {
    q = rawC;
  }

  if (!q || !a) {
    throw new OnDeviceAiError("invalid_argument", "Card question and answer cannot be empty.");
  }

  return { q, a };
}

/**
 * Generate a subtle hint for a review card without revealing the answer.
 */
export async function generateReviewHint(
  card: { question: string; answer?: string; cloze_text?: string; card_type: string },
  options: { signal?: AbortSignal } = {}
): Promise<ReviewHintResult> {
  const { q, a } = resolveCardText(card);

  const res = await runTask(
    reviewHintTask,
    { question: q, answer: a },
    {
      kind: "ondevice",
      signal: options.signal,
      targetId: fnv1aHash(`studio-review-hint\u0000${q}\u0000${a}`),
    }
  );
  let hintText = res.text.trim();

  // Leakage check: ensure direct answer text is not contained in hint
  const normA = normalizeText(a);
  const normH = normalizeText(hintText);
  if (normA && normH.includes(normA)) {
    hintText = "Think about the key concepts introduced in this topic.";
  }

  return {
    hint: hintText || "Focus on the main relationship between the terms in the question.",
    baseModelName: res.baseModelName,
  };
}

/**
 * Explain a flashcard's answer based on the card and optional source context.
 */
export async function explainCard(
  card: { question: string; answer?: string; cloze_text?: string; card_type: string },
  sourceContext?: string,
  options: { signal?: AbortSignal; onChunk?: (chunk: string) => void } = {}
): Promise<CardExplanationResult> {
  const { q, a } = resolveCardText(card);
  const input = { question: q, answer: a, sourceContext: sourceContext?.trim() || undefined };
  const targetId = fnv1aHash(`studio-explain-card\u0000${q}\u0000${a}`);

  const path = await resolveAiPath("prompt");

  if (path === "ondevice" || options.onChunk) {
    try {
      const res = await runTask(explainCardTask, input, {
        kind: "ondevice",
        signal: options.signal,
        onChunk: options.onChunk,
        targetId,
      });
      const explanation = res.text.trim();
      if (explanation) {
        return {
          explanation,
          baseModelName: res.baseModelName,
        };
      }
    } catch (err) {
      console.warn("[explainCard] Streaming failed, falling back to native prompt:", err);
    }
  }

  try {
    const res = await runTask(explainCardTask, input, {
      kind: "ondevice",
      signal: options.signal,
      targetId: `${targetId}-bulk`,
      streaming: false,
    });
    const text = res.text.trim();
    if (text) {
      options.onChunk?.(text);
      return {
        explanation: text,
        baseModelName: res.baseModelName,
      };
    }
  } catch (err) {
    console.warn("[explainCard] generateNativePrompt failed:", err);
  }

  return {
    explanation: `The answer "${a}" directly answers the question "${q}".`,
  };
}
