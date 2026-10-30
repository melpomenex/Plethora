import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InlineCardEditor } from "../../components/review/InlineCardEditor";
import { ToastType, useToastStore } from "../../components/common/Toast";
import { DeleteLearningItemCommand } from "../../commands/undoableCommands";
import { reanchorSessionPosition } from "../../pages/queueScrollSessionLifecycle";
import { normalizeAssistantToolParameters } from "../../lib/ai/assistant/toolCallParser";
import { createBrowserAssistantCard } from "../../lib/browserAssistantCards";
import {
  createFrozenAgentEnvironment,
  inferLearningAgentScope,
  resolveLearningAgentScope,
  type FrozenLearningAgentRun,
  type LearningAgentSectionInput,
} from "../../lib/ai/assistant/learningAgent";
import { createAgentEvidenceMap } from "../../lib/ai/agent/evidence";
import {
  getCurrentSelectionTool,
  getSectionContextTool,
} from "../../lib/ai/agent/tools/readonly";
import type { AgentSessionRuntime, AgentToolContext } from "../../lib/ai/agent/tools/types";
import { useSettingsStore } from "../../stores/settingsStore";
import type { LearningItem } from "../../api/learning-items";
import {
  createIssue6Provider,
  ISSUE6_CLOCK,
  ISSUE6_IDS,
  ISSUE6_SECTIONED_CONTENT,
} from "./fixtures";

useSettingsStore.persist.setOptions({
  storage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  } as any,
});

export type Issue6FailureCategory = "identity" | "persistence" | "refresh" | "provider";

const storeState = vi.hoisted(() => ({
  documents: new Map<string, { id: string; _deleted?: boolean }>(),
  extracts: new Map<string, { id: string; document_id: string; _deleted?: boolean }>(),
  cards: new Map<string, LearningItem>(),
  failNextTagWrite: null as Error | null,
}));

function classifyFailureSignature(input: {
  stage: "lineage" | "card-save" | "session-reconcile" | "agent-generation";
  errorMessage?: string;
  splitDurableMismatch?: boolean;
  zombieResurrected?: boolean;
}): Issue6FailureCategory {
  const msg = (input.errorMessage ?? "").toLowerCase();
  if (input.zombieResurrected) return "refresh";
  if (input.splitDurableMismatch) return "persistence";
  if (input.stage === "agent-generation") {
    return msg.includes("chapter or section") ? "identity" : "provider";
  }
  if (
    msg.includes("foreign key") ||
    msg.includes("flashcard-") ||
    msg.includes("source extract") ||
    msg.includes("does not match") ||
    msg.includes("learning item not found")
  ) {
    return "identity";
  }
  return "persistence";
}

function seedClozeCard(): LearningItem {
  return {
    id: ISSUE6_IDS.cards[2],
    document_id: ISSUE6_IDS.document,
    extract_id: ISSUE6_IDS.extract,
    item_type: "Cloze",
    question: "The {{c1::answer::hint}} is hidden.",
    answer: "Answer",
    cloze_text: "The {{c1::answer::hint}} is hidden.",
    difficulty: 3,
    interval: 0,
    ease_factor: 2.5,
    due_date: "2026-10-28T12:00:00Z",
    date_created: ISSUE6_CLOCK,
    date_modified: ISSUE6_CLOCK,
    last_review_date: "2026-10-21T12:00:00Z",
    review_count: 2,
    lapses: 0,
    state: "Review",
    is_suspended: false,
    tags: ["fixture"],
  };
}

vi.mock("../../lib/database", () => ({
  getDocument: vi.fn(async (id: string) => storeState.documents.get(id) ?? null),
  getExtract: vi.fn(async (id: string) => storeState.extracts.get(id) ?? null),
  createLearningItem: vi.fn(async (item: Record<string, unknown>) => {
    const docId = item.document_id as string | undefined;
    if (docId && !storeState.documents.has(docId)) {
      throw new Error("SQLITE_CONSTRAINT_FOREIGNKEY (code 787): FOREIGN KEY constraint failed");
    }
    const created = { ...seedClozeCard(), ...item, id: "created-assistant-card" } as LearningItem;
    storeState.cards.set(created.id, created);
    return created;
  }),
}));

