import { useSettingsStore, type AIControlsSettings } from "../stores/settingsStore";
import { generateFlashcardsFromExtract, summarizeContent, type GeneratedFlashcard } from "../api/ai";
import { usePendingFlashcardsStore } from "../stores/pendingFlashcardsStore";
import { resolveFlashcardTarget } from "./flashcardTarget";
import { runAiAction } from "../lib/ai/provider";
import { withOnDeviceRun } from "../lib/ai/onDeviceRunStore";
import { generateFlashcardsWithRouter } from "../lib/ai/generateFlashcardsRouter";
import { summarize as summarizeOnDevice } from "../lib/ai/onDeviceAI";

const SUMMARY_WORD_MAP: Record<AIControlsSettings["summaryLength"], number> = {
  short: 100,
  medium: 250,
  long: 500,
};

/**
 * Tag applied to cards produced by the on-device model, so a reviewer can tell
 * them from cloud-generated ones wherever card tags are shown.
 */
export const ON_DEVICE_TAG = "on-device";

export function getSummaryWordCount(length: AIControlsSettings["summaryLength"]): number {
  return SUMMARY_WORD_MAP[length];
}

export async function handleAutoGeneration(
  extractId: string,
  content: string
): Promise<GeneratedFlashcard[]> {
  const settings = useSettingsStore.getState().settings.ai.aiControls;
  if (!settings.autoGenerate) return [];

  const target = resolveFlashcardTarget(settings, content);
  // Null means no AI path is configured at all — nothing to generate from.
  const cards =
    (await runAiAction(
      {
        onDevice: () =>
          withOnDeviceRun("Flashcard generation", ({ signal, onProgress }) =>
            generateFlashcardsWithRouter(content, {
              count: target.count,
              tags: [ON_DEVICE_TAG],
              signal,
              onProgress,
            })
          ),
        cloud: () =>
          generateFlashcardsFromExtract(extractId, {
            count: target.count,
            include_cloze: true,
            include_qa: true,
          }),
      },
      "Flashcard generation"
    )) ?? [];

  const filtered = settings.qualityThreshold > 0
    ? cards.filter((c) => (c as any).confidence === undefined || (c as any).confidence >= settings.qualityThreshold)
    : cards;

  if (settings.requireApproval) {
    usePendingFlashcardsStore.getState().addCards(filtered, extractId);
    return [];
  }

  return filtered;
}

export async function handleAutoSummarization(content: string): Promise<string | null> {
  const settings = useSettingsStore.getState().settings.ai.aiControls;
  if (!settings.autoSummarize) return null;

  const maxWords = getSummaryWordCount(settings.summaryLength);
  // ML Kit exposes no length parameter, so the on-device path honours the
  // requested shape but not the word budget; the cloud path is unchanged.
  return await runAiAction(
    {
      onDevice: () =>
        withOnDeviceRun("Summarization", ({ signal, onProgress }) =>
          summarizeOnDevice(content, { format: "paragraph", signal, onProgress })
        ),
      cloud: () => summarizeContent(content, maxWords),
    },
    "Summarization"
  );
}
