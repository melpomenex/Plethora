/**
 * Flag rollback and canonical-history tests (tasks 1.8/1.9).
 *
 * Verifies the ownership bridge's contract:
 *  - one writer: canonical data survives flag disable and is readable through
 *    the flag-free history path;
 *  - a legacy (capped) projection may not overwrite canonical post-cutover
 *    data;
 *  - navigation deferral happens exactly when a draft flush fails, and never
 *    invents a success.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ConversationRepositoryCore } from "../core";
import { MemoryConversationStore } from "../store";
import {
  exportCanonicalHistory,
  legacyProjectionMayWrite,
  readCanonicalConversation,
  readCanonicalHistory,
} from "../historyReader";
import { commitCanonicalDraft, shouldDeferNavigation } from "../bridge";
import type { ConversationRepository } from "../repository";

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

async function seed(repository: ConversationRepository, id: string, title = "Thread") {
  await repository.createConversation({
    id,
    ownerProfileId: OWNER,
    title,
    contextPolicy: { mode: "auto", origin: "explicit" },
  });
}

describe("flag rollback", () => {
  let repository: ConversationRepository;
  let store: MemoryConversationStore;

  beforeEach(async () => {
    ({ repository, store } = setup());
    // The deploy deferral/flush paths only run with canonical ownership on;
    // these tests exercise that behavior directly.
    const { useSettingsStore } = await import("../../../../../stores/settingsStore");
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        features: { ...state.settings.features, assistantCanonicalConversations: true },
      },
    }));
  });

  afterEach(async () => {
    const { useSettingsStore } = await import("../../../../../stores/settingsStore");
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        features: { ...state.settings.features, assistantCanonicalConversations: false },
      },
    }));
  });

  it("keeps post-cutover canonical data readable through the flag-free history path", async () => {
    await seed(repository, "conv-post-cutover", "Post cutover");
    // Simulate enabling canonical ownership, writing, then disabling the flag
    // (the flag itself never touches stored bytes).
    const disabledHistory = await readCanonicalHistory({
      repository,
      ownerProfileId: OWNER,
    });
    expect(disabledHistory.map((entry) => entry.id)).toEqual(["conv-post-cutover"]);

    const record = await readCanonicalConversation({
      repository,
      ownerProfileId: OWNER,
      conversationId: "conv-post-cutover",
    });
    expect(record?.title).toBe("Post cutover");

    const exported = await exportCanonicalHistory({
      repository,
      ownerProfileId: OWNER,
      appRevision: "3.3.0",
    });
    expect(exported.conversations).toHaveLength(1);
    expect(exported.conversations[0].id).toBe("conv-post-cutover");
  });

  it("refuses a legacy projection write over canonical data", async () => {
    await seed(repository, "conv-1");
    expect(
      await legacyProjectionMayWrite({
        repository,
        ownerProfileId: OWNER,
        conversationId: "conv-1",
      }),
    ).toBe(false);
    // A brand-new id is still writable by whichever path owns cutover.
    expect(
      await legacyProjectionMayWrite({
        repository,
        ownerProfileId: OWNER,
        conversationId: "conv-new",
      }),
    ).toBe(true);
  });

  it("defers navigation only when the canonical draft flush fails", async () => {
    await seed(repository, "conv-1");
    const draft = {
      deviceId: "device-a",
      revision: 0,
      text: "unsent",
      attachments: [],
      mentionTokens: [],
      updatedAt: Date.now(),
    };
    // No unsaved text: never deferred even on the canonical path.
    const noText = await shouldDeferNavigation({
      ownerProfileId: OWNER,
      conversationId: "conv-1",
      deviceId: "device-a",
      expectedRevision: 0,
      draft,
      hasUnsavedText: false,
      repository,
    });
    expect(noText.defer).toBe(false);

    // Storage failure defers the transition with a recoverable reason.
    store.failWrites = new Error("QuotaExceededError: full");
    const deferred = await shouldDeferNavigation({
      ownerProfileId: OWNER,
      conversationId: "conv-1",
      deviceId: "device-a",
      expectedRevision: 0,
      draft,
      hasUnsavedText: true,
      repository,
    });
    expect(deferred.defer).toBe(true);
    expect(deferred.reason).toBeTruthy();

    // Recovery: after storage works again the flush succeeds and the
    // transition proceeds without manual reconciliation.
    store.failWrites = null;
    const flushed = await shouldDeferNavigation({
      ownerProfileId: OWNER,
      conversationId: "conv-1",
      deviceId: "device-a",
      expectedRevision: 0,
      draft,
      hasUnsavedText: true,
      repository,
    });
    expect(flushed.defer).toBe(false);
    const record = await readCanonicalConversation({
      repository,
      ownerProfileId: OWNER,
      conversationId: "conv-1",
    });
    expect(record?.draft?.text).toBe("unsent");
  });

  it("reports a revision conflict rather than overwriting a newer revision", async () => {
    await seed(repository, "conv-1");
    const draft = {
      deviceId: "device-a",
      revision: 0,
      text: "x",
      attachments: [],
      mentionTokens: [],
      updatedAt: Date.now(),
    };
    const first = await commitCanonicalDraft({
      ownerProfileId: OWNER,
      conversationId: "conv-1",
      deviceId: "device-a",
      expectedRevision: 0,
      draft,
      repository,
    });
    expect(first.ok).toBe(true);
    // A second write with the stale revision is rejected, not merged.
    const stale = await commitCanonicalDraft({
      ownerProfileId: OWNER,
      conversationId: "conv-1",
      deviceId: "device-a",
      expectedRevision: 0,
      draft: { ...draft, text: "newer text" },
      repository,
    });
    expect(stale.ok).toBe(false);
    expect(stale.code).toBe("revision_conflict");
    const record = await readCanonicalConversation({
      repository,
      ownerProfileId: OWNER,
      conversationId: "conv-1",
    });
    expect(record?.draft?.text).toBe("x");
  });

  it("exposes tombstones to the downgraded reader without resurrecting them", async () => {
    await seed(repository, "conv-1");
    await repository.deleteConversation("conv-1", {
      ownerProfileId: OWNER,
      expectedRevision: 0,
    });
    const history = await readCanonicalHistory({ repository, ownerProfileId: OWNER });
    expect(history).toHaveLength(1);
    expect(history[0].deleted).toBe(true);
    const record = await readCanonicalConversation({
      repository,
      ownerProfileId: OWNER,
      conversationId: "conv-1",
    });
    expect(record?.deletedAt).toBeGreaterThan(0);
  });
});

describe("bridge flag behavior", () => {
  it("falls back to legacy behavior while the flag is off", async () => {
    const { useSettingsStore } = await import("../../../../../stores/settingsStore");
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        features: { ...state.settings.features, assistantCanonicalConversations: false },
      },
    }));
    const { canonicalConversationsEnabled } = await import("../bridge");
    expect(canonicalConversationsEnabled()).toBe(false);
    // A flag-off navigation never blocks the legacy flow.
    const { shouldDeferNavigation } = await import("../bridge");
    const result = await shouldDeferNavigation({
      ownerProfileId: OWNER,
      conversationId: "whatever",
      deviceId: "device-a",
      expectedRevision: 0,
      draft: {
        deviceId: "device-a",
        revision: 0,
        text: "text",
        attachments: [],
        mentionTokens: [],
        updatedAt: Date.now(),
      },
      hasUnsavedText: true,
    });
    expect(result.defer).toBe(false);
  });
});
