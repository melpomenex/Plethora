/**
 * Task definitions for Image Study / Image Registry / Occlusions (task 1.8).
 *
 * Phase-0 behavior preservation: these legacy image tasks do not hard-gate on
 * the vision capability (`requiresVision` unset) — the native bridge's own
 * `feature_unavailable` error maps to `VisionUnavailable` through the unified
 * taxonomy. New vision tasks (Phase 2 occlusion) set `requiresVision: true`.
 */

import { UNTRUSTED_CONTAINMENT_CLAUSE } from "../containment";
import { registerTasks } from "../registry";
import type { AITaskDefinition, AITaskBuiltInput } from "../types";

function imageSystemInstruction(core: string): string {
  return `${UNTRUSTED_CONTAINMENT_CLAUSE}\n${core}`;
}

export interface ImageTaskInput {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  dataBase64: string;
  count?: number;
}

function imageBuildInput(core: string): (input: ImageTaskInput) => AITaskBuiltInput {
  return (input) => ({
    text: core,
    image: { mimeType: input.mimeType, data: input.dataBase64 },
  });
}

export const describeImageTask: AITaskDefinition<ImageTaskInput, string> = {
  id: "image-describe",
  taskType: "image-prompt",
  modelClass: "full",
  systemInstruction: imageSystemInstruction(
    "You analyze images for a study registry: concise description, short title, and topical tags, in the exact requested format."
  ),
  buildInput: imageBuildInput(
    [
      "Analyze the image and provide a concise description, a short title, and 3-5 tags.",
      "Format exactly as:",
      "TITLE: <short title>",
      "DESCRIPTION: <2-3 sentence summary>",
      "TAGS: tag1, tag2, tag3",
    ].join("\n")
  ),
  outputKind: "text",
  maxOutputTokens: 256,
  timeoutMs: 120_000,
  streaming: false,
};

export const imageCardsTask: AITaskDefinition<ImageTaskInput, string> = {
  id: "image-cards",
  taskType: "image-prompt",
  modelClass: "full",
  systemInstruction: imageSystemInstruction(
    "You write clear study flashcards from the visible content, text, or diagrams in an image, in the exact requested format."
  ),
  buildInput: (input) =>
    imageBuildInput(
      [
        `Write up to ${input.count ?? 3} clear flashcards based on the visible content, text, or diagram in the image.`,
        "Format each card as:",
        "Q: <question>",
        "A: <answer>",
        "EVIDENCE: <description of visible region>",
      ].join("\n")
    )(input),
  outputKind: "text",
  maxOutputTokens: 512,
  timeoutMs: 120_000,
  streaming: false,
};

export const imageOcclusionsTask: AITaskDefinition<ImageTaskInput, string> = {
  id: "image-occlusions",
  taskType: "image-prompt",
  modelClass: "full",
  systemInstruction: imageSystemInstruction(
    "You identify study-worthy labels or diagram parts in an image and report them as normalized occlusion rectangles in the exact requested format."
  ),
  buildInput: imageBuildInput(
    [
      "Identify up to 4 key text labels or diagram parts in the image that should be occluded for study.",
      "Output each occlusion on a line as normalized coordinates (0.0 to 1.0):",
      "RECT: x, y, width, height | label",
    ].join("\n")
  ),
  outputKind: "text",
  maxOutputTokens: 256,
  timeoutMs: 120_000,
  streaming: false,
};

registerTasks(describeImageTask, imageCardsTask, imageOcclusionsTask);
