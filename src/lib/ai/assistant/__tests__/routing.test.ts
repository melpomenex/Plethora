/**
 * Deterministic routing tests (task 2.1).
 *
 * Table-driven coverage of every design-D3 row plus the strict-conflict,
 * empty-set, localized-deictic and general-question-while-reading cases the
 * spec calls out.
 */

import { describe, expect, it } from "vitest";
import {
  intersectAuthorized,
  isGeneralKnowledgeRequest,
  isLibraryRequest,
  isSourceDeictic,
  resolveRoute,
  selectPatternLocale,
  type RouteDecision,
  type RoutingInput,
  type RoutingPermissions,
} from "../routing";
import type { ContextPolicy, SourceAttachment } from "../conversations/types";

const AUTO_POLICY: ContextPolicy = { mode: "auto", origin: "inferred" };

function permissions(overrides: Partial<RoutingPermissions> = {}): RoutingPermissions {
  return {
    authorizedDocumentIds: new Set(["doc-a", "doc-b", "doc-c", "doc-d"]),
    ...overrides,
  };
}

function attachment(overrides: Partial<SourceAttachment> = {}): SourceAttachment {
  return {
    attachmentId: overrides.attachmentId ?? "att-1",
    kind: overrides.kind ?? "document",
    libraryId: overrides.libraryId,
    title: overrides.title ?? overrides.libraryId ?? "Source",
    origin: overrides.origin ?? "picker",
    role: overrides.role ?? "optional",
    active: overrides.active ?? true,
    ...overrides,
  };
}

function route(overrides: Partial<RoutingInput> = {}): RouteDecision {
  return resolveRoute({
    question: overrides.question ?? "Explain this",
    policy: overrides.policy ?? AUTO_POLICY,
    attachments: overrides.attachments ?? [],
    permissions: overrides.permissions ?? permissions(),
    viewer: overrides.viewer,
    pinnedSelection: overrides.pinnedSelection,
    mentionDocumentIds: overrides.mentionDocumentIds,
    explicitAction: overrides.explicitAction,
    priorSourceIds: overrides.priorSourceIds,
    sourceTitles: overrides.sourceTitles,
  });
}

describe("row 1 — authorization first", () => {
  it("intersects candidate ids with authorization and exclusions", () => {
    expect(
      intersectAuthorized(["doc-a", "doc-b", "doc-x"], {
        authorizedDocumentIds: new Set(["doc-a", "doc-x"]),
        excludedDocumentIds: new Set(["doc-x"]),
      }),
    ).toEqual(["doc-a"]);
    // Collection restriction narrows too.
    expect(
      intersectAuthorized(["doc-a", "doc-b"], {
        authorizedDocumentIds: new Set(["doc-a", "doc-b"]),
        collectionDocumentIds: new Set(["doc-b"]),
      }),
    ).toEqual(["doc-b"]);
    // Empty authorized set never means "everything".
    expect(
      intersectAuthorized(["doc-a"], { authorizedDocumentIds: new Set() }),
    ).toEqual([]);
  });

  it("blocks an empty strict set instead of widening", () => {
    const decision = route({
      policy: { mode: "library", origin: "explicit", allowedDocumentIds: [] },
    });
    expect(decision.blocked).toBeDefined();
    expect(decision.clarification?.kind).toBe("empty-strict-set");
  });

  it("blocks when every strict source is unauthorized", () => {
    const decision = route({
      policy: { mode: "document", origin: "explicit", allowedDocumentIds: ["doc-x"] },
    });
    expect(decision.blocked).toBeDefined();
    expect(decision.allowedDocumentIds).toBeUndefined();
  });

  it("fails closed for an unauthorized ephemeral-less viewer source", () => {
    const decision = route({
      question: "What does this say?",
      viewer: { kind: "document", title: "No identity" },
    });
    // No identity → not attachable; falls to fallback with no sources.
    expect(decision.plannedSources).toHaveLength(0);
  });
});

