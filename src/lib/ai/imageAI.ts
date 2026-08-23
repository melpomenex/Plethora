/**
 * Task adapters and vision processing for Image Study, Image Registry, and Occlusions.
 *
 * Each adapter executes its `AITaskDefinition` through `runTask` (design
 * D4/D30) with the on-device provider pinned; delimited-format parsing, card
 * validation/dedup, and occlusion clamping stay here as post-processing.
 */

import { describeOnDeviceImage, OnDeviceAiError } from "./onDeviceAI";
import { parseDelimitedFlashcardsWithEvidence, deduplicateOnDeviceCards, toGeneratedFlashcards, type InternalOnDeviceFlashcard } from "./cardValidator";
import type { GeneratedFlashcard } from "../../api/ai";
import { fnv1aHash } from "./providers/types";
import { runTask } from "./tasks/runTask";
import {
  describeImageTask,
  imageCardsTask,
  imageOcclusionsTask,
} from "./tasks/definitions/imageTasks";

export interface ImageInputPayload {
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  dataBase64: string;
}

export interface ImageDescriptionResult {
  description: string;
  suggestedTitle?: string;
  suggestedTags: string[];
  provenance: string;
}

export interface OcclusionProposal {
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  rationale?: string;
}

const SUPPORTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_ENCODED_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Validate image payload before sending to native bridge.
 */
export function validateImagePayload(payload: ImageInputPayload): void {
  if (!payload || !payload.dataBase64) {
    throw new OnDeviceAiError("invalid_image", "Image data payload cannot be empty.");
  }
  if (!SUPPORTED_MIME_TYPES.has(payload.mimeType)) {
    throw new OnDeviceAiError("invalid_image", `Unsupported image MIME type: ${payload.mimeType}`);
  }
  if (payload.dataBase64.length > MAX_ENCODED_SIZE_BYTES * 1.35) {
    throw new OnDeviceAiError("image_too_large", "Image payload exceeds maximum allowed size (5MB).");
  }
}

function imageTargetId(taskId: string, image: ImageInputPayload): string {
  return fnv1aHash(`${taskId}\u0000${image.mimeType}\u0000${image.dataBase64.length}\u0000${image.dataBase64.slice(0, 64)}`);
}

/**
 * Describe an image and suggest searchable metadata without overwriting existing registry fields.
 */
export async function describeImage(
  image: ImageInputPayload
): Promise<ImageDescriptionResult> {
  validateImagePayload(image);

  try {
    const native = (await describeOnDeviceImage(image.dataBase64)).trim();
    if (native) {
      return {
        description: native,
        suggestedTags: [],
        provenance: "ondevice-image-description",
      };
    }
  } catch {
    // Image Description is optional; Prompt / cloud path below still runs.
  }

  const res = await runTask(
    describeImageTask,
    { mimeType: image.mimeType, dataBase64: image.dataBase64 },
    { kind: "ondevice", targetId: imageTargetId("image-describe", image) }
  );

  let description = "";
  let suggestedTitle: string | undefined;
  let suggestedTags: string[] = [];

  for (const rawLine of res.text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.toUpperCase().startsWith("TITLE:")) {
      suggestedTitle = line.slice(6).trim();
    } else if (line.toUpperCase().startsWith("DESCRIPTION:")) {
      description = line.slice(12).trim();
    } else if (line.toUpperCase().startsWith("TAGS:")) {
      suggestedTags = line
        .slice(5)
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
    }
  }

  if (!description) description = res.text.trim();

  return {
    description,
    suggestedTitle,
    suggestedTags,
    provenance: res.baseModelName || "ondevice-gemini-nano",
  };
}

/**
 * Generate flashcards from an image asset.
 */
export async function generateImageCards(
  image: ImageInputPayload,
  count = 3
): Promise<GeneratedFlashcard[]> {
  validateImagePayload(image);

  const res = await runTask(
    imageCardsTask,
    { mimeType: image.mimeType, dataBase64: image.dataBase64, count },
    { kind: "ondevice", targetId: imageTargetId("image-cards", image) }
  );

  const parsed = parseDelimitedFlashcardsWithEvidence(res.text, "image asset", ["image-study"]);
  const unique = deduplicateOnDeviceCards(parsed);
  return toGeneratedFlashcards(unique);
}

/**
 * Suggest image occlusions (bounding boxes) for active recall study.
 */
export async function suggestOcclusions(
  image: ImageInputPayload
): Promise<OcclusionProposal[]> {
  validateImagePayload(image);

  const res = await runTask(
    imageOcclusionsTask,
    { mimeType: image.mimeType, dataBase64: image.dataBase64 },
    { kind: "ondevice", targetId: imageTargetId("image-occlusions", image) }
  );

  const proposals: OcclusionProposal[] = [];

  for (const rawLine of res.text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.toUpperCase().startsWith("RECT:")) continue;

    const body = line.slice(5).trim();
    const parts = body.split("|");
    const coordsStr = parts[0].trim();
    const label = parts[1]?.trim();

    const nums = coordsStr.split(",").map((n) => parseFloat(n.trim()));
    if (nums.length >= 4 && nums.every((n) => !isNaN(n))) {
      let [x, y, w, h] = nums;
      // Clamp bounds to 0..1
      x = Math.max(0, Math.min(1, x));
      y = Math.max(0, Math.min(1, y));
      w = Math.max(0.01, Math.min(1 - x, w));
      h = Math.max(0.01, Math.min(1 - y, h));

      // Minimum area check (0.001 of total image area)
      if (w * h >= 0.001) {
        proposals.push({ x, y, width: w, height: h, label });
      }
    }
  }

  return proposals;
}
