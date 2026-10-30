import type { QueueItem } from "../types/queue";
import { scoreFocalTopic } from "./semanticRelations";
import { QUEUE_LIST_SORT_CONFIG, orderScrollItemsByCombinedCriterion } from "./queueScrollOrder";

export type PriorityPreset =
  | "maximize-retention"
  | "minimize-time"
  | "aggressive-catchup"
  | "exploratory"
  | "project-focused";

export type PriorityVector = {
  retentionRisk: number;
  cognitiveLoad: number;
  timeEfficiency: number;
  userIntent: number;
  overduePenalty: number;
};

export type QueueStatus = "new" | "learning" | "review" | "drifted" | "due" | "due-overdue" | "scheduled";

export type SessionFilters = {
  tags: string[];
  categories: string[];
  priorityRange: { min: number; max: number };
  excludeSuspended: boolean;
};

export type SessionItemTypes = {
  documents: boolean;
  extracts: boolean;
  learningItems: boolean;
};

export type OrderedQueueItem = QueueItem & {
  queuePosition: number;
  queueTotal: number;
  isUpNext: boolean;
};

export type SessionCustomizationOptions = {
  maxItems?: number;
  filters?: SessionFilters;
  itemTypes?: SessionItemTypes;
  priorityPreset?: PriorityPreset;
  semanticStudy?: {
    enabled: boolean;
    relatednessThreshold: number; // 0 to 100
    focalTopic: string;
  };
};

const DEFAULT_TIME_PER_ITEM = 2;

/** The strategy `getPriorityScore` ranks by when the requested one is unknown. */
const DEFAULT_PRIORITY_PRESET: PriorityPreset = "maximize-retention";

const priorityPresets: Record<PriorityPreset, PriorityVector> = {
  "maximize-retention": {
    retentionRisk: 0.35,
    cognitiveLoad: 0.15,
    timeEfficiency: 0.15,
    userIntent: 0.15,
    overduePenalty: 0.2,
  },
  "minimize-time": {
    retentionRisk: 0.2,
    cognitiveLoad: 0.2,
    timeEfficiency: 0.3,
    userIntent: 0.15,
    overduePenalty: 0.15,
  },
  "aggressive-catchup": {
    retentionRisk: 0.25,
    cognitiveLoad: 0.1,
    timeEfficiency: 0.15,
    userIntent: 0.1,
    overduePenalty: 0.4,
  },
  exploratory: {
    retentionRisk: 0.2,
    cognitiveLoad: 0.25,
    timeEfficiency: 0.15,
    userIntent: 0.3,
    overduePenalty: 0.1,
  },
  "project-focused": {
    retentionRisk: 0.2,
    cognitiveLoad: 0.2,
    timeEfficiency: 0.15,
    userIntent: 0.35,
    overduePenalty: 0.1,
  },
};

/**
 * Split a queue selection into the two priority write paths.
 *
 * Priority is one queue across documents, extracts, and cards, but each is
 * written by its own command. A queue item only has a document when it came
 * from one: Anki and browser-extension cards have `documentId === ""`, and
 * passing that to the document command asks the backend for document "" — a
 * not-found. Those items carry their own priority, so they belong on the
 * learning-item path instead of being dropped.
 *
 * Both lists are de-duplicated: several cards can share one source document,
 * and setting that document's priority once is enough.
 */
export function splitPriorityTargets(items: QueueItem[]): {
  documentIds: string[];
  learningItemIds: string[];
} {
  const documentIds = new Set<string>();
  const learningItemIds = new Set<string>();
  for (const item of items) {
    if (item.documentId) {
      documentIds.add(item.documentId);
    } else if (item.learningItemId) {
      learningItemIds.add(item.learningItemId);
    }
  }
  return {
    documentIds: Array.from(documentIds),
    learningItemIds: Array.from(learningItemIds),
  };
}

