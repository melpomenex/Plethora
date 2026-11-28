import type { LearningGoal } from "../../types/learningGoal";
import type { QueueItem } from "../../types/queue";
import type { SessionItemTypes } from "../../utils/reviewUx";

export interface ScrollModeTabData {
  queueScrollMode: "queue-list" | "optimal";
  customQueueItems?: QueueItem[];
  itemTypes?: SessionItemTypes;
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "about",
  "that",
  "this",
  "your",
  "learn",
  "study",
  "review",
  "reading",
]);

function extractGoalKeywords(goals: readonly LearningGoal[]): string[] {
  const keywords = new Set<string>();
  for (const goal of goals) {
    if (goal.status !== "active") continue;
    const text = `${goal.title} ${goal.description ?? ""}`.toLowerCase();
    for (const token of text.split(/[^a-z0-9]+/)) {
      if (token.length >= 3 && !STOP_WORDS.has(token)) {
        keywords.add(token);
      }
    }
  }
  return Array.from(keywords);
}

function scoreQueueItemForKeywords(item: QueueItem, keywords: readonly string[]): number {
  if (keywords.length === 0) return 0;
  const haystack = [
    item.documentTitle,
    item.entityTitle ?? "",
    item.category ?? "",
    item.learningHint ?? "",
    ...(item.tags ?? []),
  ]
    .join(" ")
    .toLowerCase();

  let matches = 0;
  for (const kw of keywords) {
    if (haystack.includes(kw)) {
      matches += 1;
    }
  }
  return matches;
}

export function resolveItemTypesForProfile(profileId?: string): SessionItemTypes {
  switch (profileId) {
    case "memory_retention":
      return { documents: false, extracts: true, learningItems: true };
    case "deep_study":
      return { documents: true, extracts: true, learningItems: false };
    default:
      return { documents: true, extracts: true, learningItems: true };
  }
}

/**
 * Builds the `queue-scroll` tab payload for a learning session:
 * - `free_exploration` launches the user's priority queue (`queueScrollMode: "queue-list"`),
 *   matching how Scroll Mode works when opened from the Queue tab.
 * - Goal/profile-driven sessions position the user in Scroll Mode tailored to their
 *   active goals/interests (prioritizing matching queue items when loaded, or using
 *   optimal composition with profile-appropriate item types).
 */
export function buildScrollModeTabData(options: {
  profileId?: string;
  goals?: readonly LearningGoal[];
  queueItems?: readonly QueueItem[];
}): ScrollModeTabData {
  const { profileId, goals = [], queueItems = [] } = options;

  if (profileId === "free_exploration") {
    return {
      queueScrollMode: "queue-list",
    };
  }

  const itemTypes = resolveItemTypesForProfile(profileId);
  const keywords = extractGoalKeywords(goals);

  if (queueItems.length > 0 && keywords.length > 0) {
    const scored = queueItems.map((item, idx) => ({
      item,
      idx,
      score: scoreQueueItemForKeywords(item, keywords),
    }));
    const hasMatch = scored.some((entry) => entry.score > 0);
    if (hasMatch) {
      scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
      return {
        queueScrollMode: "queue-list",
        customQueueItems: scored.map((entry) => entry.item),
        itemTypes,
      };
    }
  }

  return {
    queueScrollMode: "optimal",
    itemTypes,
  };
}

export async function openScrollModeForSession(options: {
  profileId?: string;
  goals?: readonly LearningGoal[];
}): Promise<void> {
  const [
    { useTabsStore },
    { createCanonicalTab },
    { useQueueStore },
    { useLearningGoalsStore },
  ] = await Promise.all([
    import("../../stores/tabsStore"),
    import("../../components/tabs/TabRegistry"),
    import("../../stores/queueStore"),
    import("../../stores/learningGoalsStore"),
  ]);

  const goals = options.goals ?? useLearningGoalsStore.getState().goals;
  const queueItems = useQueueStore.getState().items;
  const data = buildScrollModeTabData({
    profileId: options.profileId,
    goals,
    queueItems,
  });

  const baseTab = createCanonicalTab("queue-scroll");
  useTabsStore.getState().addTab({
    ...baseTab,
    data: {
      ...(baseTab.data ?? {}),
      ...data,
    },
  });
}
