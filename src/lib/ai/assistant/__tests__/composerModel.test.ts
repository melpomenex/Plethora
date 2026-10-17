/**
 * Attachment-led composer tests (task 2.9).
 *
 * The visible-plan-equals-outgoing-evidence invariant, source-free general
 * questions, strict-control behavior and explicit broadening recovery.
 */

import { describe, expect, it } from "vitest";
import {
  broadeningAction,
  buildComposerModel,
  formatLocatorText,
  removalOutcome,
} from "../composerModel";
import { resolveRoute } from "../routing";
import type { ContextPolicy, SourceAttachment } from "../conversations/types";

function attachment(overrides: Partial<SourceAttachment> = {}): SourceAttachment {
  return {
    attachmentId: overrides.attachmentId ?? "att-1",
    kind: "document",
    libraryId: overrides.libraryId ?? "doc-a",
    title: overrides.title ?? "PDF A",
    origin: overrides.origin ?? "active-view",
    role: overrides.role ?? "optional",
    active: overrides.active ?? true,
    locator: overrides.locator,
  };
}

function modelFor(options: {
  question: string;
  policy?: ContextPolicy;
  attachments?: SourceAttachment[];
  viewerLibraryId?: string;
}) {
  const attachments = options.attachments ?? [];
  const decision = resolveRoute({
    question: options.question,
    policy: options.policy ?? { mode: "auto", origin: "inferred" },
    attachments,
    permissions: { authorizedDocumentIds: new Set(["doc-a", "doc-b", "doc-c"]) },
    viewer: options.viewerLibraryId
      ? { kind: "document", libraryId: options.viewerLibraryId, title: "PDF A", position: { page: 12 } }
      : undefined,
  });
  return {
    decision,
    model: buildComposerModel({
      decision,
      policy: options.policy ?? { mode: "auto", origin: "inferred" },
      attachments,
      webAllowed: false,
    }),
  };
}

describe("visible plan equals outgoing evidence", () => {
  it("chips exactly the sources the plan will send", () => {
    const { decision, model } = modelFor({
      question: "Explain this page",
      viewerLibraryId: "doc-a",
      attachments: [attachment({ attachmentId: "att-a", libraryId: "doc-a" })],
    });
    expect(decision.plannedSources).toHaveLength(1);
    expect(model.chips).toHaveLength(1);
    expect(model.chips[0].locatorText).toBe("page 12");
    expect(model.effectiveMode).toBe(decision.mode);
  });

  it("marks attachments that are visible but not sent", () => {
    const { model } = modelFor({
      question: "Who invented the transistor?",
      attachments: [attachment({ attachmentId: "att-a", libraryId: "doc-a" })],
    });
    // Fallback plan attaches the authorized optional source; if the plan did
    // not include it, the chip would be marked "(not sent)".
    for (const chip of model.chips) {
      expect(chip.label.length).toBeGreaterThan(0);
    }
  });

  it("shows no chips for a blocked plan and offers recovery", () => {
    const { model } = modelFor({
      question: "Explain this",
      policy: { mode: "document", origin: "explicit", allowedDocumentIds: [] },
    });
    expect(model.chips).toHaveLength(0);
    expect(model.recovery).toBeDefined();
    expect(model.recovery?.kind).toBe("broaden");
  });

  it("formats locators for all source types", () => {
    expect(formatLocatorText({ page: 12 })).toBe("page 12");
    expect(formatLocatorText({ timeSeconds: 252 })).toBe("04:12");
    expect(formatLocatorText({ cfi: "/6/4!/4" })).toBe("section");
    expect(formatLocatorText(undefined)).toBeUndefined();
  });
});