vi.mock("../../lib/tauri", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isTauri: () => true,
  listen: vi.fn(async () => () => undefined),
  invokeCommand: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    const itemId = String(args.itemId ?? args.item_id ?? "");
    if (cmd === "get_learning_item") {
      const card = storeState.cards.get(itemId);
      return card ? structuredClone(card) : null;
    }
    if (cmd === "delete_learning_item") {
      if (!storeState.cards.has(itemId)) throw new Error(`Learning item ${itemId} not found`);
      storeState.cards.delete(itemId);
      return null;
    }
    if (cmd === "restore_learning_item") {
      const restored = args.item as LearningItem;
      storeState.cards.set(restored.id, structuredClone(restored));
      return null;
    }
    if (cmd === "update_learning_item_content_with_version") {
      const card = storeState.cards.get(itemId);
      if (!card) throw new Error(`Not found: Learning item ${itemId}`);
      if (storeState.failNextTagWrite) {
        const err = storeState.failNextTagWrite;
        storeState.failNextTagWrite = null;
        throw err;
      }
      const updated: LearningItem = {
        ...card,
        question: String(args.question),
        answer: args.answer !== undefined ? (args.answer as string) : card.answer,
        cloze_text: args.clozeText !== undefined ? (args.clozeText as string) : card.cloze_text,
        tags: args.tags !== undefined ? [...(args.tags as string[])] : card.tags,
      };
      storeState.cards.set(itemId, structuredClone(updated));
      return structuredClone(updated);
    }
    if (cmd === "update_learning_item_tags") {
      if (storeState.failNextTagWrite) {
        const err = storeState.failNextTagWrite;
        storeState.failNextTagWrite = null;
        throw err;
      }
      const card = storeState.cards.get(itemId);
      if (!card) throw new Error(`Not found: Learning item ${itemId}`);
      const updated: LearningItem = { ...card, tags: [...(args.tags as string[])] };
      storeState.cards.set(itemId, structuredClone(updated));
      return structuredClone(updated);
    }
    throw new Error(`Unexpected command in reproductions test: ${cmd}`);
  }),
}));

/** Mirrors AssistantPanel.tsx:1787-1804 (`buildAgentSection`). */
function buildCurrentAgentSection(
  selectedSectionNodes: Array<{ id: string; documentId?: string; title: string; content?: string }>,
  contextDocumentId?: string,
): LearningAgentSectionInput | undefined {
  const node = selectedSectionNodes[0];
  if (!node) return undefined;
  const documentId = node.documentId ?? contextDocumentId ?? "";
  const text = (node.content || "").trim().slice(0, 12_000);
  if (!documentId || !text) return undefined;
  return { documentId, title: node.title, text, sectionId: node.id, locator: { sectionId: node.id } };
}

function makeAgentToolContext(run: FrozenLearningAgentRun): AgentToolContext {
  const evidence = createAgentEvidenceMap(run.sourceRevision);
  const session = {
    runId: run.runId,
    proposals: [],
    proposalCapHit: false,
    evidence,
    sourceRevision: run.sourceRevision,
    closed: false,
    addProposal: vi.fn(),
    close: vi.fn(),
  } as unknown as AgentSessionRuntime;
  return { session, env: createFrozenAgentEnvironment(run) };
}