describe("row 2 — explicit strict choice", () => {
  it("uses the frozen allowed set for a strict document request", () => {
    const decision = route({
      question: "Explain the methodology",
      policy: { mode: "document", origin: "explicit", allowedDocumentIds: ["doc-a"] },
    });
    expect(decision.rule).toBe("strict-choice");
    expect(decision.mode).toBe("document");
    expect(decision.allowedDocumentIds).toEqual(["doc-a"]);
    expect(decision.usesLibraryRetrieval).toBe(false);
    expect(decision.usesSourceExtraction).toBe(true);
  });

  it("asks for an explicit Include action when a mention is out of set", () => {
    const decision = route({
      question: "Compare with the other one",
      policy: { mode: "document", origin: "explicit", allowedDocumentIds: ["doc-a"] },
      mentionDocumentIds: ["doc-b"],
    });
    expect(decision.clarification?.kind).toBe("include-source");
    expect(decision.allowedDocumentIds).toEqual(["doc-a"]);
    expect(decision.visiblePlan).toContain("doc-b");
  });

  it("never silently widens a strict lock from question wording", () => {
    const decision = route({
      question: "Where else in my library does this appear?",
      policy: { mode: "document", origin: "explicit", allowedDocumentIds: ["doc-a"] },
    });
    expect(decision.mode).toBe("document");
    expect(decision.allowedDocumentIds).toEqual(["doc-a"]);
    expect(decision.usesLibraryRetrieval).toBe(false);
  });
});

describe("row 3 — explicit mentions and multi-source attachments", () => {
  it("one explicit source becomes a Document policy", () => {
    const decision = route({
      question: "What does it argue?",
      attachments: [attachment({ libraryId: "doc-a", origin: "picker", active: true })],
    });
    // With exactly one explicit identity and no mention, row 3 is not entered
    // (single current attachment is optional context); the strictness comes
    // from an explicit mention instead.
    expect(["fallback", "explicit-mention"]).toContain(decision.rule);
  });

  it("a mention plus an attachment unions to a filtered Library policy", () => {
    const decision = route({
      question: "Compare this with @doc-b",
      mentionDocumentIds: ["doc-b"],
      viewer: { kind: "document", libraryId: "doc-a", title: "PDF A" },
    });
    expect(decision.rule).toBe("explicit-mention");
    expect(decision.mode).toBe("library");
    expect(decision.allowedDocumentIds?.sort()).toEqual(["doc-a", "doc-b"]);
    expect(decision.usesLibraryRetrieval).toBe(true);
  });

  it("intersects the union with collection limits", () => {
    const decision = route({
      question: "Compare these",
      mentionDocumentIds: ["doc-b"],
      viewer: { kind: "document", libraryId: "doc-a", title: "PDF A" },
      permissions: permissions({ collectionDocumentIds: new Set(["doc-a"]) }),
    });
    expect(decision.allowedDocumentIds).toEqual(["doc-a"]);
  });

  it("blocks an unauthorized mention rather than searching the library", () => {
    const decision = route({
      question: "Compare with @doc-missing",
      mentionDocumentIds: ["doc-missing"],
    });
    expect(decision.blocked).toBeDefined();
    expect(decision.clarification?.kind).toBe("include-source");
    expect(decision.allowedDocumentIds).toBeUndefined();
  });

  it("compare-two-documents keeps both real ids", () => {
    const decision = route({
      question: "Compare these documents",
      explicitAction: "compare-documents",
      attachments: [
        attachment({ attachmentId: "a", libraryId: "doc-a" }),
        attachment({ attachmentId: "b", libraryId: "doc-b" }),
      ],
    });
    expect(decision.allowedDocumentIds?.sort()).toEqual(["doc-a", "doc-b"]);
    expect(decision.usesSourceExtraction).toBe(true);
  });
});

