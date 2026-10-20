import { describe, expect, it, vi } from "vitest";
import {
  buildAgentCardSourceReference,
  buildAgentDraftArtifact,
  buildAgentProposalGroups,
  hydrateAgentDraftArtifact,
  revalidateRestoredProposalSources,
  saveAgentProposals,
  validateAgentCardReview,
  validateAgentProposalGroups,
  AGENT_DUPLICATE_CHECK_UNAVAILABLE,
} from "../learningAgentAcceptance";
import type { AgentCardProposal, AgentProposal } from "../../agent/tools/types";
import type { LearningCardCandidate } from "../../schemas/learningMaterial";
import { clozeToCleanTextAndRanges } from "../../../../components/learn/acceptLearnThis";
import { parseCardSourceReference } from "../../../../types/cardSourceReference";

function cardProposal(
  id: string,
  options: {
    documentId?: string;
    question?: string;
    answer?: string;
    sourceText?: string;
    concept?: string;
    cardType?: string;
  } = {}
): AgentCardProposal {
  return {
    kind: "flashcard",
    proposalId: id,
    cardType: options.cardType ?? "qa",
    question: options.question ?? `Question for ${id}?`,
    answer: options.answer ?? `Answer for ${id}`,
    concept: options.concept,
    conceptKeys: options.concept ? [options.concept] : undefined,
    sourceText: options.sourceText ?? "Source passage supporting the card.",
    sourceRefs: [
      {
        handle: "s1",
        refId: `chunk-${options.documentId ?? "doc-a"}`,
        kind: "chunk",
        documentId: options.documentId ?? "doc-a",
        title: "Paper A",
        locator: "Chapter 1",
        text: options.sourceText ?? "Source passage supporting the card.",
      },
    ],
    sourceRevision: "rev-1",
    evidenceQuote: options.sourceText ?? "Source passage supporting the card.",
    createdAt: 1,
  };
}

function candidate(): LearningCardCandidate {
  return {
    cardType: "qa",
    concept: "entropy",
    conceptKeys: ["entropy"],
    question: "What is entropy?",
    answer: "A measure of disorder in a system.",
    evidenceQuote: "Entropy is a measure of disorder in a system.",
  };
}

describe("agent proposal grouping and caps", () => {
  it("groups by the actual source and applies 8-card / 2-per-concept caps per source", () => {
    const proposals: AgentProposal[] = [];
    for (let index = 0; index < 10; index++) {
      proposals.push(
        cardProposal(`p${index}`, {
          question: `Distinct question ${index} about topic ${index}?`,
          concept: `concept-${index}`,
        })
      );
    }
    proposals.push(
      cardProposal("same-1", { concept: "shared", question: "Shared one?" }),
      cardProposal("same-2", { concept: "shared", question: "Shared two?" }),
      cardProposal("same-3", { concept: "shared", question: "Shared three?" })
    );
    proposals.push(cardProposal("other-doc", { documentId: "doc-b" }));

    const groups = buildAgentProposalGroups(proposals);
    const groupA = groups.find((group) => group.key === "document:doc-a")!;
    const groupB = groups.find((group) => group.key === "document:doc-b")!;
    expect(groupA.cards.filter((row) => row.status !== "cap-exceeded")).toHaveLength(8);
    expect(groupA.cards.filter((row) => row.status === "cap-exceeded")).toHaveLength(5);
    expect(groupA.capApplied).toBe(true);
    expect(groupB.cards).toHaveLength(1);
    expect(groupB.capApplied).toBe(false);
  });

  it("caps a single concept at two cards even when the group has room", () => {
    const groups = buildAgentProposalGroups([
      cardProposal("a", { concept: "one", question: "Same concept one?" }),
      cardProposal("b", { concept: "one", question: "Same concept two?" }),
      cardProposal("c", { concept: "one", question: "Same concept three?" }),
    ]);
    const group = groups[0];
    expect(group.cards.filter((row) => row.status !== "cap-exceeded")).toHaveLength(2);
    expect(group.cards.filter((row) => row.status === "cap-exceeded")).toHaveLength(1);
  });
});