describe("issue #6 task 1.5 reproductions and failure signature classification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    storeState.documents.clear();
    storeState.extracts.clear();
    storeState.cards.clear();
    storeState.failNextTagWrite = null;
    storeState.documents.set(ISSUE6_IDS.document, { id: ISSUE6_IDS.document });
    storeState.extracts.set(ISSUE6_IDS.extract, {
      id: ISSUE6_IDS.extract,
      document_id: ISSUE6_IDS.document,
    });
    storeState.cards.set(ISSUE6_IDS.cards[2], seedClozeCard());
  });

  it("reproduces S04 and distinguishes queue-prefixed identity failure from split content/tag persistence failure", async () => {
    // 1. Identity signature: queue-prefixed display ID fails lookup (`Failed to save card` toast).
    const wrongIdentityCard: LearningItem = {
      ...seedClozeCard(),
      id: `flashcard-${ISSUE6_IDS.cards[2]}`,
    };
    const onIdentitySave = vi.fn();
    const { unmount } = render(
      <InlineCardEditor card={wrongIdentityCard} surface="queue" onClose={vi.fn()} onSave={onIdentitySave} />,
    );
    fireEvent.change(screen.getByLabelText(/cloze text/i), {
      target: { value: "The {{c1::wrong-id}} is hidden." },
    });
    fireEvent.click(screen.getByTestId("inline-card-editor-save"));

    await waitFor(() => expect(onIdentitySave).toHaveBeenCalledTimes(2));
    expect(useToastStore.getState().toasts.some((t) => t.type === ToastType.Error)).toBe(true);
    expect(storeState.cards.get(ISSUE6_IDS.cards[2])?.cloze_text).toBe(
      "The {{c1::answer::hint}} is hidden.",
    );
    expect(
      classifyFailureSignature({
        stage: "card-save",
        errorMessage: `Not found: Learning item flashcard-${ISSUE6_IDS.cards[2]}`,
      }),
    ).toBe("identity");
    unmount();

    // 2. Persistence signature: content write commits, separate tag write fails, UI rolls back to stale content!
    useToastStore.setState({ toasts: [] });
    storeState.failNextTagWrite = new Error("SQLite I/O error during tag update");
    const canonicalCard = seedClozeCard();
    const onSplitSave = vi.fn();
    render(
      <InlineCardEditor card={canonicalCard} surface="queue" onClose={vi.fn()} onSave={onSplitSave} />,
    );

    fireEvent.change(screen.getByLabelText(/cloze text/i), {
      target: { value: "The {{c1::persisted::hint}} is hidden." },
    });
    fireEvent.change(screen.getByDisplayValue("fixture"), {
      target: { value: "fixture, split-tag" },
    });
    fireEvent.click(screen.getByTestId("inline-card-editor-save"));

    await waitFor(() => expect(onSplitSave).toHaveBeenCalledTimes(2));
    const uiRolledBack = onSplitSave.mock.calls[1][0] as LearningItem;
    const durableAfterFailure = storeState.cards.get(ISSUE6_IDS.cards[2])!;
    // Atomic persistence guarantee (R04): Injected failure at tag/content stage aborts transaction,
    // leaving NO partial edit in durable storage!
    expect(uiRolledBack.cloze_text).toBe("The {{c1::answer::hint}} is hidden.");
    expect(durableAfterFailure.cloze_text).toBe("The {{c1::answer::hint}} is hidden.");
    expect(durableAfterFailure.tags).toEqual(["fixture"]);
    expect(useToastStore.getState().toasts.some((t) => t.type === ToastType.Error)).toBe(true);
    expect(
      classifyFailureSignature({
        stage: "card-save",
        errorMessage: "SQLite I/O error during tag update",
        splitDurableMismatch: uiRolledBack.cloze_text !== durableAfterFailure.cloze_text,
      }),
    ).toBe("persistence");
  });

  it("reproduces S09/S10: raw cloze title leak, deleted card resurrection without barrier, then 'Learning item not found'", async () => {
    const cloze = seedClozeCard();
    const ratedFlashcardIds = new Set<string>();
    const sessionItem = {
      id: `flashcard-${cloze.id}`,
      type: "flashcard" as const,
      // QueueScrollPage.tsx:1301,4713 raw question fallback leaks markers into itemTitle (S09).
      documentTitle: cloze.question.substring(0, 50),
      learningItem: cloze,
    };
    const nextItem = {
      id: "doc-issue6",
      type: "document" as const,
      documentTitle: "Sectioned document",
    };

    expect(sessionItem.documentTitle).toContain("{{c1::answer::hint}}");

    // 1. S10: First undoable delete removes the row in storage.
    const firstDelete = new DeleteLearningItemCommand(cloze.id);
    await firstDelete.execute();
    expect(storeState.cards.has(cloze.id)).toBe(false);

    // 2. Refresh race: QueueScrollPage lacks a deleted-ID barrier in canPresentItem
    //    (`!!item.learningItem && !ratedFlashcardIds.has(id)`), so applySessionItems /
    //    reanchorSessionPosition splices the deleted card back onto the screen!
    const currentCanPresentWithoutBarrier =
      Boolean(sessionItem.learningItem) && !ratedFlashcardIds.has(sessionItem.learningItem.id);
    expect(currentCanPresentWithoutBarrier).toBe(true);

    const reconciled = reanchorSessionPosition([sessionItem, nextItem], sessionItem.id, [nextItem]);
    const zombieResurrected = reconciled.items[reconciled.currentIndex]?.id === sessionItem.id;
    expect(zombieResurrected).toBe(true);
    expect(
      classifyFailureSignature({
        stage: "session-reconcile",
        zombieResurrected,
      }),
    ).toBe("refresh");

    // 3. S09: User clicks Delete again on the still-visible zombie card -> exact "Learning item not found".
    const secondDelete = new DeleteLearningItemCommand(cloze.id);
    await expect(secondDelete.execute()).rejects.toThrow("Learning item not found");
  });

  it("reproduces S05 extract-namespace normalization into FK 787 vs canonical source resolution", async () => {
    const legacy = { document_id: `extract:${ISSUE6_IDS.extract}`, question: "What is in the second section?", answer: "Second section body." };
    expect(() => normalizeAssistantToolParameters("create_qa_card", legacy,
      { documentId: legacy.document_id, documentTitle: "Sectioned document" })).toThrow("Resolve the extract");

    // Unresolved namespace hitting a document FK directly triggers SQLite 787 (identity error).
    const db = await import("../../lib/database");
    let rawFkMessage = "";
    try {
      await db.createLearningItem({
        document_id: legacy.document_id,
        item_type: "qa",
        question: "Q?",
        answer: "A",
      } as any);
    } catch (err) {
      rawFkMessage = (err as Error).message;
    }
    expect(rawFkMessage).toContain("787");
    expect(classifyFailureSignature({ stage: "lineage", errorMessage: rawFkMessage })).toBe("identity");

    // Canonical browserAssistantCards resolver maps `extract:<id>` -> parent document_id + extract_id.
    const saved = await createBrowserAssistantCard("qa", legacy);
    expect(saved).toMatchObject({
      success: true,
      document_id: ISSUE6_IDS.document,
      extract_id: ISSUE6_IDS.extract,
    });
  });

  it("compares S12 empty outline-node content vs pinned selection (section vs document scope) and provider failure", async () => {
    const docs = [{ id: ISSUE6_IDS.document, title: "Sectioned document", contentVersion: "v1" }];
    const pinned = {
      originalText: "Second section body.",
      documentId: ISSUE6_IDS.document,
      title: "Sectioned document",
    };

    // 1. Empty outline-node `.content` without pinned selection -> `needs-section` before any provider call.
    const emptyOutlineSection = buildCurrentAgentSection(
      [{ id: "sec-second", documentId: ISSUE6_IDS.document, title: "Second", content: "" }],
      ISSUE6_IDS.document,
    );
    expect(emptyOutlineSection).toBeUndefined();

    const idleProvider = createIssue6Provider();
    const emptyPrepared = resolveLearningAgentScope({
      conversationId: "conv-s12-empty",
      ownerRevision: 1,
      intent: "Create cards for this section",
      scope: "section",
      documents: docs,
      section: emptyOutlineSection,
    });
    expect(emptyPrepared).toMatchObject({ ok: false, reason: "needs-section" });
    expect(idleProvider.requests).toHaveLength(0);
    if (emptyPrepared.ok === false) {
      expect(
        classifyFailureSignature({ stage: "agent-generation", errorMessage: emptyPrepared.message }),
      ).toBe("identity");
    }

    // 2a. Pinned selection with explicit `document` scope chip -> `get_section_context` is not-available
    //     while `get_current_selection` is ok (exact S12 `current_selection` discrepancy!).
    const explicitDocScope = inferLearningAgentScope("Create cards for this section", {
      explicit: "document",
      documentCount: 1,
      hasSection: false,
      hasSelection: true,
    });
    expect(explicitDocScope).toBe("document");
    const docScoped = resolveLearningAgentScope({
      conversationId: "conv-s12-doc-chip",
      ownerRevision: 1,
      intent: "Create cards for this section",
      scope: explicitDocScope,
      documents: docs,
      selection: pinned,
    });
    expect(docScoped.ok).toBe(true);
    if (docScoped.ok) {
      const ctx = makeAgentToolContext(docScoped.run);
      const sectionOut = await getSectionContextTool.execute({}, ctx);
      const selectionOut = await getCurrentSelectionTool.execute({}, ctx);
      expect(sectionOut.outcome).toBe("not-available");
      expect(selectionOut.outcome).toBe("ok");
      expect(selectionOut.result).toMatchObject({
        documentId: ISSUE6_IDS.document,
        text: "Second section body.",
      });
    }

    // 2b. Pinned selection with auto/section scope -> freezes into BOTH section and selection; provider failure is distinct.
    const autoSectionScope = inferLearningAgentScope("Create cards for this section", {
      explicit: undefined,
      documentCount: 1,
      hasSection: false,
      hasSelection: true,
    });
    expect(autoSectionScope).toBe("section");
    const sectionScoped = resolveLearningAgentScope({
      conversationId: "conv-s12-pinned",
      ownerRevision: 1,
      intent: "Create cards for this section",
      scope: autoSectionScope,
      documents: docs,
      selection: pinned,
    });
    expect(sectionScoped.ok).toBe(true);
    if (sectionScoped.ok) {
      const ctx = makeAgentToolContext(sectionScoped.run);
      const sectionOut = await getSectionContextTool.execute({}, ctx);
      expect(sectionOut.outcome).toBe("ok");
      expect(ISSUE6_SECTIONED_CONTENT).toContain(sectionScoped.run.section!.text);

      const failingProvider = createIssue6Provider({
        error: new Error("Apple Intelligence foundation model unavailable"),
      });
      let providerErr = "";
      try {
        await failingProvider.generate({
          documentId: sectionScoped.run.section!.documentId,
          sourceContent: sectionScoped.run.section!.text,
        });
      } catch (err) {
        providerErr = (err as Error).message;
      }
      expect(failingProvider.requests).toEqual([
        { documentId: ISSUE6_IDS.document, sourceContent: "Second section body." },
      ]);
      expect(
        classifyFailureSignature({ stage: "agent-generation", errorMessage: providerErr }),
      ).toBe("provider");
    }
  });
});
