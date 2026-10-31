import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIssue6Provider,
  ISSUE6_CLOCK,
  ISSUE6_IDS,
  ISSUE6_SECTIONED_CONTENT,
} from "./fixtures";
import { buildDocumentSections, resolveSectionFocusedContext } from "../../utils/sectionIndex";
import { FakeAIProvider } from "../../lib/ai/__fixtures__/FakeAIProvider";
import {
  createFrozenAgentEnvironment,
  resolveLearningAgentScope,
  runLearningAgent,
} from "../../lib/ai/assistant/learningAgent";
import {
  buildAgentProposalGroups,
  saveAgentProposals,
  validateAgentProposalGroups,
} from "../../lib/ai/assistant/learningAgentAcceptance";
import type { LearningItem } from "../../api/learning-items";

const storeState = vi.hoisted(() => ({
  documents: new Map<string, { id: string; title: string; content: string; _deleted?: boolean }>(),
  extracts: new Map<string, { id: string; document_id: string; _deleted?: boolean }>(),
  cards: new Map<string, LearningItem>(),
}));

vi.mock("../../lib/database", () => ({
  getDocument: vi.fn(async (id: string) => storeState.documents.get(id) ?? null),
  getExtract: vi.fn(async (id: string) => storeState.extracts.get(id) ?? null),
  createLearningItem: vi.fn(async (item: Record<string, unknown>) => {
    const docId = item.document_id as string | undefined;
    if (docId && !storeState.documents.has(docId)) {
      throw new Error("SQLITE_CONSTRAINT_FOREIGNKEY (code 787): FOREIGN KEY constraint failed");
    }
    const created = {
      id: (item.id as string) || `card-${Date.now()}-${Math.random()}`,
      document_id: docId,
      extract_id: item.extract_id as string | undefined,
      item_type: (item.item_type as string) || "Qa",
      question: (item.question as string) || "",
      answer: (item.answer as string) || "",
      cloze_text: (item.cloze_text as string) || undefined,
      difficulty: 3,
      interval: 0,
      ease_factor: 2.5,
      due_date: "2026-10-30T12:00:00Z",
      date_created: ISSUE6_CLOCK,
      date_modified: ISSUE6_CLOCK,
      review_count: 0,
      lapses: 0,
      state: "New",
      is_suspended: false,
      tags: (item.tags as string[]) || [],
      acceptance_id: item.acceptance_id as string | undefined,
      proposal_id: item.proposal_id as string | undefined,
    } as LearningItem;
    storeState.cards.set(created.id, created);
    return created;
  }),
  createLearningItemsBatch: vi.fn(async (entries: Array<Record<string, unknown>>) => {
    const created: LearningItem[] = [];
    for (const entry of entries) {
      const docId = entry.document_id as string | undefined;
      if (docId && !storeState.documents.has(docId)) {
        throw new Error("SQLITE_CONSTRAINT_FOREIGNKEY (code 787): FOREIGN KEY constraint failed");
      }
      const card: LearningItem = {
        id: (entry.id as string) || `card-${Date.now()}-${Math.random()}`,
        document_id: docId,
        extract_id: entry.extract_id as string | undefined,
        item_type: (entry.item_type as LearningItem["item_type"]) || "Qa",
        question: (entry.question as string) || "",
        answer: (entry.answer as string) || "",
        cloze_text: (entry.cloze_text as string) || undefined,
        difficulty: 3,
        interval: 0,
        ease_factor: 2.5,
        due_date: "2026-10-30T12:00:00Z",
        date_created: ISSUE6_CLOCK,
        date_modified: ISSUE6_CLOCK,
        review_count: 0,
        lapses: 0,
        state: "New",
        is_suspended: false,
        tags: (entry.tags as string[]) || [],
        acceptance_id: entry.acceptance_id as string | undefined,
        proposal_id: entry.proposal_id as string | undefined,
      };
      storeState.cards.set(card.id, card);
      created.push(card);
    }
    return created;
  }),
  getLearningItemsByDocument: vi.fn(async (docId: string) =>
    Array.from(storeState.cards.values()).filter((c) => c.document_id === docId)
  ),
  getAllLearningItems: vi.fn(async () => Array.from(storeState.cards.values())),
}));