describe("duplicate / grounding revalidation", () => {
  it("blocks acceptance and reports 'duplicate check unavailable' when the service fails", async () => {
    const groups = await validateAgentProposalGroups(
      buildAgentProposalGroups([
        cardProposal("p1", {
          sourceText: "Entropy is a measure of disorder in a system.",
          question: "What is entropy?",
          answer: "A measure of disorder in a system.",
        }),
      ]),
      {
        checkDuplicates: async () => {
          throw new Error("service offline");
        },
      }
    );
    const row = groups[0].cards[0];
    expect(row.status).toBe("duplicate-unavailable");
    expect(row.issues.join(" ")).toContain("Duplicate check unavailable");
    expect(row.accepted).toBe(false);
  });

  it("does not clear an unavailable duplicate flag after an edit until revalidation passes", async () => {
    const [group] = buildAgentProposalGroups([
      cardProposal("p1", {
        sourceText: "Entropy is a measure of disorder in a system.",
        question: "What is entropy?",
        answer: "A measure of disorder in a system.",
      }),
    ]);
    const unavailable = await validateAgentCardReview(group.cards[0], [], {
      checkDuplicates: async () => {
        throw new Error("offline");
      },
    });
    expect(unavailable.accepted).toBe(false);
    const revalidated = await validateAgentCardReview(
      { ...unavailable, edited: true, candidate: { ...unavailable.candidate, question: "What is entropy exactly?" } },
      [],
      { checkDuplicates: async () => [] }
    );
    expect(revalidated.status).toBe("valid");
    expect(revalidated.duplicateChecked).toBe(true);
  });

  it("rejects an ungrounded edited cloze", async () => {
    const [group] = buildAgentProposalGroups([
      cardProposal("c1", {
        cardType: "cloze",
        question: "Entropy is {{c1::disorder}}.",
        answer: "disorder",
        sourceText: "Entropy is disorder.",
      }),
    ]);
    const validated = await validateAgentCardReview(group.cards[0], [], {
      checkDuplicates: async () => [],
    });
    expect(validated.status).toBe("valid");

    const edited = {
      ...validated,
      candidate: {
        ...validated.candidate,
        clozeText: "Entropy is {{c1::temperature}}.",
        question: "Entropy is {{c1::temperature}}.",
      },
    };
    const revalidated = await validateAgentCardReview(edited, [], {
      checkDuplicates: async () => [],
    });
    expect(revalidated.status).toBe("ungrounded");
  });
});

describe("cloze marker conversion", () => {
  it("strips numbered markers and hints from the clean text", () => {
    const { cleanText, ranges } = clozeToCleanTextAndRanges(
      "{{c1::Paris::city}} is the capital of {{c2::France}}."
    );
    expect(cleanText).toBe("Paris is the capital of France.");
    expect(ranges).toEqual([
      [0, 5],
      [24, 30],
    ]);
  });

  it("keeps non-marker braces and works with a single marker", () => {
    const { cleanText, ranges } = clozeToCleanTextAndRanges(
      "Set notation {a,b} and {{c1::ATP}} energy."
    );
    expect(cleanText).toContain("{a,b}");
    expect(cleanText).toContain("ATP");
    expect(cleanText).not.toContain("c1::");
    expect(ranges[0]?.[1]).toBeGreaterThan(ranges[0]?.[0] ?? 0);
  });
});