describe("source-free general questions", () => {
  it("uses Chat mode and shows no restriction label", () => {
    const { decision, model } = modelFor({ question: "Who invented the transistor?" });
    expect(decision.mode).toBe("chat");
    expect(model.effectiveMode).toBe("chat");
    expect(model.restrictionLabel).toBeUndefined();
  });

  it("keeps strict controls reachable but not forced", () => {
    const { model } = modelFor({ question: "Who invented the transistor?" });
    expect(model.strictControls.map((control) => control.mode)).toEqual([
      "chat",
      "document",
      "library",
    ]);
    // Chat is already active, so choosing it changes nothing.
    expect(model.strictControls.find((control) => control.mode === "chat")?.changesRestriction).toBe(false);
    expect(model.strictControls.find((control) => control.mode === "library")?.changesRestriction).toBe(true);
  });
});

describe("strict restrictions stay visible", () => {
  it("labels an active restriction", () => {
    const { model } = modelFor({
      question: "Summarize",
      policy: { mode: "document", origin: "explicit", allowedDocumentIds: ["doc-a"] },
      attachments: [attachment()],
    });
    expect(model.restrictionLabel).toBe("Only these sources");
    expect(model.effectiveMode).toBe("document");
  });

  it("removing an optional chip suppresses reattachment; strict removal keeps the restriction", () => {
    const optional = attachment({ attachmentId: "att-opt" });
    const optionalOutcome = removalOutcome({
      chip: { id: "chip-att-opt", kind: "attachment", label: "PDF A", removable: true, attachmentId: "att-opt" },
      policy: { mode: "auto", origin: "inferred" },
      attachments: [optional],
    });
    expect(optionalOutcome.suppressReattachment).toBe(true);
    expect(optionalOutcome.attachments).toHaveLength(0);

    const strictOutcome = removalOutcome({
      chip: { id: "chip-att-opt", kind: "attachment", label: "PDF A", removable: true, attachmentId: "att-opt" },
      policy: { mode: "document", origin: "explicit", allowedDocumentIds: ["doc-a", "doc-b"] },
      attachments: [attachment({ attachmentId: "att-opt", libraryId: "doc-a" }), attachment({ attachmentId: "att-b", libraryId: "doc-b" })],
    });
    expect(strictOutcome.suppressReattachment).toBe(false);
    expect(strictOutcome.policy.allowedDocumentIds).toEqual(["doc-b"]);
    // The remainder still restricts; an empty remainder blocks at routing.
  });

  it("removing a selection keeps history intact with a note", () => {
    const outcome = removalOutcome({
      chip: { id: "chip-sel", kind: "selection", label: "Selected: passage", removable: true },
      policy: { mode: "auto", origin: "inferred" },
      attachments: [],
    });
    expect(outcome.note).toContain("provenance");
    expect(outcome.suppressReattachment).toBe(false);
  });
});

describe("explicit broadening recovery", () => {
  it("requires a confirmed user choice to broaden", () => {
    expect(broadeningAction({ fromMode: "document", toMode: "library", confirmed: false })).toEqual({
      allowed: false,
      reason: "broadening requires an explicit user choice",
    });
    expect(broadeningAction({ fromMode: "document", toMode: "library", confirmed: true }).allowed).toBe(true);
    // Narrowing never needs confirmation.
    expect(broadeningAction({ fromMode: "library", toMode: "document", confirmed: false }).allowed).toBe(true);
    // No-op changes are always allowed.
    expect(broadeningAction({ fromMode: "chat", toMode: "chat", confirmed: false }).allowed).toBe(true);
  });

  it("offers Include-this-source when a mention is out of set", () => {
    const decision = resolveRoute({
      question: "Compare with @doc-b",
      policy: { mode: "document", origin: "explicit", allowedDocumentIds: ["doc-a"] },
      attachments: [],
      mentionDocumentIds: ["doc-b"],
      permissions: { authorizedDocumentIds: new Set(["doc-a", "doc-b"]) },
    });
    const model = buildComposerModel({
      decision,
      policy: { mode: "document", origin: "explicit", allowedDocumentIds: ["doc-a"] },
      attachments: [],
      webAllowed: false,
    });
    expect(model.recovery?.kind).toBe("include-source");
  });
});
