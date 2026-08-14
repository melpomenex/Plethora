/**
 * Task adapters for Flashcard Studio customization and Review Assistance.
 */

import { generateNativePrompt, generateStreamingPrompt, OnDeviceAiError } from "./onDeviceAI";
import { extractClozeDeletion, normalizeText } from "./cardValidator";
import { resolveAiPath } from "./provider";

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

  const promptText = [
    "Provide a subtle 1-sentence hint for answering the flashcard question below.",
    "CRITICAL CONSTRAINT: Do NOT state the answer or reveal the direct key answer terms.",
    "",
    `Question: ${q}`,
    `Answer: ${a}`,
  ].join("\n");

  const requestId = `hint-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const res = await generateNativePrompt({ requestId, text: promptText, maxOutputTokens: 128 });
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

  const promptText = [
    "Explain why the following flashcard answer is correct in 2 concise sentences.",
    sourceContext ? `Source Context:\n${sourceContext.trim()}\n` : "",
    `Question: ${q}`,
    `Answer: ${a}`,
  ].filter(Boolean).join("\n");

  const requestId = `expcard-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const path = await resolveAiPath("prompt");

  if (path === "ondevice" || options.onChunk) {
    try {
      let text = "";
      const res = await generateStreamingPrompt(
        { requestId, text: promptText, maxOutputTokens: 256 },
        {
          signal: options.signal,
          onChunk: (chunk) => {
            text += chunk;
            options.onChunk?.(chunk);
          },
        }
      );
      const explanation = (res.text || text).trim();
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
    const res = await generateNativePrompt({ requestId, text: promptText, maxOutputTokens: 256 });
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