vi.mock("../../api/learning-items", () => ({
  createLearningItemsBatch: vi.fn(async (entries: Array<Record<string, unknown>>) => {
    const db = await import("../../lib/database") as unknown as {
      createLearningItemsBatch: (entries: Array<Record<string, unknown>>) => Promise<LearningItem[]>;
    };
    return db.createLearningItemsBatch(entries);
  }),
  createLearningItem: vi.fn(async (item: Record<string, unknown>) => {
    const db = await import("../../lib/database");
    return db.createLearningItem(item);
  }),
  searchLearningItemsBounded: vi.fn(async () => []),
  getDueLearningItemsBounded: vi.fn(async () => []),
  getReviewStatistics: vi.fn(async () => ({
    total_items: storeState.cards.size,
    total_reviews: 0,
    total_lapses: 0,
    avg_interval: 0,
    retention_estimate: 0,
    due_today: 0,
    due_week: 0,
    due_month: 0,
  })),
  checkSemanticDuplicateCandidates: vi.fn(async () => []),
  getLearningItemsByAcceptanceKey: vi.fn(async () => []),
}));

vi.mock("../../api/documents", () => ({
  getDocument: vi.fn(async (id: string) => storeState.documents.get(id) ?? null),
  extractDocumentText: vi.fn(async (id: string) => {
    const doc = storeState.documents.get(id);
    return doc ? { content: doc.content } : null;
  }),
}));

vi.mock("../../api/extracts", () => ({
  getExtract: vi.fn(async (id: string) => storeState.extracts.get(id) ?? null),
  getExtracts: vi.fn(async () => Array.from(storeState.extracts.values())),
}));

vi.mock("../../api/image-registry", () => ({
  getImageAssetById: vi.fn(async () => null),
}));

vi.mock("../../api/ai-provenance", () => ({
  recordAiProvenance: vi.fn(async () => ({})),
}));

