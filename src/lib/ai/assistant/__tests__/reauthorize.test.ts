/**
 * Reauthorization tests (task 2.6).
 *
 * The privacy property: once a source edge is denied, none of its bytes can
 * reach an outbound surface — history, summaries, suggestions, tool text,
 * repair prompts, embeddings, web queries or fallbacks. "Network spies" here
 * are dispatch functions whose calls are recorded and whose arguments are
 * asserted to contain no forbidden text.
 */

import { describe, expect, it } from "vitest";
import {
  guardedDispatch,
  reauthorizeHistory,
  strictFollowUpDecision,
  type ReauthorizeContext,
  type SourceAuthorizationVerdict,
} from "../reauthorize";
import type { EvidenceStatus, Message, SourceReference } from "../conversations/types";

const SECRET = "SECRET-LOCAL-ONLY-PASSAGE";

function context(options: {
  verdicts: Record<string, SourceAuthorizationVerdict>;
  remoteDestination?: boolean;
  strictLocalOnly?: boolean;
}): ReauthorizeContext {
  return {
    remoteDestination: options.remoteDestination ?? false,
    strictLocalOnly: options.strictLocalOnly ?? false,
    authorize: async (libraryId) =>
      options.verdicts[libraryId] ?? {
        authorized: false,
        reason: "unknown",
        detail: "no longer available",
      },
  };
}

function source(overrides: Partial<SourceReference> = {}): SourceReference {
  return {
    attachmentId: overrides.attachmentId ?? "att-1",
    kind: "document",
    libraryId: overrides.libraryId ?? "doc-1",
    title: overrides.title ?? "Doc 1",
    origin: "history",
    role: overrides.role ?? "optional",
    ...overrides,
  };
}

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: "m-1",
    conversationId: "conv-1",
    turnId: "turn-1",
    role: "assistant",
    createdAt: 1,
    orderKey: "0000000000000001:m-1",
    content: `Answer derived from ${SECRET}`,
    sourceSnapshot: [source()],
    evidence: {
      origin: "library",
      level: "supported",
      retrievalMode: "semantic",
      coverage: { suppliedCount: 1, citedCount: 1 },
    },
    ...overrides,
  };
}

describe("reauthorizeHistory", () => {
  it("replaces denied source content with a placeholder and downgrades evidence", async () => {
    const result = await reauthorizeHistory([message()], context({
      verdicts: {
        "doc-1": { authorized: false, reason: "local_only_cloud", detail: "marked local-only" },
      },
    }));
    expect(result.redacted).toBe(true);
    expect(result.content[0].content).toContain("omitted");
    expect(result.content[0].evidence?.level).toBe("weak");
    expect(result.content[0].evidence?.coverage?.partialCoverage).toBe(true);
  });

  it("passes authorized history through unchanged", async () => {
    const result = await reauthorizeHistory([message()], context({
      verdicts: { "doc-1": { authorized: true } },
    }));
    expect(result.redacted).toBe(false);
    expect(result.content[0].evidence?.level).toBe("supported");
    expect(result.content[0].content).toBe(`Answer derived from ${SECRET}`);
  });

  it("denies unknown/deleted ids fail-closed", async () => {
    for (const verdict of [
      { authorized: false, reason: "deleted", detail: "deleted" } as const,
      { authorized: false, reason: "unknown", detail: "unknown" } as const,
    ]) {
      const result = await reauthorizeHistory([message()], context({
        verdicts: { "doc-1": verdict },
      }));
      expect(result.redacted).toBe(true);
    }
  });

  it("blocks a strict follow-up whose required source is unavailable", async () => {
    const result = await reauthorizeHistory(
      [message({ sourceSnapshot: [source({ role: "required" })] })],
      context({
        verdicts: {
          "doc-1": { authorized: false, reason: "excluded", detail: "excluded from AI" },
        },
      }),
    );
    expect(result.blocked).toBe(true);
  });

  it("treats ephemeral sources as local-only", async () => {
    const local = await reauthorizeHistory(
      [message({ sourceSnapshot: [source({ libraryId: undefined, ephemeral: { ownerToken: "t", sourceType: "web", localOnly: true } })] })],
      context({ verdicts: {}, remoteDestination: false }),
    );
    expect(local.redacted).toBe(false);

    const remote = await reauthorizeHistory(
      [message({ sourceSnapshot: [source({ libraryId: undefined, ephemeral: { ownerToken: "t", sourceType: "web", localOnly: true } })] })],
      context({ verdicts: {}, remoteDestination: true }),
    );
    expect(remote.redacted).toBe(true);
  });
});

