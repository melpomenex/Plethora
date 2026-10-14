/**
 * Command-palette hub pure-logic hot paths (revamp-command-palette).
 *
 * The hub derives its resume/recent candidates and scope-filters provider
 * results on every palette open and on every settled search. Both are pure and
 * not yet benchmarked; this suite measures them with seeded, deterministic
 * input at library scale (3,000 documents — the documented large-library
 * floor).
 *
 * All inputs come from `seededRandom`; every iteration folds the result into a
 * module-level sink so the engine cannot elide the work (bench bodies must
 * return void for tsc).
 */
import { bench } from "vitest";
import { seededRandom } from "../test/bench-support";
import {
  buildResumeItem,
  selectRecentCandidate,
  selectResumeCandidate,
  type PaletteDocumentLike,
  type TranslateFn,
} from "./homeModel";
import { filterResultsByScope } from "./facets";
import type { RecentOpenEntry } from "./recentOpens";
import type { StartupProgressItem } from "../types/startup";
import type { PaletteScope } from "./types";

const rng = seededRandom(0x5ea1ec7);

const DOCUMENT_COUNT = 3000;
const PROGRESS_COUNT = 200;
const RESULT_COUNT = 2000;

const FILE_TYPES: PaletteDocumentLike["fileType"][] = [
  "pdf",
  "epub",
  "markdown",
  "html",
  "youtube",
  "audio",
];

const documents: PaletteDocumentLike[] = Array.from({ length: DOCUMENT_COUNT }, (_, i) => ({
  id: `doc-${i}`,
  title: `Document number ${i}`,
  fileType: FILE_TYPES[Math.floor(rng() * FILE_TYPES.length)],
  collectionId: rng() < 0.9 ? "col-a" : "col-b",
  isArchived: rng() < 0.05,
  isDismissed: rng() < 0.05,
  progressPercent: Math.floor(rng() * 100),
  dateModified: new Date(1_700_000_000_000 + Math.floor(rng() * 30_000_000_000)).toISOString(),
  currentPage: Math.floor(rng() * 400),
  totalPages: 400,
  tags: rng() < 0.3 ? ["history"] : [],
}));

const continueReading: StartupProgressItem[] = Array.from(
  { length: PROGRESS_COUNT },
  (_, i) => ({
    id: `doc-${Math.floor(rng() * DOCUMENT_COUNT)}`,
    progress: 5 + Math.floor(rng() * 90),
    title: `Progress item ${i}`,
    date_modified: 1_700_000_000_000 + Math.floor(rng() * 30_000_000_000),
    date_added: 1_600_000_000_000,
  })
);

const recentOpens: RecentOpenEntry[] = Array.from({ length: 20 }, (_, i) => ({
  documentId: `doc-${Math.floor(rng() * DOCUMENT_COUNT)}`,
  openedAt: 1_700_000_000_000 + i * 1000,
}));

const translate: TranslateFn = (key) => key;

const KIND_FACETS: Array<{ type: string; resultKind: string }> = [
  { type: "document", resultKind: "document" },
  { type: "command", resultKind: "command" },
  { type: "document", resultKind: "rss-article" },
  { type: "document", resultKind: "podcast-episode" },
  { type: "command", resultKind: "help-article" },
  { type: "flashcard", resultKind: "learning-item" },
];

const providerResults = Array.from({ length: RESULT_COUNT }, (_, i) => {
  const facet = KIND_FACETS[Math.floor(rng() * KIND_FACETS.length)];
  return {
    id: `result-${i}`,
    type: facet.type,
    metadata: { resultKind: facet.resultKind } as Record<string, unknown>,
  };
});

const SCOPES: PaletteScope[] = ["documents", "actions", "library", "cards", "settings"];

// Consumed result sink (bench bodies return void).
let sink = 0;

bench("commandPalette/resume-selection-3000-docs", () => {
  const candidate = selectResumeCandidate({
    continueReading,
    documents,
    activeCollectionId: "col-a",
    activeReaderDocumentId: null,
  });
  if (candidate) {
    const item = buildResumeItem({
      candidate,
      document: documents.find((doc) => doc.id === candidate.documentId) ?? documents[0],
      translate,
    });
    sink ^= (item.progressPercent ?? 0) | 0;
  }
});

bench("commandPalette/recent-selection-3000-docs", () => {
  const candidate = selectRecentCandidate({
    documents,
    activeCollectionId: "col-a",
    recentOpens,
  });
  sink ^= candidate ? candidate.documentId.length : 0;
});

bench("commandPalette/scope-filter-2000-results", () => {
  let acc = 0;
  for (const scope of SCOPES) {
    acc += filterResultsByScope(providerResults, scope).length;
  }
  sink ^= acc;
});