export function getPriorityVector(item: QueueItem): PriorityVector {
  const now = Date.now();
  const due = item.dueDate ? new Date(item.dueDate).getTime() : null;
  const isDueValid = due !== null && !isNaN(due);

  // 1. Resolve overdue urgency O ∈ [0, 1]
  const o =
    item.overdueUrgency != null
      ? item.overdueUrgency
      : isDueValid && due <= now
        ? Math.max(0, Math.min(1, -Math.expm1(-Math.max(0, (now - due) / 86400000) / 14)))
        : 0;

  // 2. Resolve temporal readiness A ∈ [0.5, 1.0] and temporal urgency T ∈ [0, 1]
  const a = 0.5 + 0.5 * o;
  let t: number;
  if (item.temporalUrgency != null && Number.isFinite(item.temporalUrgency)) {
    t = item.temporalUrgency;
  } else if (item.itemType === "learning-item") {
    const r = item.retrievability;
    if (isDueValid && r != null && Number.isFinite(r)) {
      const rRisk = Math.max(0, Math.min(1, 1 - r));
      t = due > now ? rRisk : Math.max(rRisk, a);
    } else if (isDueValid) {
      t = due > now ? 0 : a;
    } else {
      t = 0.5;
    }
  } else {
    // Rotational items (document, extract, video-extract, etc.)
    if (isDueValid) {
      t = due > now ? 0 : a;
    } else {
      t = 0.5;
    }
  }

  // 3. Resolve manual priority P ∈ [0, 1] (D1/D4: count P once, no tag count, no rereading rating)
  let p: number;
  if (item.canonicalPriority != null && Number.isFinite(item.canonicalPriority)) {
    p = item.canonicalPriority;
  } else if (item.prioritySlider != null && Number.isFinite(item.prioritySlider)) {
    p = clamp(item.prioritySlider, 0, 100) / 100;
  } else if (item.priorityRating != null && Number.isFinite(item.priorityRating)) {
    p = clamp(item.priorityRating, 1, 5) / 5;
  } else if (item.priority != null && Number.isFinite(item.priority)) {
    p = item.priority <= 1 ? item.priority : clamp(item.priority / 10, 0, 1);
  } else {
    p = 0.5;
  }

  const typeLoad = item.itemType === "document" ? 75 : item.itemType === "extract" ? 55 : 35;
  const timeEfficiency = Math.max(20, 100 - Math.min(90, item.estimatedTime * 10));

  return {
    retentionRisk: clamp(Math.round(t * 100), 10, 95),
    cognitiveLoad: clamp(typeLoad + (item.progress < 30 ? 10 : 0), 15, 90),
    timeEfficiency,
    userIntent: clamp(Math.round(p * 100), 10, 95),
    overduePenalty: clamp(Math.round(o * 100), 0, 90),
  };
}

export function getPriorityScore(item: QueueItem, preset: PriorityPreset): number {
  const vector = getPriorityVector(item);
  // The preset id crosses a persistence boundary (`smartQueue.queueStrategyPreset`),
  // so a stale one reaches here even though the type says otherwise. Falling back
  // costs the user their chosen ordering; throwing costs them the whole queue.
  const weights = priorityPresets[preset] ?? priorityPresets[DEFAULT_PRIORITY_PRESET];
  // D4: Collapse previous retention + overdue into a single temporal weight (counting T once),
  // and retain the previous intent weight for P (counting P once).
  const temporalWeight = weights.retentionRisk + weights.overduePenalty;
  const intentWeight = weights.userIntent;
  const loadWeight = weights.cognitiveLoad;
  const timeWeight = weights.timeEfficiency;

  return Math.round(
    vector.retentionRisk * temporalWeight +
      vector.userIntent * intentWeight +
      vector.cognitiveLoad * loadWeight +
      vector.timeEfficiency * timeWeight
  );
}

/** Map a queue item's type onto the scroll session's type vocabulary. */
function toScrollType(itemType: QueueItem["itemType"]): "document" | "extract" | "flashcard" {
  if (itemType === "learning-item") return "flashcard";
  if (itemType === "extract") return "extract";
  return "document";
}

