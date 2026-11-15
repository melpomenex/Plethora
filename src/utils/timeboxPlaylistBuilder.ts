export type TimeboxPresetId =
  | "quick_sprint_15m"
  | "deep_block_45m"
  | "audio_commute_10m"
  | "quick_sprint"
  | "deep_block"
  | "audio_commute";

export interface TimeboxPresetDefinition {
  id: "quick_sprint_15m" | "deep_block_45m" | "audio_commute_10m";
  label: string;
  minutes: number;
  description: string;
}

export const TIMEBOX_PRESETS: TimeboxPresetDefinition[] = [
  {
    id: "quick_sprint_15m",
    label: "15m Quick Sprint",
    minutes: 15,
    description: "60% reviews, 25% extracts, 15% discovery",
  },
  {
    id: "deep_block_45m",
    label: "45m Deep Block",
    minutes: 45,
    description: "Extended mixed-mode focus block",
  },
  {
    id: "audio_commute_10m",
    label: "10m Audio Commute",
    minutes: 10,
    description: "Audio, podcasts & TTS-ready items",
  },
];

export interface TimeboxItemInput {
  id: string;
  type: "document" | "rss" | "flashcard" | "extract" | "podcast" | "video-extract";
  estimatedTime?: number;
  queuePriority?: number;
  learningItem?: {
    reps?: number;
    item_type?: string;
    image_asset_ids?: string[];
  };
  extract?: {
    reps?: number;
    review_count?: number;
    priority_slider?: number;
  };
}

export interface TimeboxPlaylistResult<T extends TimeboxItemInput = TimeboxItemInput> {
  preset: TimeboxPresetId;
  targetMinutes: number;
  estimatedMinutes: number;
  items: T[];
  breakdown: {
    reviews: number;
    extracts: number;
    discovery: number;
  };
}

export function resolvePresetMinutes(preset: TimeboxPresetId): number {
  switch (preset) {
    case "deep_block_45m":
    case "deep_block":
      return 45;
    case "audio_commute_10m":
    case "audio_commute":
      return 10;
    case "quick_sprint_15m":
    case "quick_sprint":
    default:
      return 15;
  }
}

export function estimateItemMinutes(item: TimeboxItemInput): number {
  switch (item.type) {
    case "flashcard":
      return 0.5;
    case "extract":
      return 2.0;
    case "document":
    case "rss":
      return 4.0;
    case "podcast":
    case "video-extract":
      return Math.min(5.0, Math.max(1.5, item.estimatedTime ?? 3.0));
  }
}

function isAudioCommuteCompatible(item: TimeboxItemInput): boolean {
  if (item.type === "podcast" || item.type === "extract" || item.type === "document") {
    return true;
  }
  if (item.type === "flashcard") {
    return !(item.learningItem?.image_asset_ids && item.learningItem.image_asset_ids.length > 0);
  }
  return false;
}

export function buildTimeboxPlaylist<T extends TimeboxItemInput>(
  items: T[],
  options: { preset: TimeboxPresetId; minutes?: number }
): TimeboxPlaylistResult<T> {
  const targetMinutes = Math.max(
    1,
    Number.isFinite(options.minutes) ? Number(options.minutes) : resolvePresetMinutes(options.preset)
  );

  const isAudioCommute =
    options.preset === "audio_commute_10m" || options.preset === "audio_commute";
  const candidates = isAudioCommute ? items.filter(isAudioCommuteCompatible) : [...items];

  const reviewQueue: T[] = [];
  const extractQueue: T[] = [];
  const discoveryQueue: T[] = [];

  for (const item of candidates) {
    if (item.type === "flashcard") {
      reviewQueue.push(item);
    } else if (item.type === "extract" || item.type === "video-extract" || item.type === "podcast") {
      extractQueue.push(item);
    } else {
      discoveryQueue.push(item);
    }
  }

  const reviewBudget = targetMinutes * 0.6;
  const extractBudget = targetMinutes * 0.25;
  const discoveryBudget = targetMinutes * 0.15;

  let reviewUsed = 0;
  let extractUsed = 0;
  let discoveryUsed = 0;
  let totalMinutes = 0;

  const selected: T[] = [];
  const selectedIds = new Set<string>();
  const breakdown = { reviews: 0, extracts: 0, discovery: 0 };

  const tryTake = (
    bucket: "reviews" | "extracts" | "discovery",
    queue: T[],
    bucketUsed: number,
    bucketBudget: number
  ): number => {
    const next = queue[0];
    if (!next) return bucketUsed;
    const cost = estimateItemMinutes(next);
    if (bucketUsed + cost > bucketBudget && selected.length > 0 && bucketUsed > 0) {
      return bucketUsed;
    }
    if (totalMinutes + cost > targetMinutes && selected.length > 0) {
      return bucketUsed;
    }
    queue.shift();
    selected.push(next);
    selectedIds.add(next.id);
    breakdown[bucket] += 1;
    totalMinutes += cost;
    return bucketUsed + cost;
  };

  // Interleaved fill: 2 reviews -> 1 extract -> 1 review -> 1 discovery
  let progressed = true;
  while (progressed && totalMinutes < targetMinutes) {
    const beforeLen = selected.length;
    reviewUsed = tryTake("reviews", reviewQueue, reviewUsed, reviewBudget);
    reviewUsed = tryTake("reviews", reviewQueue, reviewUsed, reviewBudget);
    extractUsed = tryTake("extracts", extractQueue, extractUsed, extractBudget);
    reviewUsed = tryTake("reviews", reviewQueue, reviewUsed, reviewBudget);
    discoveryUsed = tryTake("discovery", discoveryQueue, discoveryUsed, discoveryBudget);
    progressed = selected.length > beforeLen;
  }

  // Backfill any remaining budget from leftover candidates
  if (totalMinutes < targetMinutes) {
    for (const item of candidates) {
      if (selectedIds.has(item.id)) continue;
      const cost = estimateItemMinutes(item);
      if (totalMinutes + cost > targetMinutes && selected.length > 0) {
        continue;
      }
      selected.push(item);
      selectedIds.add(item.id);
      totalMinutes += cost;
      if (item.type === "flashcard") {
        breakdown.reviews += 1;
      } else if (item.type === "extract" || item.type === "video-extract" || item.type === "podcast") {
        breakdown.extracts += 1;
      } else {
        breakdown.discovery += 1;
      }
      if (totalMinutes >= targetMinutes) break;
    }
  }

  return {
    preset: options.preset,
    targetMinutes,
    estimatedMinutes: Number(totalMinutes.toFixed(2)),
    items: selected,
    breakdown,
  };
}