describe("restored conversation draft", () => {
  const artifact = {
    version: 1 as const,
    runId: "run-restored",
    conversationId: "conv-1",
    intent: "Cards from this section",
    scope: "section" as const,
    createdAt: 1,
    updatedAt: 1,
    sources: [
      {
        attachmentId: "doc:paper-a",
        kind: "document" as const,
        libraryId: "paper-a",
        title: "Paper A",
        contentVersion: "v1",
        origin: "active-view" as const,
        role: "required" as const,
      },
    ],
    candidates: [
      {
        proposalId: "run-restored:p1",
        kind: "flashcard" as const,
        sourceRefs: [
          {
            handle: "s1",
            refId: "chunk-a",
            kind: "chunk" as const,
            documentId: "paper-a",
            title: "Paper A",
            contentVersion: "v1",
          },
        ],
        question: "What is entropy?",
        answer: "Disorder.",
        cardType: "qa",
        evidenceQuote: "Entropy is disorder.",
        status: "saved" as const,
        savedId: "item-1",
      },
    ],
  };

  it("hydrates proposals as stopped drafts with saved ids", () => {
    const hydrated = hydrateAgentDraftArtifact(artifact as never);
    expect(hydrated.proposals).toHaveLength(1);
    expect(hydrated.savedIds.get("run-restored:p1")).toBe("item-1");
    expect(hydrated.accepted.has("run-restored:p1")).toBe(true);
    expect(hydrated.proposals[0].sourceRefs[0].text).toBe("");
  });

  it("re-reads and re-anchors the cited source without resuming execution", async () => {
    const hydrated = hydrateAgentDraftArtifact(artifact as never);
    const result = await revalidateRestoredProposalSources(hydrated.proposals, {
      getDocument: async () => ({
        content: "Entropy is disorder. Enthalpy is heat content.",
      }),
    });
    expect(result.stale).toHaveLength(0);
    expect(result.proposals[0].sourceRefs[0].text).toContain("Entropy is disorder");
  });

  it("marks a missing source stale and keeps the draft blocked", async () => {
    const hydrated = hydrateAgentDraftArtifact(artifact as never);
    const result = await revalidateRestoredProposalSources(hydrated.proposals, {
      getDocument: async () => null,
    });
    expect(result.stale).toEqual(["run-restored:p1"]);
  });
});