/**
 * Sort a filtered queue into the same deterministic order used for queue
 * sessions, then decorate each item with the position information needed by
 * list surfaces. The input is intentionally treated as already filtered so
 * search/session filters cannot create gaps in the visible positions.
 *
 * The ordering is Scroll Mode's combined criterion (priority + topic/item
 * proportion bias + stable jitter), NOT a plain priority sort. A plain sort is
 * what buried every document below every flashcard: `getPriorityScore` is
 * effectively constant per type for an untouched library (all documents ~59,
 * all Anki-imported cards ~73), so the list degenerated into a block of cards
 * followed by a block of documents. Scroll Mode already ordered by the
 * combined criterion, which is why it interleaved reading material and the
 * list did not — the two surfaces must agree, since Scroll Mode (Queue List
 * Order) replays exactly the rows this function hands it.
 */
export function orderQueueItems(
  items: QueueItem[],
  preset: PriorityPreset = "maximize-retention",
): OrderedQueueItem[] {
  const ordered = orderScrollItemsByCombinedCriterion(
    items.map((item) => ({
      id: item.id,
      type: toScrollType(item.itemType),
      engagementScore: getPriorityScore(item, preset),
      item,
    })),
    QUEUE_LIST_SORT_CONFIG,
  );

  return ordered.map(({ item }, index) => ({
    ...item,
    queuePosition: index + 1,
    queueTotal: ordered.length,
    isUpNext: index === 0,
  }));
}

export function getQueueStatus(item: QueueItem): QueueStatus {
  const due = item.dueDate ? new Date(item.dueDate).getTime() : null;
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;

  if (item.itemType === "learning-item") return "review";
  if (item.itemType === "extract") return "learning";

  // FSRS-based document status
  if (item.itemType === "document") {
    if (!due) {
      // New document - never been scheduled/read
      return "new";
    }
    if (due < now - oneDayMs) {
      // Overdue by more than a day
      return "drifted";
    }
    if (due <= now) {
      // Due today or within the last day
      return "due";
    }
    return "scheduled";
  }

  return "new";
}

