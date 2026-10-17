import type { LearningItem } from "../../api/learning-items";

export type DeckManagerSortField =
  | "due_date"
  | "state"
  | "difficulty"
  | "interval"
  | "review_count"
  | "lapses";
export type DeckManagerSortDirection = "asc" | "desc";
export type DeckManagerCategory =
  | ""
  | "New"
  | "Learning"
  | "Review"
  | "Suspended"
  | "Leeches";

export const DECK_MANAGER_CATEGORIES: readonly {
  value: DeckManagerCategory;
  label: string;
}[] = [
  { value: "", label: "All" },
  { value: "New", label: "New" },
  { value: "Learning", label: "Learning" },
  { value: "Review", label: "Review" },
  { value: "Suspended", label: "Suspended" },
  { value: "Leeches", label: "Leeches" },
];

export const DECK_MANAGER_SORTS: readonly {
  value: DeckManagerSortField;
  label: string;
  shortLabel: string;
}[] = [
  { value: "due_date", label: "Due", shortLabel: "Due" },
  { value: "state", label: "State", shortLabel: "State" },
  { value: "difficulty", label: "Difficulty", shortLabel: "Diff" },
  { value: "interval", label: "Interval", shortLabel: "Int." },
  { value: "review_count", label: "Reviews", shortLabel: "Reviews" },
  { value: "lapses", label: "Lapses", shortLabel: "Lapses" },
];

export function matchesDeckManagerCategory(
  card: Pick<LearningItem, "state" | "is_suspended" | "lapses">,
  category: DeckManagerCategory,
): boolean {
  switch (category) {
    case "":
      return true;
    case "Learning":
      return card.state === "Learning" || card.state === "Relearning";
    case "Suspended":
      return card.is_suspended;
    case "Leeches":
      return card.lapses >= 5;
    default:
      return card.state === category;
  }
}

export function getDeckManagerCategoryCounts(
  cards: readonly LearningItem[],
): Record<DeckManagerCategory, number> {
  return Object.fromEntries(
    DECK_MANAGER_CATEGORIES.map(({ value }) => [
      value,
      cards.filter((card) => matchesDeckManagerCategory(card, value)).length,
    ]),
  ) as Record<DeckManagerCategory, number>;
}

const STATE_ORDER: Record<LearningItem["state"], number> = {
  New: 0,
  Learning: 1,
  Relearning: 2,
  Review: 3,
};

export function sortDeckManagerCards(
  cards: readonly LearningItem[],
  field: DeckManagerSortField,
  direction: DeckManagerSortDirection,
): LearningItem[] {
  return [...cards].sort((a, b) => {
    let comparison = 0;
    switch (field) {
      case "due_date":
        comparison = (a.due_date ?? "").localeCompare(b.due_date ?? "");
        break;
      case "state":
        comparison = STATE_ORDER[a.state] - STATE_ORDER[b.state];
        break;
      case "difficulty":
        comparison = a.difficulty - b.difficulty;
        break;
      case "interval":
        comparison = a.interval - b.interval;
        break;
      case "review_count":
        comparison = a.review_count - b.review_count;
        break;
      case "lapses":
        comparison = a.lapses - b.lapses;
        break;
    }
    return direction === "asc" ? comparison : -comparison;
  });
}
