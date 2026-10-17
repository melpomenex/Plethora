/**
 * Legacy import tests (tasks 1.5/1.6) against the fixture corpus captured in
 * task 0.4 (`openspec/changes/unify-assistant-experience/fixtures/data`).
 *
 * These intentionally read the *raw* fixture JSON, not the capped UI loaders,
 * and verify: no retention cap is applied, duplicate original ids across
 * origins stay distinct, repeated and crash-resumed imports are exactly-once,
 * malformed records are quarantined recoverably, and unknown fields survive.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConversationRepositoryCore } from "../core";
import { MemoryConversationStore } from "../store";
import {
  importLegacyRecords,
  legacyConversationId,
  qaSessionRecordsFromRaw,
  sidebarRecordsFromRaw,
  stableDigest,
} from "../importLegacy";
import type { ConversationRepository } from "../repository";
import type { ConversationRecord } from "../types";

const FIXTURE_DIR = join(
  process.cwd(),
  "openspec", "changes", "unify-assistant-experience", "fixtures", "data",
);

function readFixture(name: string): string | null {
  const path = join(FIXTURE_DIR, name);
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf8");
}

const sidebarRaw = readFixture("sidebar-conversations.json");
const qaRaw = readFixture("qa-sessions.json");
const corruptRaw = readFixture("corrupt-records.json");

const OWNER = "local:device-a";

function setup(): { repository: ConversationRepository; store: MemoryConversationStore } {
  const store = new MemoryConversationStore();
  const repository = new ConversationRepositoryCore(store, {
    nativeSync: false,
    durableTransactions: false,
    location: "device",
  });
  return { repository, store };
}

describe("legacy import (task 0.4 fixture corpus)", () => {
  it.skipIf(sidebarRaw === null || qaRaw === null)(
    "imports the full corpus with no retention caps applied",
    async () => {
      const { repository } = setup();
      const snapshot = {
        records: [
          ...sidebarRecordsFromRaw(sidebarRaw),
          ...qaSessionRecordsFromRaw(qaRaw),
        ],
      };
      const report = await importLegacyRecords({
        repository,
        ownerProfileId: OWNER,
        snapshot,
      });

      expect(report.complete).toBe(true);
      expect(report.quarantined).toBe(0);
      // 60 sidebar keys + 62 Q&A sessions, all imported.
      expect(report.importedConversations).toBe(60 + 62);

      // More messages than any legacy cap. Sidebar fixture alone has 572
      // messages including a 250-message thread.
      const record = await repository.getConversation(
        OWNER,
        legacyConversationId(OWNER, "sidebar:document", "document:doc-2"),
      );
      expect(record.ok).toBe(true);
      expect(record.value!.messages.length).toBe(250);

      // Q&A session with 70 messages (above the 50-message cap) survives.
      const qa = await repository.getConversation(
        OWNER,
        legacyConversationId(OWNER, "qa-sessions", "qa-fixture-1"),
      );
      expect(qa.ok).toBe(true);
      expect(qa.value!.messages.length).toBe(70);
      // Draft with section mentions and context passage survives.
      expect(qa.value!.draft?.text).toContain("second chapter");
      expect(qa.value!.draft?.mentionTokens).toHaveLength(2);
      expect(qa.value!.draft?.selection?.originalText).toContain("Selected passage");

      // Unknown fields are preserved.
      expect(qa.value!.unknownFields).toBeDefined();
    },
  );

  it.skipIf(corruptRaw === null)(
    "keeps distinct legacy keys with byte-identical content distinct",
    async () => {
      const { repository } = setup();
      const corrupt = JSON.parse(corruptRaw!) as { sidebarMixed: string };
      // `sidebarMixed` carries two distinct keys (`document:dup`,
      // `document:dup2`) whose records are byte-identical.
      const sidebar = sidebarRecordsFromRaw(corrupt.sidebarMixed);
      const targets = sidebar.filter(
        (record) => record.recordKey === "document:dup" || record.recordKey === "document:dup2",
      );
      expect(targets).toHaveLength(2);
      const report = await importLegacyRecords({
        repository,
        ownerProfileId: OWNER,
        snapshot: { records: targets },
      });
      expect(report.importedConversations).toBe(2);
      const first = await repository.getConversation(
        OWNER,
        legacyConversationId(OWNER, "sidebar:document", "document:dup"),
      );
      const second = await repository.getConversation(
        OWNER,
        legacyConversationId(OWNER, "sidebar:document", "document:dup2"),
      );
      expect(first.ok && second.ok).toBe(true);
      expect(first.value!.id).not.toBe(second.value!.id);
      // Same ids inside, separate namespaces: neither import dropped a message.
      expect(first.value!.messages.length).toBe(3);
      expect(second.value!.messages.length).toBe(3);
    },
  );

  it.skipIf(qaRaw === null)(
    "is idempotent across repeated and crash-resumed imports",
    async () => {
      const { repository } = setup();
      const records = qaSessionRecordsFromRaw(qaRaw).filter((record) =>
        record.recordKey.startsWith("qa-fixture-") || record.recordKey.startsWith("qa-dup"),
      );
      const snapshot = { records };

      const first = await importLegacyRecords({
        repository,
        ownerProfileId: OWNER,
        snapshot,
      });
      const importedFirst = first.importedConversations;
      expect(importedFirst).toBeGreaterThan(0);

      // Full re-run: everything is skipped, nothing duplicates.
      const second = await importLegacyRecords({
        repository,
        ownerProfileId: OWNER,
        snapshot,
      });
      expect(second.importedConversations).toBe(0);
      expect(second.skipped).toBe(records.length);

      // Crash-resume from a mid-point checkpoint: no duplicate candidates.
      const resumed = await importLegacyRecords({
        repository,
        ownerProfileId: OWNER,
        snapshot,
        checkpoint: { cursor: String(Math.floor(records.length / 2)), importedConversations: 0, importedMessages: 0, quarantined: 0 },
      });
      expect(resumed.importedConversations).toBe(0);

      const record = await repository.getConversation(
        OWNER,
        legacyConversationId(OWNER, "qa-sessions", "qa-fixture-1"),
      );
      expect(record.value!.messages).toHaveLength(70);
    },
  );

  it.skipIf(corruptRaw === null)(
    "quarantines malformed records while importing valid neighbours",
    async () => {
      const { repository } = setup();
      const corrupt = JSON.parse(corruptRaw!) as {
        qaSessionsMixed: string;
        truncatedJson: string;
      };
      const snapshot = {
        records: [
          ...qaSessionRecordsFromRaw(corrupt.qaSessionsMixed),
          { origin: "legacy-zustand", recordKey: "truncated", raw: corrupt.truncatedJson, rawText: corrupt.truncatedJson },
        ],
      };
      const report = await importLegacyRecords({
        repository,
        ownerProfileId: OWNER,
        snapshot,
      });
      expect(report.quarantined).toBeGreaterThan(0);
      expect(report.importedConversations).toBeGreaterThan(0);

      // The malformed bytes stay recoverable.
      const quarantined = await repository.listQuarantined(OWNER);
      expect(quarantined.ok).toBe(true);
      expect(quarantined.value!.length).toBeGreaterThan(0);

      // The valid neighbour imported with full messages.
      const survivor = await repository.getConversation(
        OWNER,
        legacyConversationId(OWNER, "qa-sessions", "qa-survivor-1"),
      );
      expect(survivor.ok).toBe(true);
      expect(survivor.value!.messages.length).toBe(4);
    },
  );

  it("skips a modern empty Zustand blob without claiming recovery", async () => {
    const { repository } = setup();
    const { legacyZustandRecordsFromRaw } = await import("../importLegacy");
    const modern = legacyZustandRecordsFromRaw(JSON.stringify({ state: {}, version: 0 }));
    expect(modern).toHaveLength(0);
    const legacy = legacyZustandRecordsFromRaw(
      JSON.stringify({
        state: { messages: [{ id: "m0", role: "user", content: "Old question", timestamp: 1000 }] },
        version: 0,
      }),
    );
    expect(legacy).toHaveLength(1);
    const report = await importLegacyRecords({
      repository,
      ownerProfileId: OWNER,
      snapshot: { records: legacy },
    });
    expect(report.importedConversations).toBe(1);
  });

  it("captures a live ephemeral snapshot without inventing evidence", async () => {
    const { repository } = setup();
    const { buildLiveSnapshotDraft, importLiveSnapshot } = await import("../importLegacy");
    const draft = buildLiveSnapshotDraft(OWNER, {
      surface: "ask-sheet",
      question: "Why does this matter?",
      answer: "Because the argument depends on it.",
      selectionText: "The captured passage.",
      documentId: "doc-1",
      title: "Selection question",
      capturedAt: 1_700_000_000_000,
    });
    const captured = await importLiveSnapshot({ repository, draft });
    expect(captured.ok).toBe(true);

    // Re-capturing the same handoff is idempotent (same deterministic id).
    const again = await importLiveSnapshot({ repository, draft });
    expect(again.ok).toBe(true);
    expect(again.reason).toBe("already captured");

    const record = await repository.getConversation(OWNER, captured.conversationId);
    expect(record.ok).toBe(true);
    expect(record.value!.messages).toHaveLength(2);
    // Device-local and unverified: a remembered answer is never promoted to
    // verified evidence and the thread never syncs.
    expect(record.value!.syncPolicy).toBe("device-local");
    const answer = record.value!.messages.find((message) => message.role === "assistant")!;
    expect(answer.evidence?.level).toBe("unverified");
    expect(record.value!.contextPolicy.mode).toBe("document");
  });

  it("exports recoverable quarantine bytes untouched", async () => {
    const { repository } = setup();
    const { exportRecoverableData } = await import("../importLegacy");
    await repository.importConversations(OWNER, {
      formatVersion: 1,
      exportedAt: 0,
      conversations: [{ nonsense: true } as never],
    });
    const exported = await exportRecoverableData({ repository, ownerProfileId: OWNER });
    expect(exported.quarantined).toHaveLength(1);
    expect(exported.quarantined[0].raw).toEqual({ nonsense: true });
  });

  it("deterministic ids are stable, distinct per key, and profile-scoped", () => {
    const a = legacyConversationId(OWNER, "sidebar:document", "document:doc-1");
    const b = legacyConversationId(OWNER, "sidebar:document", "document:doc-1");
    const c = legacyConversationId(OWNER, "sidebar:document", "document:doc-2");
    const d = legacyConversationId("local:device-b", "sidebar:document", "document:doc-1");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
    expect(stableDigest("same")).toBe(stableDigest("same"));
    expect(stableDigest("same")).not.toBe(stableDigest("other"));
  });

  it("preserves legacy payloads verbatim (citations, tools, images, unknown)", async () => {
    const { repository } = setup();
    const legacyRecord = {
      id: "legacy-thread",
      title: "Legacy",
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_100_000,
      selectedDocumentId: "",
      webSearchEnabled: false,
      messages: [
        { id: "u1", role: "user", content: "Q", timestamp: 1_700_000_000_000 },
        {
          id: "a1",
          role: "assistant",
          content: "A with [1] marker",
          timestamp: 1_700_000_001_000,
          citations: [{ documentId: "d", chunkIndex: 3, score: 0.9 }],
          toolCalls: [{ name: "create_qa_card", status: "success", result: { cardId: "c1" } }],
          evidence: { level: "supported", retrievalOnly: false, mode: "semantic", documentCount: 1 },
          unknownFutureField: { nested: true },
        },
      ],
      draft: { text: "unsent", sections: [{ id: "s1", title: "Section", documentId: "d" }] },
    };
    const report = await importLegacyRecords({
      repository,
      ownerProfileId: OWNER,
      snapshot: {
        records: [{ origin: "qa-sessions", recordKey: "legacy-thread", raw: legacyRecord }],
      },
    });
    expect(report.importedConversations).toBe(1);
    const record = await repository.getConversation(
      OWNER,
      legacyConversationId(OWNER, "qa-sessions", "legacy-thread"),
    );
    const assistant = record.value!.messages.find((message) => message.role === "assistant")!;
    expect(assistant.legacyPayload).toBeDefined();
    const payload = assistant.legacyPayload as Record<string, unknown>;
    expect(payload.citations).toBeDefined();
    expect(payload.toolCalls).toBeDefined();
    expect(payload.unknownFutureField).toEqual({ nested: true });
    // Legacy `[N]` is never promoted to verified canonical citations.
    expect(assistant.citations).toBeUndefined();
    expect(assistant.evidence).toBeUndefined();
  });

  it("imports more than 50 sessions and more than 50 messages each without truncation", async () => {
    const { repository } = setup();
    const sessions = Array.from({ length: 60 }, (_, sessionIndex) => ({
      id: `big-session-${sessionIndex}`,
      title: `Session ${sessionIndex}`,
      createdAt: 1_700_000_000_000 + sessionIndex,
      updatedAt: 1_700_000_100_000 + sessionIndex,
      selectedDocumentId: "",
      webSearchEnabled: false,
      messages: Array.from({ length: 55 }, (_, messageIndex) => ({
        id: `big-${sessionIndex}-m${messageIndex}`,
        role: messageIndex % 2 === 0 ? "user" : "assistant",
        content: `Message ${messageIndex}`,
        timestamp: 1_700_000_000_000 + messageIndex,
      })),
      draft: { text: "", sections: [] },
    }));
    const snapshot = {
      records: sessions.map((session) => ({
        origin: "qa-sessions",
        recordKey: session.id,
        raw: session,
        rawText: JSON.stringify(session),
      })),
    };
    const report = await importLegacyRecords({
      repository,
      ownerProfileId: OWNER,
      snapshot,
    });
    expect(report.importedConversations).toBe(60);
    expect(report.importedMessages).toBe(60 * 55);
    const page = await repository.listConversations(OWNER, { limit: 100 });
    expect(page.items.length).toBe(60);
    const one = await repository.getConversation(
      OWNER,
      legacyConversationId(OWNER, "qa-sessions", "big-session-0"),
    );
    expect(one.value!.messages).toHaveLength(55);
  });
});

describe("imported records remain valid canonical records", () => {
  it.skipIf(sidebarRaw === null)("passes every imported record through the v2 decoder", async () => {
    const { repository } = setup();
    const snapshot = { records: sidebarRecordsFromRaw(sidebarRaw) };
    await importLegacyRecords({ repository, ownerProfileId: OWNER, snapshot });
    const page = await repository.listConversations(OWNER, { limit: 200 });
    for (const summary of page.items) {
      const record = await repository.getConversation(OWNER, summary.id);
      expect(record.ok).toBe(true);
      const candidate: ConversationRecord = record.value!;
      expect(candidate.version).toBe(2);
      expect(candidate.syncPolicy).toBe("device-local");
      expect(candidate.legacyAliases.length).toBeGreaterThan(0);
    }
  });
});