export function getFsrsSchedulingInfo(item: QueueItem): {
  status: string;
  statusLabel: string;
  isDue: boolean;
  isOverdue: boolean;
  daysUntilDue: number | null;
  nextReviewDate: Date | null;
} {
  const due = item.dueDate ? new Date(item.dueDate) : null;
  const now = new Date();
  const isDue = due ? due <= now : false;
  const isOverdue = due ? due < now : false;
  const daysUntilDue = due ? Math.ceil((due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : null;

  let status = "unknown";
  let statusLabel = "Unknown";

  if (item.itemType === "learning-item") {
    status = "review";
    statusLabel = "Review";
  } else if (item.itemType === "extract") {
    status = "learning";
    statusLabel = "Learning";
  } else if (item.itemType === "rss-article") {
    status = "rss";
    statusLabel = "RSS Article";
  } else if (item.itemType === "document") {
    if (!due) {
      status = "new";
      statusLabel = "New";
    } else if (isOverdue) {
      const daysOverdue = Math.floor((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000));
      if (daysOverdue >= 7) {
        status = "drifted";
        statusLabel = `Overdue (${daysOverdue}d)`;
      } else {
        status = "due-overdue";
        statusLabel = "Overdue";
      }
    } else if (isDue) {
      status = "due";
      statusLabel = "Due Today";
    } else {
      status = "scheduled";
      if (daysUntilDue !== null) {
        if (daysUntilDue <= 1) {
          statusLabel = "Tomorrow";
        } else if (daysUntilDue <= 7) {
          statusLabel = `In ${daysUntilDue}d`;
        } else {
          statusLabel = `${daysUntilDue}d`;
        }
      } else {
        statusLabel = "Scheduled";
      }
    }
  }

  return {
    status,
    statusLabel,
    isDue,
    isOverdue,
    daysUntilDue,
    nextReviewDate: due,
  };
}

export function isScheduledItem(item: QueueItem): boolean {
  return Boolean(item.dueDate);
}

export function getTimeEstimateRange(item: QueueItem): { min: number; max: number } {
  const base = item.estimatedTime || DEFAULT_TIME_PER_ITEM;
  const variance = item.itemType === "document" ? 0.5 : item.itemType === "extract" ? 0.35 : 0.2;
  return {
    min: Math.max(1, Math.round(base * (1 - variance))),
    max: Math.max(1, Math.round(base * (1 + variance))),
  };
}

export function formatMinutesRange(range: { min: number; max: number }): string {
  if (range.min === range.max) return `${range.min} min`;
  return `${range.min}-${range.max} min`;
}

export function applyFilters(items: QueueItem[], options?: SessionCustomizationOptions): QueueItem[] {
  let filtered = [...items];

  // Apply item type filter
  if (options?.itemTypes) {
    filtered = filtered.filter((item) => {
      if (item.itemType === "document") return options.itemTypes!.documents;
      if (item.itemType === "extract") return options.itemTypes!.extracts;
      if (item.itemType === "learning-item") return options.itemTypes!.learningItems;
      return true;
    });
  }

  // Apply tags filter
  if (options?.filters?.tags && options.filters.tags.length > 0) {
    filtered = filtered.filter((item) =>
      options.filters!.tags.some((tag) => item.tags?.includes(tag))
    );
  }

  // Apply category filter
  if (options?.filters?.categories && options.filters.categories.length > 0) {
    filtered = filtered.filter((item) =>
      options.filters!.categories.includes(item.category || "")
    );
  }

  // Apply priority range filter
  if (options?.filters?.priorityRange) {
    const { min, max } = options.filters.priorityRange;
    const preset = options.priorityPreset || "maximize-retention";
    filtered = filtered.filter(
      (item) => getPriorityScore(item, preset) >= min && getPriorityScore(item, preset) <= max
    );
  }

  // Apply exclude suspended filter
  if (options?.filters?.excludeSuspended) {
    filtered = filtered.filter((item) => (item as any).status !== "suspended");
  }

  // Apply semantic study focal topic filter
  if (options?.semanticStudy?.enabled && options.semanticStudy.focalTopic) {
    const threshold = options.semanticStudy.relatednessThreshold / 100;
    filtered = filtered.filter((item) => {
      const score = scoreFocalTopic(item, options.semanticStudy!.focalTopic);
      return score >= threshold && score > 0;
    });
  }

  return filtered;
}

export function getStatusLabel(status: QueueStatus): string {
  switch (status) {
    case "drifted":
      return "Drifted";
    case "due-overdue":
      return "Overdue";
    case "due":
      return "Due Today";
    case "scheduled":
      return "Scheduled";
    case "review":
      return "Review";
    case "learning":
      return "Learning";
    case "new":
      return "New";
    default:
      return "Unknown";
  }
}

export function getFsrsMetrics(item: QueueItem): {
  stability: number;
  difficulty: number;
  retrievability: number;
  nextIntervalDays: number;
} {
  const stability = Math.max(1, Math.round(30 - item.priority));
  const difficulty = Math.min(10, Math.max(1, Math.round(item.priority / 2)));
  const retrievability = Math.max(0.2, Math.min(0.95, 1 - item.priority / 100));
  const nextIntervalDays = item.dueDate
    ? Math.max(1, Math.round((new Date(item.dueDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : Math.max(1, Math.round(item.estimatedTime));
  return { stability, difficulty, retrievability, nextIntervalDays };
}

export function getReadingImpact(item: QueueItem): string {
  if (item.itemType === "document") return "Est. 4 cards (~3 min/day)";
  if (item.itemType === "extract") return "Est. 2 cards (~1 min/day)";
  return "Est. 1 card (~30s/day)";
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