describe("retry-safe acceptance", () => {
  const proposals: AgentProposal[] = [
    cardProposal("p1", {
      documentId: "doc-a",
      question: "First A?",
      answer: "One",
      sourceText: "One is the first answer.",
    }),
    cardProposal("p2", {
      documentId: "doc-a",
      question: "Second A?",
      answer: "Two",
      sourceText: "Two is the second answer.",
    }),
    cardProposal("p3", {
      documentId: "doc-b",
      question: "First B?",
      answer: "Three",
      sourceText: "Three is the third answer.",
    }),
  ];

  function selected() {
    return proposals.map((proposal) => ({
      proposalId: proposal.proposalId,
      candidate: {
        cardType: "qa" as const,
        conceptKeys: ["x"],
        question: proposal.kind === "flashcard" ? proposal.question : "",
        answer: proposal.kind === "flashcard" ? proposal.answer : "",
      },
    }));
  }

  it("saves only selected rows and reports a partial group failure with exact ids", async () => {
    const createdIds: string[] = [];
    const createBatch = vi.fn(async (entries: Array<Record<string, unknown>>) => {
      const first = entries[0] as { document_id?: string; proposal_id?: string };
      if (first.document_id === "doc-b") throw new Error("transport lost");
      return entries.map((entry) => {
        const id = `saved-${String(entry.proposal_id)}`;
        createdIds.push(id);
        return {
          id,
          proposal_id: entry.proposal_id as string,
          question: entry.question as string,
          item_type: "Qa" as const,
          state: "New" as const,
          due_date: "",
          date_created: "",
          date_modified: "",
          difficulty: 0,
          interval: 0,
          ease_factor: 0,
          review_count: 0,
          lapses: 0,
          is_suspended: false,
          tags: [],
        };
      });
    });
    const findSaved = vi.fn(async () =>
      createdIds.map((id) => ({
        id,
        proposal_id: id.replace("saved-", ""),
        question: "",
        item_type: "Qa" as const,
        state: "New" as const,
        due_date: "",
        date_created: "",
        date_modified: "",
        difficulty: 0,
        interval: 0,
        ease_factor: 0,
        review_count: 0,
        lapses: 0,
        is_suspended: false,
        tags: [],
      }))
    );
    const result = await saveAgentProposals(
      {
        runId: "run-1",
        conversationId: "conv-1",
        provider: "fake",
        modelClass: "full",
        proposals,
        selected: selected().slice(0, 3),
      },
      {
        createBatch: createBatch as never,
        createOne: vi.fn() as never,
        checkDuplicates: async () => [],
        findSaved: findSaved as never,
        recordProvenance: (async () => ({})) as never,
        createCloze: vi.fn() as never,
      }
    );
    expect(result.saved.map((entry) => entry.proposalId).sort()).toEqual(["p1", "p2"]);
    expect(result.failed.map((entry) => entry.proposalId)).toEqual(["p3"]);
    expect(createBatch).toHaveBeenCalledTimes(2);
  });

  it("recovers an already-committed row after an ambiguous transport failure", async () => {
    const createBatch = vi.fn(async () => {
      throw new Error("response lost");
    });
    const result = await saveAgentProposals(
      {
        runId: "run-2",
        conversationId: "conv-1",
        provider: "fake",
        modelClass: "full",
        proposals: [proposals[0]],
        selected: selected().slice(0, 1),
      },
      {
        createBatch: createBatch as never,
        checkDuplicates: async () => [],
        findSaved: (async () => [
          {
            id: "already-created",
            proposal_id: "p1",
            question: "First A?",
            item_type: "Qa",
            state: "New",
            due_date: "",
            date_created: "",
            date_modified: "",
            difficulty: 0,
            interval: 0,
            ease_factor: 0,
            review_count: 0,
            lapses: 0,
            is_suspended: false,
            tags: [],
          },
        ]) as never,
        recordProvenance: (async () => ({})) as never,
      }
    );
    expect(result.saved).toEqual([
      { proposalId: "p1", itemId: "already-created", provenancePending: false },
    ]);
    expect(result.reconciledProposalIds).toEqual(["p1"]);
    expect(result.failed).toHaveLength(0);
  });

  it("blocks ordinary acceptance when duplicate checking is unavailable", async () => {
    const createBatch = vi.fn();
    const result = await saveAgentProposals(
      {
        runId: "run-3",
        conversationId: "conv-1",
        provider: "fake",
        modelClass: "full",
        proposals: [proposals[0]],
        selected: selected().slice(0, 1),
      },
      {
        createBatch: createBatch as never,
        checkDuplicates: async () => {
          throw new Error("down");
        },
      }
    );
    expect(createBatch).not.toHaveBeenCalled();
    expect(result.failed[0].duplicateCheckUnavailable).toBe(true);
    expect(result.failed[0].error).toBe(AGENT_DUPLICATE_CHECK_UNAVAILABLE);
  });

  it("blocks a candidate that duplicates an existing card at save (concurrent recheck)", async () => {
    const createBatch = vi.fn();
    const result = await saveAgentProposals(
      {
        runId: "run-dup",
        conversationId: "conv-1",
        provider: "fake",
        modelClass: "full",
        proposals: [proposals[0]],
        selected: selected().slice(0, 1),
      },
      {
        createBatch: createBatch as never,
        checkDuplicates: async () => [
          { id: "created-meanwhile", question: "First A?", similarity: 0.95 },
        ],
      }
    );
    expect(createBatch).not.toHaveBeenCalled();
    expect(result.failed[0].error).toContain("Similar to existing card");
  });

  it("keeps the saved id and marks provenance pending when metadata recording fails", async () => {
    const createBatch = vi.fn(async (entries: Array<Record<string, unknown>>) =>
      entries.map((entry) => ({
        id: `saved-${entry.proposal_id}`,
        question: entry.question as string,
        item_type: "Qa" as const,
        state: "New" as const,
        due_date: "",
        date_created: "",
        date_modified: "",
        difficulty: 0,
        interval: 0,
        ease_factor: 0,
        review_count: 0,
        lapses: 0,
        is_suspended: false,
        tags: [],
      }))
    );
    const result = await saveAgentProposals(
      {
        runId: "run-prov",
        conversationId: "conv-1",
        provider: "fake",
        modelClass: "full",
        proposals: [proposals[0]],
        selected: selected().slice(0, 1),
      },
      {
        createBatch: createBatch as never,
        checkDuplicates: async () => [],
        recordProvenance: (async () => {
          throw new Error("provenance down");
        }) as never,
      }
    );
    expect(result.saved).toEqual([
      { proposalId: "p1", itemId: "saved-p1", provenancePending: true },
    ]);
    expect(result.failed).toHaveLength(0);
    // The card was not recreated to repair metadata.
    expect(createBatch).toHaveBeenCalledTimes(1);
  });

  it("blocks a write when an attached source changed after generation", async () => {
    const createBatch = vi.fn();
    const result = await saveAgentProposals(
      {
        runId: "run-stale",
        conversationId: "conv-1",
        provider: "fake",
        modelClass: "full",
        proposals: [proposals[0]],
        sources: [
          {
            attachmentId: "doc:doc-a",
            kind: "document",
            libraryId: "doc-a",
            title: "Paper A",
            contentVersion: "v1",
            origin: "active-view",
            role: "required",
          },
        ],
        selected: selected().slice(0, 1),
      },
      {
        createBatch: createBatch as never,
        checkDuplicates: async () => [],
        getDocumentSnapshot: () => ({ contentVersion: "v2" }),
      }
    );
    expect(createBatch).not.toHaveBeenCalled();
    expect(result.failed[0].error).toContain("changed");
  });

  it("keeps live ephemeral tokens out of the persisted artifact", () => {
    const artifact = buildAgentDraftArtifact({
      runId: "run-ephemeral",
      conversationId: "conv-1",
      intent: "Cards from this page",
      scope: "section",
      sources: [
        {
          attachmentId: "web:1",
          kind: "web",
          title: "Unsaved article",
          ephemeral: {
            ownerToken: "owner-secret-token",
            sourceType: "web",
            localOnly: true,
          },
          origin: "active-view",
          role: "required",
        },
      ],
      proposals: [],
    });
    const encoded = JSON.stringify(artifact);
    expect(encoded).not.toContain("owner-secret-token");
    expect(encoded).not.toContain("ownerToken");
  });

  it("creates extract-linked clozes through the existing extract writer with clean ranges", async () => {
    const clozeProposal: AgentProposal = {
      kind: "cloze",
      proposalId: "cloze-1",
      question: "Entropy is {{c1::disorder}}.",
      answer: "disorder",
      cardType: "cloze",
      sourceText: "Entropy is disorder.",
      sourceRefs: [
        {
          handle: "s1",
          refId: "extract-1",
          kind: "extract",
          documentId: "paper-a",
          text: "Entropy is disorder.",
        },
      ],
      sourceRevision: "rev-1",
      createdAt: 1,
    } as AgentProposal;
    const createCloze = vi.fn(async () => ({
      id: "cloze-item",
      question: "",
      item_type: "Cloze" as const,
      state: "New" as const,
      due_date: "",
      date_created: "",
      date_modified: "",
      difficulty: 0,
      interval: 0,
      ease_factor: 0,
      review_count: 0,
      lapses: 0,
      is_suspended: false,
      tags: [],
    }));
    const result = await saveAgentProposals(
      {
        runId: "run-cloze",
        conversationId: "conv-1",
        provider: "fake",
        modelClass: "full",
        proposals: [clozeProposal],
        selected: [
          {
            proposalId: "cloze-1",
            candidate: {
              cardType: "cloze",
              conceptKeys: ["entropy"],
              question: "Entropy is {{c1::disorder}}.",
              answer: "disorder",
              clozeText: "Entropy is {{c1::disorder}}.",
            },
          },
        ],
      },
      {
        createCloze: createCloze as never,
        createBatch: vi.fn() as never,
        createOne: vi.fn() as never,
        checkDuplicates: async () => [],
        recordProvenance: (async () => ({})) as never,
      }
    );
    expect(result.saved).toHaveLength(1);
    expect(createCloze).toHaveBeenCalledWith(
      "extract-1",
      "Entropy is disorder.",
      [[11, 19]],
      { acceptanceId: "run-cloze", proposalId: "cloze-1" }
    );
  });

  it("serializes extract-less cards through the existing source_reference envelope", () => {
    const source = (proposals[0] as AgentCardProposal).sourceRefs[0];
    const serialized = buildAgentCardSourceReference(source, {
      ...candidate(),
      evidenceQuote: "Entropy is disorder.",
    });
    const parsed = parseCardSourceReference(serialized ?? null);
    expect(parsed?.document_id).toBe("doc-a");
    expect(parsed?.excerpt).toContain("Entropy");
  });
});
