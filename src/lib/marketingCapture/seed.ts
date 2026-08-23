/**
 * DEV-only marketing seed. Used when capturing PWA screenshots for the
 * website. Does not run for normal users.
 */
import type { Document, LearningItem } from "../../types/document";

const NOW = "2026-08-23T12:00:00.000Z";
const DUE = "2026-08-23T12:00:00.000Z";

const ESSAY = `Why highlighting feels like learning

Encoding is work. Color is comfort. The gap between the two is why so many careful readers still forget the page they just finished.

Open a used textbook and you can date the owner by the palette. Neon yellow for the first anxious week. Highlighting is a ritual that soothes the fear of losing a sentence without forcing the mind to do anything with it.

Learning scientists have a blunt name for the difference. Encoding is the set of operations that turn a fleeting experience into a trace you can find again. Highlighting skips most of those operations. Later, when you reread the yellow, you recognize the words and mistake recognition for recall.

Sleep makes the gap more honest. Overnight replay is biased toward effort, not toward fluent rereading. A yellow stripe does not survive that filter unless you extracted, questioned, and connected.

Spaced retrieval is the unglamorous alternative. You read a section. You look away. You try to say the claim. You fail a little. You check. You wait a day and try again. The waits are not wasted time; they are the point.`;

function doc(partial: Pick<Document, "id" | "title" | "fileType" | "filePath" | "content" | "extractCount" | "learningItemCount" | "priorityScore" | "tags">): Document {
  return {
    dateAdded: NOW,
    dateModified: NOW,
    nextReadingDate: DUE,
    currentPage: 1,
    progressPercent: 24,
    category: "Memory",
    priorityRating: 4,
    prioritySlider: 70,
    priorityExplicitlySet: true,
    isArchived: false,
    isFavorite: false,
    isDismissed: false,
    ...partial,
  };
}

export const MARKETING_DOCUMENTS: Document[] = [
  doc({
    id: "aaaaaaaa-0001-4000-8000-000000000001",
    title: "Why highlighting feels like learning",
    fileType: "markdown",
    filePath: "marketing://encoding-versus-highlighting.md",
    content: ESSAY,
    extractCount: 3,
    learningItemCount: 2,
    priorityScore: 88,
    tags: ["encoding", "memory"],
  }),
  doc({
    id: "aaaaaaaa-0002-4000-8000-000000000002",
    title: "Sleep is not downtime for memory",
    fileType: "markdown",
    filePath: "marketing://sleep-lecture.md",
    content: "Overnight replay is biased toward effort, not toward fluent rereading.",
    extractCount: 1,
    learningItemCount: 1,
    priorityScore: 72,
    tags: ["sleep", "lecture"],
  }),
  doc({
    id: "aaaaaaaa-0003-4000-8000-000000000003",
    title: "Spaced retrieval: a one-page methods note",
    fileType: "markdown",
    filePath: "marketing://spaced-retrieval.md",
    content: "Treat a missed recall as information. Expand the gap. Score idea units, not wording.",
    extractCount: 1,
    learningItemCount: 1,
    priorityScore: 61,
    tags: ["spacing"],
  }),
  doc({
    id: "aaaaaaaa-0004-4000-8000-000000000004",
    title: "Habit and memory (William James, 1890)",
    fileType: "markdown",
    filePath: "marketing://james-habit.md",
    content: "The more other facts a fact is associated with, the more hooks it has to hang to.",
    extractCount: 2,
    learningItemCount: 1,
    priorityScore: 54,
    tags: ["james", "public-domain"],
  }),
  doc({
    id: "aaaaaaaa-0005-4000-8000-000000000005",
    title: "Encoding to retrieval",
    fileType: "markdown",
    filePath: "marketing://occlusion.md",
    content: "Cover the labels. The blank region is a question with a spatial shape.",
    extractCount: 1,
    learningItemCount: 1,
    priorityScore: 49,
    tags: ["occlusion"],
  }),
];

export const MARKETING_CARDS: LearningItem[] = [
  {
    id: "dddddddd-0001-4000-8000-000000000001",
    documentId: MARKETING_DOCUMENTS[0].id,
    itemType: "qa",
    question: "Why does highlighting often fail as study?",
    answer:
      "It tags importance without encoding: little paraphrase, retrieval, or association. Later recognition of yellow text is mistaken for recall.",
    difficulty: 3,
    interval: 1,
    easeFactor: 2.5,
    dueDate: DUE,
    dateCreated: NOW,
    dateModified: NOW,
    reviewCount: 2,
    lapses: 0,
    state: "review",
    isSuspended: false,
    tags: ["encoding"],
  },
  {
    id: "dddddddd-0002-4000-8000-000000000002",
    documentId: MARKETING_DOCUMENTS[1].id,
    itemType: "cloze",
    question: "Overnight {{c1::replay}} is biased toward {{c2::effort}}.",
    clozeText: "Overnight {{c1::replay}} is biased toward {{c2::effort}}.",
    answer: "replay; effort",
    difficulty: 2,
    interval: 3,
    easeFactor: 2.6,
    dueDate: DUE,
    dateCreated: NOW,
    dateModified: NOW,
    reviewCount: 1,
    lapses: 0,
    state: "review",
    isSuspended: false,
    tags: ["sleep"],
  },
];

export function marketingCaptureSurface(): string | null {
  if (typeof window === "undefined") return null;
  if (!import.meta.env.DEV) return null;
  return new URLSearchParams(window.location.search).get("marketing-capture");
}
