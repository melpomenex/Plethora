import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Unit tests for the assistant-conversation sync entity.
 *
 * The point of this entity is: sync per-document assistant chats across devices
 * while NEVER putting image data-URLs into the shared Yjs doc (they'd bloat it
 * the same way cover images did for documents). These tests pin:
 *   1. stripImages removes every message's `images` (and only images).
 *   2. toSyncedConversation preserves text/role/timestamp/toolCalls and caps
 *      to MAX_STORED_MESSAGES.
 *   3. publish/apply round-trip via the ReplicatedMap (mocked) writes
 *      localStorage and dispatches the refresh event.
 *   4. row-LWW: the factory is configured with mode "row-lww" + clockField
 *      "updatedAt" so newer conversations win.
 */

// Mock createReplicatedMap to capture the config and exercise its callbacks
// directly. We don't need a real Yjs doc for these unit tests — the entity is
// a thin adapter between localStorage and the (already heavily tested)
// replicatedMap factory.
//
// The capture is stashed on globalThis so it survives vi.resetModules() (which
// re-evaluates the mock with a fresh closure) — every mock instance writes to
// the same well-known property.
vi.mock("../sync/replicatedMap", () => {
  const factory = (config: any) => {
    (globalThis as any).__capturedConvConfig = config;
    return {
      ensureReady: vi.fn(async () => {}),
      publish: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      getMap: () => null,
      gc: () => 0,
      teardown: () => {},
      publishDebounced: vi.fn(async () => {}),
    };
  };
  return { createReplicatedMap: factory };
});

// isTauri gate: the entity no-ops publish when not in Tauri. Force true so we
// can exercise the publish path.
vi.mock("../tauri", () => ({ isTauri: () => true }));

function getCapturedConfig(): any {
  return (globalThis as any).__capturedConvConfig ?? null;
}

/**
 * Instantiate the entity's map freshly, capturing its replicatedMap config.
 * The entity holds a module-level singleton, so we use vi.resetModules to get a
 * clean module + a fresh config capture per call.
 */
async function freshEntity() {
  (globalThis as any).__capturedConvConfig = null;
  vi.resetModules();
  const mod = await import("../sync/entities/conversations");
  await mod.ensureConversationSyncReady();
  return mod;
}

beforeEach(() => {
  for (const k of Array.from(Object.keys(localStorage))) localStorage.removeItem(k);
  (globalThis as any).__capturedConvConfig = null;
});

describe("sync:conversations — stripImages", () => {
  it("removes images from every message but preserves text/role/timestamp/toolCalls", async () => {
    const { toSyncedConversation } = await freshEntity();
    const row = toSyncedConversation("document:abc", {
      messages: [
        {
          id: "u1",
          role: "user",
          content: "what is this?",
          timestamp: 1,
          images: [{ id: "img1", dataUrl: "data:image/png;base64,BIG" }],
        },
        {
          id: "a1",
          role: "assistant",
          content: "it is a thing",
          timestamp: 2,
          toolCalls: [{ name: "search", parameters: { q: "thing" }, status: "pending" }],
        },
      ],
      input: "draft",
      updatedAt: 1000,
    });

    const stripped = getCapturedConfig().strip(row);

    expect(stripped.messages[0].images).toBeUndefined();
    expect(stripped.messages[0].content).toBe("what is this?");
    expect(stripped.messages[0].role).toBe("user");
    expect(stripped.messages[0].timestamp).toBe(1);
    // Message without images stays intact.
    expect(stripped.messages[1].toolCalls).toHaveLength(1);
    expect(stripped.messages[1].content).toBe("it is a thing");
    // Top-level fields preserved.
    expect(stripped.key).toBe("document:abc");
    expect(stripped.input).toBe("draft");
    expect(stripped.updatedAt).toBe(row.updatedAt);
  });

  it("does not mutate the original row", async () => {
    const { toSyncedConversation } = await freshEntity();
    const row = toSyncedConversation("general", {
      messages: [
        { id: "u1", role: "user", content: "hi", timestamp: 1, images: [{ id: "i", dataUrl: "x" }] },
      ],
      updatedAt: 5,
    });
    getCapturedConfig().strip(row);
    // Original still carries its images.
    expect(row.messages[0].images).toHaveLength(1);
  });
});