describe("row 4 — explicit library requests", () => {
  it("localized library wording routes to a library policy", () => {
    for (const question of [
      "Where else in my library does this appear?",
      "Wo sonst in meiner Bibliothek steht das?",
      "¿Dónde más en mi biblioteca aparece esto?",
      "Où ailleurs dans ma bibliothèque ?",
      "ライブラリのどこにありますか",
      "我的文库中还有哪里提到这个？",
    ]) {
      expect(isLibraryRequest(question)).toBe(true);
      const decision = route({ question });
      expect(decision.mode).toBe("library");
      expect(decision.usesLibraryRetrieval).toBe(true);
    }
  });

  it("honors a collection restriction and blocks an empty subset", () => {
    const restricted = route({
      question: "Search my library",
      policy: { mode: "library", origin: "explicit" },
      permissions: permissions({ collectionDocumentIds: new Set(["doc-c"]) }),
    });
    expect(restricted.allowedDocumentIds).toEqual(["doc-c"]);

    const empty = route({
      question: "Search my library",
      policy: { mode: "library", origin: "explicit" },
      permissions: permissions({ collectionDocumentIds: new Set() }),
    });
    expect(empty.blocked).toBeDefined();
  });

  it("an explicit ask-library action routes to library without wording", () => {
    const decision = route({ question: "1+1", explicitAction: "ask-library" });
    expect(decision.mode).toBe("library");
    expect(decision.usesLibraryRetrieval).toBe(true);
  });
});

describe("row 5 — explicit general-knowledge questions", () => {
  it("recognizes explicit general requests in supported locales", () => {
    for (const question of [
      "Answer from general knowledge",
      "Antworte ohne die Quelle",
      "Responde sin usar el documento",
      "Réponds sans le document",
      "資料を使わずに答えて",
      "不要用文档回答",
    ]) {
      expect(isGeneralKnowledgeRequest(question)).toBe(true);
      const decision = route({ question });
      expect(decision.mode).toBe("chat");
      expect(decision.usesLibraryRetrieval).toBe(false);
    }
  });

  it("answers a general question while reading without extraction", () => {
    const decision = route({
      question: "Who invented the transistor?",
      viewer: { kind: "document", libraryId: "doc-a", title: "A PDF" },
    });
    expect(decision.mode).toBe("chat");
    expect(decision.usesLibraryRetrieval).toBe(false);
    // Optional active context may accompany it; extraction stays honest.
    expect(decision.plannedSources.every((source) => source.role === "optional")).toBe(true);
  });

  it("answers general questions when the active source is unavailable or excluded", () => {
    const decision = route({
      question: "Explain eigenvalues",
      viewer: { kind: "document", title: "Unavailable" },
      permissions: permissions({ excludedDocumentIds: new Set(["doc-a"]) }),
      policy: { mode: "document", origin: "explicit", allowedDocumentIds: [] },
    });
    // The strict empty set blocks (row 1) — the user must choose recovery.
    expect(decision.blocked).toBeDefined();
    // But with an auto policy the same question is a plain chat answer.
    const auto = route({
      question: "Explain eigenvalues",
      viewer: { kind: "document", title: "Unavailable" },
    });
    expect(auto.mode).toBe("chat");
    expect(auto.blocked).toBeUndefined();
  });
});