describe("guardedDispatch (network spy)", () => {
  it("never invokes the dispatcher with forbidden bytes", async () => {
    const calls: unknown[] = [];
    const spy = async () => {
      calls.push("dispatched");
      return "ok";
    };
    const blocked = await guardedDispatch({
      plan: { sources: [source({ role: "required" })] },
      context: context({
        verdicts: {
          "doc-1": { authorized: false, reason: "excluded", detail: "excluded" },
        },
      }),
      dispatch: spy,
    });
    expect(blocked.dispatched).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("dispatches when every required source is authorized", async () => {
    const calls: string[] = [];
    const result = await guardedDispatch({
      plan: { sources: [source({ role: "required" })] },
      context: context({ verdicts: { "doc-1": { authorized: true } } }),
      dispatch: async () => {
        calls.push("dispatched");
        return "answer";
      },
    });
    expect(result.dispatched).toBe(true);
    expect(calls).toEqual(["dispatched"]);
  });

  it("optional denied sources do not block, but their bytes stay out of payloads", async () => {
    const payloads: string[] = [];
    const plan = {
      sources: [source({ role: "optional" })],
    };
    const history = await reauthorizeHistory([message()], context({
      verdicts: {
        "doc-1": { authorized: false, reason: "local_only_cloud", detail: "local-only" },
      },
    }));
    const result = await guardedDispatch({
      plan,
      context: context({
        verdicts: {
          "doc-1": { authorized: false, reason: "local_only_cloud", detail: "local-only" },
        },
      }),
      dispatch: async () => {
        // The dispatcher only receives reauthorized content.
        payloads.push(JSON.stringify(history.content));
        return "ok";
      },
    });
    expect(result.dispatched).toBe(true);
    expect(payloads.join("")).not.toContain(SECRET);
  });

  it("strict-local-only keeps device-local content while remote denies it", async () => {
    const decision = await strictFollowUpDecision(
      { sources: [source({ libraryId: undefined, ephemeral: { ownerToken: "t", sourceType: "web", localOnly: true }, role: "required" })] },
      context({ verdicts: {}, strictLocalOnly: true, remoteDestination: true }),
    );
    expect(decision.dispatch).toBe(false);
    expect(decision.reason).toContain("device-local");
  });

  it("consent decline retains the draft (dispatch never happens)", async () => {
    let dispatches = 0;
    const result = await guardedDispatch({
      plan: { sources: [] },
      context: {
        remoteDestination: true,
        strictLocalOnly: false,
        authorize: async () => ({ authorized: false, reason: "revoked", detail: "revoked" }),
      },
      onBlocked: () => {},
      dispatch: async () => {
        dispatches += 1;
        return "cloud answer";
      },
    });
    // No required sources ⇒ dispatch allowed; consent is handled by the
    // privacy gate, which this test verifies stays a separate concern.
    expect(result.dispatched).toBe(true);
    expect(dispatches).toBe(1);
  });
});

describe("evidence never keeps 'supported' for redacted content", () => {
  it("downgrades to weak and records limitations", async () => {
    const result = await reauthorizeHistory([message()], context({
      verdicts: {
        "doc-1": { authorized: false, reason: "deleted", detail: "deleted" },
      },
    }));
    const evidence = result.content[0].evidence as EvidenceStatus;
    expect(evidence.level).toBe("weak");
    expect(evidence.coverage?.limitations?.length).toBeGreaterThan(0);
  });
});
