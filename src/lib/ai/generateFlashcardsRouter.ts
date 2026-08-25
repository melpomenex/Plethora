/**
 * Route flashcard generation through the best on-device path: Gemini Nano's
 * optimized chunking pipeline on Android, or the task router (Apple FM, etc.).
 */

import type { GeneratedFlashcard } from "../../api/ai";
import { parseGeneratedFlashcards } from "./parseGenerated";
import {
  generateFlashcards as generateFlashcardsOnDevice,
  isOnDeviceAiAvailable,
  OnDeviceAiError,
  type GenerateFlashcardsOptions,
} from "./onDeviceAI";
import { fnv1aHash } from "./providers/types";
import {
  APPLE_FOUNDATION_PROVIDER_ID,
  getAppleFoundationProvider,
} from "./providers/appleFoundationProvider";
import { ON_DEVICE_PROVIDER_ID } from "./providers/onDeviceProvider";
import { runTask } from "./tasks/runTask";
import { flashcardGenerationTask } from "./tasks/definitions/flashcardGenerationTask";

export interface GenerateFlashcardsRouterOptions extends GenerateFlashcardsOptions {
  /** Pin a catalog on-device provider; omit to let the router choose. */
  providerId?: string;
}

export async function generateFlashcardsWithRouter(
  text: string,
  options: GenerateFlashcardsRouterOptions = {}
): Promise<GeneratedFlashcard[]> {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new OnDeviceAiError("invalid_argument", "Cannot generate cards from empty text.");
  }

  const count = Math.max(1, options.count ?? 5);
  const tags = options.tags ?? [];
  const targetId = fnv1aHash(`flashcards\u0000${trimmed.slice(0, 4096)}\u0000${count}`);

  const useNanoPipeline =
    (!options.providerId || options.providerId === ON_DEVICE_PROVIDER_ID) &&
    (await isOnDeviceAiAvailable()).status === "available";

  if (useNanoPipeline) {
    return generateFlashcardsOnDevice(trimmed, { ...options, count, tags });
  }

  const provider =
    options.providerId === APPLE_FOUNDATION_PROVIDER_ID
      ? getAppleFoundationProvider()
      : undefined;

  const run = await runTask(
    flashcardGenerationTask,
    { text: trimmed, count },
    {
      kind: "ondevice",
      provider,
      signal: options.signal,
      targetId,
    }
  );

  return parseGeneratedFlashcards(run.text, tags).slice(0, count);
}