describe("sync:conversations — toSyncedConversation", () => {
  it("preserves message text, role, timestamp and toolCalls", async () => {
    const { toSyncedConversation } = await freshEntity();
    const conv = toSyncedConversation("document:1", {
      messages: [
        { id: "m1", role: "user", content: "hello", timestamp: 10 },
        { id: "m2", role: "assistant", content: "hi back", timestamp: 20 },
      ],
      input: "unfinished",
      updatedAt: 30,
    });
    expect(conv.messages).toHaveLength(2);
    expect(conv.messages.map((m: any) => m.content)).toEqual(["hello", "hi back"]);
    expect(conv.input).toBe("unfinished");
  });

  it("caps to the last 200 messages", async () => {
    const { toSyncedConversation } = await freshEntity();
    const msgs = Array.from({ length: 250 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `c${i}`,
      timestamp: i,
    }));
    const conv = toSyncedConversation("general", { messages: msgs, updatedAt: 999 });
    expect(conv.messages).toHaveLength(200);
    // Most recent 200 kept (m50..m249).
    expect(conv.messages[0].id).toBe("m50");
    expect(conv.messages[199].id).toBe("m249");
  });

  it("drops malformed messages", async () => {
    const { toSyncedConversation } = await freshEntity();
    const conv = toSyncedConversation("general", {
      messages: [
        { id: "ok", role: "user", content: "good", timestamp: 1 },
        { id: 123, role: "user", content: "bad id type", timestamp: 2 }, // bad id
        { id: "badrole", role: "robot", content: "x", timestamp: 3 }, // bad role
        null, // not an object
      ],
    });
    expect(conv.messages).toHaveLength(1);
    expect(conv.messages[0].id).toBe("ok");
  });

  it("builds a sortable HLC-shaped updatedAt from epoch-ms when present", async () => {
    const { toSyncedConversation } = await freshEntity();
    const conv = toSyncedConversation("general", {
      messages: [],
      updatedAt: 1750000000123,
    });
    // 13-digit zero-padded ms + counter suffix.
    expect(conv.updatedAt).toBe("1750000000123.000000");
  });
});

describe("sync:conversations — publishConversation writes localStorage + clock", () => {
  it("writes the conversation blob with the published clock so the echo guard recognizes our own write", async () => {
    const { publishConversation, ASSISTANT_CONVERSATIONS_KEY } = await freshEntity();
    await publishConversation("document:xyz", {
      messages: [{ id: "u1", role: "user", content: "ping", timestamp: 1 }],
      input: "",
    });

    const raw = localStorage.getItem(ASSISTANT_CONVERSATIONS_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed["document:xyz"]).toBeDefined();
    expect(parsed["document:xyz"].messages[0].content).toBe("ping");
    // updatedAt is an epoch-ms number in localStorage (the entity converts to
    // HLC only on the wire).
    expect(typeof parsed["document:xyz"].updatedAt).toBe("number");
  });
});

describe("sync:conversations — apply writes localStorage + dispatches event", () => {
  it("apply merges the remote conversation into the blob and emits incrementum:synced-conversation", async () => {
    const { publishConversation, ASSISTANT_CONVERSATIONS_KEY } = await freshEntity();
    // Seed an unrelated conversation so we can verify apply preserves it.
    const seed = { other: { messages: [], input: "", updatedAt: 1 } };
    localStorage.setItem(ASSISTANT_CONVERSATIONS_KEY, JSON.stringify(seed));

    // publishConversation instantiates the map (capturing config).
    await publishConversation("document:keep", {
      messages: [{ id: "x", role: "user", content: "x", timestamp: 1 }],
    });

    const events: string[] = [];
    const listener = (e: Event) => events.push((e as CustomEvent).type);
    window.addEventListener("incrementum:synced-conversation", listener);

    try {
      await getCapturedConfig().apply("document:remote", {
        key: "document:remote",
        messages: [{ id: "r1", role: "assistant", content: "from other device", timestamp: 5 }],
        input: "",
        updatedAt: "0000000009000.000000",
      });

      const parsed = JSON.parse(localStorage.getItem(ASSISTANT_CONVERSATIONS_KEY)!);
      // The remote conversation was written...
      expect(parsed["document:remote"].messages[0].content).toBe("from other device");
      // ...and the pre-existing 'other' key is untouched.
      expect(parsed.other).toBeDefined();

      expect(events).toContain("incrementum:synced-conversation");
    } finally {
      window.removeEventListener("incrementum:synced-conversation", listener);
    }
  });
});

describe("sync:conversations — replicatedMap config", () => {
  it("is configured for row-LWW on updatedAt", async () => {
    await freshEntity();
    const cfg = getCapturedConfig();
    expect(cfg).not.toBeNull();
    expect(cfg.mode).toBe("row-lww");
    expect(cfg.clockField).toBe("updatedAt");
    expect(cfg.name).toBe("assistantConversations");
  });
});