describe("issue #6 task 9.7 generation-to-acceptance integration test (R13/R14)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeState.documents.clear();
    storeState.extracts.clear();
    storeState.cards.clear();

    storeState.documents.set(ISSUE6_IDS.document, {
      id: ISSUE6_IDS.document,
      title: "Sectioned document",
      content: ISSUE6_SECTIONED_CONTENT,
    });
    storeState.extracts.set(ISSUE6_IDS.extract, {
      id: ISSUE6_IDS.extract,
      document_id: ISSUE6_IDS.document,
    });
  });

  it("verifies selected section body, omits unrelated sections, checks no cards before approval, and saves correct source IDs on acceptance", async () => {
    // 1. Build document sections from canonical fixture text
    const { flat } = buildDocumentSections(ISSUE6_SECTIONED_CONTENT);
    const secondSection = flat.find((n) => n.title === "Second");
    expect(secondSection).toBeDefined();

    // 2. Resolve focused section context for the selected "Second" section
    const focused = resolveSectionFocusedContext([secondSection!], flat, ISSUE6_SECTIONED_CONTENT, {
      documentId: ISSUE6_IDS.document,
      maxTokens: 2000,
      includeNeighbors: false,
    });
    expect(focused.ok).toBe(true);

    // Verify the resolved context includes the selected body and omits unrelated sections
    expect(focused.content).toContain("Second section body.");
    expect(focused.content).not.toContain("First section body.");
    expect(focused.content).not.toContain("First shared body.");

    // 3. Provider spy captures the direct generation request
    const directProviderSpy = createIssue6Provider();
    await directProviderSpy.generate({
      documentId: ISSUE6_IDS.document,
      sourceContent: focused.content,
    });

    expect(directProviderSpy.requests).toHaveLength(1);
    expect(directProviderSpy.requests[0].documentId).toBe(ISSUE6_IDS.document);
    expect(directProviderSpy.requests[0].sourceContent).toContain("Second section body.");
    expect(directProviderSpy.requests[0].sourceContent).not.toContain("First section body.");
    expect(directProviderSpy.requests[0].sourceContent).not.toContain("First shared body.");

    // 4. Learning Agent run preparation with the focused section
    const scopePrep = resolveLearningAgentScope({
      conversationId: "conv-issue6-g2a",
      ownerRevision: 1,
      intent: "Create cards for this section",
      scope: "section",
      documents: [{ id: ISSUE6_IDS.document, title: "Sectioned document", contentVersion: "v1" }],
      section: {
        documentId: ISSUE6_IDS.document,
        title: secondSection!.title,
        text: focused.content,
        sectionId: secondSection!.id,
      },
    });
    expect(scopePrep.ok).toBe(true);
    if (!scopePrep.ok) return;

    // Use FakeAIProvider as our provider spy for the agent loop
    const agentProviderSpy = new FakeAIProvider({
      kind: "ondevice",
      responses: [
        {
          requestId: "t1",
          text: JSON.stringify({
            toolCalls: [
              {
                tool: "get_section_context",
                input: {},
              },
            ],
          }),
        },
        {
          requestId: "t2",
          text: JSON.stringify({
            toolCalls: [
              {
                tool: "propose_flashcard",
                input: {
                  question: "What is in the second section?",
                  answer: "Second section body.",
                  sourceHandle: "s1",
                  concept: "second section",
                },
              },
            ],
          }),
        },
        {
          requestId: "t3",
          text: JSON.stringify({ finalAnswer: "One card proposed from the second section." }),
        },
      ],
    });

    const env = createFrozenAgentEnvironment(scopePrep.run);

    // 5. Run the agent
    const outcome = await runLearningAgent(scopePrep.run, {
      provider: agentProviderSpy,
      env,
      wallClockMs: 5_000,
      guard: () => null,
    });

    // Verify provider spy in turn 2 received the scoped section content and omitted unrelated sections
    expect(agentProviderSpy.requests.length).toBeGreaterThanOrEqual(2);
    const turn2RequestText = agentProviderSpy.requests[1].text;
    expect(turn2RequestText).toContain("Second section body.");
    expect(turn2RequestText).not.toContain("First section body.");
    expect(turn2RequestText).not.toContain("First shared body.");

    expect(outcome.result.proposals).toHaveLength(1);
    const proposed = outcome.result.proposals[0];
    if (proposed.kind !== "flashcard") throw new Error("Expected a flashcard proposal");
    expect(proposed.question).toBe("What is in the second section?");

    // 6. CRITICAL INVARIANT (R13/R14): No card exists in local storage BEFORE user approval!
    expect(storeState.cards.size).toBe(0);

    // 7. Validate proposal groups
    const groups = await validateAgentProposalGroups(
      buildAgentProposalGroups(outcome.result.proposals)
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].cards[0].status).toBe("valid");

    // 8. User explicitly approves and saves the proposal
    const saveReceipt = await saveAgentProposals({
      runId: "run-issue6-g2a",
      conversationId: "conv-issue6-g2a",
      provider: "fake",
      modelClass: "ondevice",
      proposals: outcome.result.proposals,
      selected: [
        {
          proposalId: proposed.proposalId,
          candidate: {
            cardType: "qa",
            conceptKeys: [],
            question: proposed.kind === "flashcard" ? proposed.question : "",
            answer: proposed.kind === "flashcard" ? proposed.answer : "",
          },
        },
      ],
    });

    expect(saveReceipt.saved).toHaveLength(1);
    expect(saveReceipt.failed).toHaveLength(0);

    // 9. CRITICAL INVARIANT: Exactly 1 card now exists in durable local persistence, with correct source IDs
    expect(storeState.cards.size).toBe(1);
    const persistedCard = Array.from(storeState.cards.values())[0];
    expect(persistedCard).toMatchObject({
      document_id: ISSUE6_IDS.document,
      question: "What is in the second section?",
      answer: "Second section body.",
      acceptance_id: "run-issue6-g2a",
    });
    // Verify no display namespace leaked into document_id foreign key
    expect(persistedCard.document_id).not.toContain("extract:");
    expect(persistedCard.document_id).toBe(ISSUE6_IDS.document);
  });
});
