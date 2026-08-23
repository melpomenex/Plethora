import fixtureJson from "./generated/marketing-fixture-v2.json";
import type { MarketingCaptureSceneId } from "./capability";
import type { MarketingCompiledFixture } from "./types";

const fixture = fixtureJson as unknown as MarketingCompiledFixture;
const FEATURED_DOCUMENT_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const FEATURED_EXTRACT_ID = "cccccccc-0001-4000-8000-000000000001";
const FEATURED_ITEM_ID = "dddddddd-0001-4000-8000-000000000001";
const FEATURED_CONNECTION_ID = "ffffffff-0001-4000-8000-000000000001";

export interface MarketingSceneApplication {
  sceneId: MarketingCaptureSceneId;
  surface: "library" | "reader" | "review" | "connections";
  currentDocumentId?: string;
  reader?: {
    page: number;
    scrollPercent: number;
    targetText: string;
    selection?: { extractId: string; locator: string; text: string };
  };
  cardPreview?: {
    learningItemId: string;
    sourceExtractId: string;
    question: string;
    answer: string;
    tags: string[];
  };
  review?: {
    learningItemId: string;
    phase: "question" | "answer" | "scheduled";
    rating?: 3;
    scheduledDays?: number;
  };
  connectionContext?: { connectionId: string; fromId: string; toId: string };
  sentinels: string[];
  captureSupported: boolean;
}

const applications: Record<MarketingCaptureSceneId, MarketingSceneApplication> = {
  "library.ready": {
    sceneId: "library.ready",
    surface: "library",
    currentDocumentId: FEATURED_DOCUMENT_ID,
    sentinels: ["Why highlighting feels like learning", "Sleep is not downtime for memory"],
    captureSupported: true,
  },
  "reader.open": {
    sceneId: "reader.open",
    surface: "reader",
    currentDocumentId: FEATURED_DOCUMENT_ID,
    reader: { page: 3, scrollPercent: 41, targetText: "Recognition is cheap. Recall is the skill you actually wanted." },
    sentinels: ["Why highlighting feels like learning", "Recognition is cheap"],
    captureSupported: true,
  },
  "reader.selected": {
    sceneId: "reader.selected",
    surface: "reader",
    currentDocumentId: FEATURED_DOCUMENT_ID,
    reader: {
      page: 3,
      scrollPercent: 41,
      targetText: "Recognition is cheap. Recall is the skill you actually wanted.",
      selection: { extractId: FEATURED_EXTRACT_ID, locator: "essay:fluency", text: "Recognition is cheap. Recall is the skill you actually wanted." },
    },
    sentinels: ["Recognition is cheap", "Explain", "Learn this"],
    captureSupported: true,
  },
  "explain.grounded": {
    sceneId: "explain.grounded",
    surface: "reader",
    currentDocumentId: FEATURED_DOCUMENT_ID,
    reader: {
      page: 3,
      scrollPercent: 41,
      targetText: "Recognition is cheap. Recall is the skill you actually wanted.",
      selection: { extractId: FEATURED_EXTRACT_ID, locator: "essay:fluency", text: "Recognition is cheap. Recall is the skill you actually wanted." },
    },
    sentinels: ["Recognition is cheap"],
    captureSupported: false,
  },
  "remember.preview": {
    sceneId: "remember.preview",
    surface: "reader",
    currentDocumentId: FEATURED_DOCUMENT_ID,
    reader: {
      page: 3,
      scrollPercent: 41,
      targetText: "Recognition is cheap. Recall is the skill you actually wanted.",
      selection: { extractId: FEATURED_EXTRACT_ID, locator: "essay:fluency", text: "Recognition is cheap. Recall is the skill you actually wanted." },
    },
    cardPreview: {
      learningItemId: FEATURED_ITEM_ID,
      sourceExtractId: FEATURED_EXTRACT_ID,
      question: "Why does highlighting often fail as study?",
      answer: "It tags importance without encoding: little paraphrase, retrieval, or association. Later recognition of yellow text is mistaken for recall.",
      tags: ["encoding", "memory"],
    },
    sentinels: ["Why does highlighting often fail as study?", "Add 1 card"],
    captureSupported: true,
  },
  "review.question": {
    sceneId: "review.question",
    surface: "review",
    review: { learningItemId: FEATURED_ITEM_ID, phase: "question" },
    sentinels: ["Why does highlighting often fail as study?", "Show Answer"],
    captureSupported: true,
  },
  "review.answer": {
    sceneId: "review.answer",
    surface: "review",
    review: { learningItemId: FEATURED_ITEM_ID, phase: "answer" },
    sentinels: ["It tags importance without encoding", "Good"],
    captureSupported: true,
  },
  "review.scheduled": {
    sceneId: "review.scheduled",
    surface: "review",
    review: { learningItemId: FEATURED_ITEM_ID, phase: "scheduled", rating: 3, scheduledDays: 3 },
    sentinels: ["Review Complete!", "Scheduled", "Good", "Next review in 3 days"],
    captureSupported: true,
  },
  "connections.context": {
    sceneId: "connections.context",
    surface: "connections",
    currentDocumentId: FEATURED_DOCUMENT_ID,
    connectionContext: { connectionId: FEATURED_CONNECTION_ID, fromId: FEATURED_EXTRACT_ID, toId: "cccccccc-0002-4000-8000-000000000002" },
    sentinels: ["Recognition is cheap", "Effort is a teaching signal"],
    captureSupported: true,
  },
};

function assertFixtureEntity(id: string, records: Array<{ id: string }>, label: string): void {
  if (!records.some((record) => record.id === id)) throw new Error(`${label} ${id} is missing from the compiled fixture`);
}

export function resolveMarketingSceneApplication(sceneId: MarketingCaptureSceneId): MarketingSceneApplication {
  const application = applications[sceneId];
  if (application.currentDocumentId) assertFixtureEntity(application.currentDocumentId, fixture.records.documents, "Document");
  if (application.reader?.selection) assertFixtureEntity(application.reader.selection.extractId, fixture.records.extracts, "Extract");
  if (application.cardPreview) assertFixtureEntity(application.cardPreview.learningItemId, fixture.records.learningItems, "Learning item");
  if (application.review) assertFixtureEntity(application.review.learningItemId, fixture.records.learningItems, "Learning item");
  if (application.connectionContext) assertFixtureEntity(application.connectionContext.connectionId, fixture.records.connections, "Connection");
  return application;
}
