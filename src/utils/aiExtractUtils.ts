import { useSettingsStore, type AIControlsSettings } from "../stores/settingsStore";
import { generateFlashcardsFromExtract, summarizeContent, type GeneratedFlashcard } from "../api/ai";
import { usePendingFlashcardsStore } from "../stores/pendingFlashcardsStore";
import { resolveFlashcardTarget } from "./flashcardTarget";

const SUMMARY_WORD_MAP: Record<AIControlsSettings["summaryLength"], number> = {
  short: 100,
  medium: 250,
  long: 500,
};

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
  const cards = await generateFlashcardsFromExtract(extractId, {
    count: target.count,
    include_cloze: true,
    include_qa: true,
  });

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
  return await summarizeContent(content, maxWords);
}