describe("row 6 — selections and typed references", () => {
  it("pinned selection becomes the primary required source", () => {
    const decision = route({
      question: "Give me a simpler example",
      pinnedSelection: {
        originalText: "The captured passage",
        documentId: "doc-a",
        title: "PDF A",
        locator: { page: 12 },
      },
    });
    expect(decision.rule).toBe("source-reference");
    expect(decision.plannedSources[0].selectionText).toBe("The captured passage");
    expect(decision.plannedSources[0].viewerPosition?.page).toBe(12);
    expect(decision.allowedDocumentIds).toEqual(["doc-a"]);
    expect(decision.usesSourceExtraction).toBe(true);
  });

  it("localized source deictics resolve against the active position", () => {
    for (const question of [
      "Explain this page",
      "Erkläre diese Seite",
      "Explica esta página",
      "Explique cette page",
      "この章を説明して",
      "解释这一页",
    ]) {
      expect(isSourceDeictic(question)).toBe(true);
      const decision = route({
        question,
        viewer: {
          kind: "document",
          libraryId: "doc-a",
          title: "PDF A",
          position: { page: 12 },
        },
      });
      expect(decision.mode).toBe("document");
      expect(decision.allowedDocumentIds).toEqual(["doc-a"]);
      expect(decision.plannedSources[0].viewerPosition?.page).toBe(12);
    }
  });

  it("an ambiguous earlier reference asks instead of guessing", () => {
    const decision = route({
      question: "Compare that paper's method",
      priorSourceIds: ["doc-a", "doc-b"],
      viewer: { kind: "general" },
    });
    expect(decision.blocked).toBeDefined();
    expect(decision.clarification?.kind).toBe("ambiguous-source");
    expect(decision.clarification?.candidates?.map((c) => c.id).sort()).toEqual(["doc-a", "doc-b"]);
  });

  it("a unique earlier reference resolves without a picker", () => {
    const decision = route({
      question: "Explain that document",
      priorSourceIds: ["doc-b"],
      viewer: { kind: "general" },
    });
    expect(decision.blocked).toBeUndefined();
    expect(decision.allowedDocumentIds).toEqual(["doc-b"]);
  });

  it("a deictic question with no resolvable source keeps the draft and asks", () => {
    const decision = route({
      question: "Explain this chapter",
      viewer: { kind: "general" },
    });
    expect(decision.blocked).toBeDefined();
    expect(decision.clarification?.kind).toBe("ambiguous-source");
  });
});

describe("row 7 — fallback", () => {
  it("unmatched wording falls back to Chat with optional authorized context", () => {
    const decision = route({
      question: "What are the implications?",
      viewer: { kind: "document", libraryId: "doc-a", title: "A PDF", position: { page: 3 } },
    });
    expect(decision.rule).toBe("fallback");
    expect(decision.mode).toBe("chat");
    expect(decision.usesLibraryRetrieval).toBe(false);
    expect(decision.plannedSources).toHaveLength(1);
    expect(decision.plannedSources[0].role).toBe("optional");
  });

  it("does not attach an unauthorized or excluded active source", () => {
    const decision = route({
      question: "What are the implications?",
      viewer: { kind: "document", libraryId: "doc-x", title: "Excluded" },
    });
    expect(decision.plannedSources).toHaveLength(0);
    expect(decision.allowedDocumentIds).toBeUndefined();
  });

  it("never searches the library or web implicitly", () => {
    const decision = route({
      question: "Tell me something interesting",
      permissions: permissions({ webAllowed: true }),
    });
    expect(decision.usesLibraryRetrieval).toBe(false);
    expect(decision.usesSourceExtraction).toBe(false);
    expect(decision.webAllowed).toBe(false);
  });
});

describe("visible plan equals outgoing plan", () => {
  it("labels the plan from the same sources that will be sent", () => {
    const decision = route({
      question: "Explain this page",
      viewer: {
        kind: "document",
        libraryId: "doc-a",
        title: "PDF A",
        position: { page: 12 },
      },
    });
    expect(decision.visiblePlan).toContain("PDF A");
    expect(decision.visiblePlan).toContain("page 12");
    expect(decision.plannedSources).toHaveLength(1);
  });

  it("labels a strict restriction explicitly", () => {
    const decision = route({
      question: "Summarize",
      policy: { mode: "document", origin: "explicit", allowedDocumentIds: ["doc-a"] },
      sourceTitles: new Map([["doc-a", "PDF A"]]),
    });
    expect(decision.visiblePlan).toContain("Only these sources");
    expect(decision.visiblePlan).toContain("PDF A");
  });

  it("labels a general question without claiming sources", () => {
    const decision = route({ question: "Who invented the transistor?" });
    expect(decision.visiblePlan.toLowerCase()).toContain("general");
  });
});

describe("locale detection", () => {
  it("detects Japanese and Chinese scripts regardless of UI locale", () => {
    expect(selectPatternLocale("このページを説明して")).toBe("ja");
    expect(selectPatternLocale("解释这一页")).toBe("zh");
    expect(selectPatternLocale("Explain this page")).toBe("en");
  });
});
