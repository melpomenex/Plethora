/**
 * Attachment-led composer model (design D3/D7, task 2.9).
 *
 * Turns a routing decision plus the conversation's attachments into the
 * visible composer state: removable attachment chips, the effective
 * restriction, secondary strict-source controls and broadening recovery.
 *
 * The single invariant: **the visible plan equals the outgoing evidence.**
 * This module derives the chips from the same `RouteDecision` that will be
 * frozen into the turn plan, so what the reader sees is what is sent.
 *
 * Gated by `assistantContextAttachments`; the legacy mode selector remains
 * until the flag flips.
 */

import type {
  ContextPolicy,
  ContextPolicyMode,
  SourceAttachment,
} from "./conversations/types";
import type { RouteDecision } from "./routing";
import { isStrictPolicy } from "./conversations/types";

export type ComposerChipKind = "attachment" | "restriction" | "selection" | "collection";

/** Locator shape accepted as a chip fallback (the planned viewer position). */
export type ComposerChipFallbackLocator = {
  page?: number;
  cfi?: string;
  sectionId?: string;
  timeSeconds?: number;
  anchor?: string;
};

export interface ComposerChip {
  id: string;
  kind: ComposerChipKind;
  label: string;
  /** Removable chips reveal the underlying policy when removed. */
  removable: boolean;
  /** For attachments: the attachment identity. */
  attachmentId?: string;
  /** Locator text already formatted for display ("page 12", "04:12"). */
  locatorText?: string;
}

export interface StrictControlOption {
  mode: ContextPolicyMode;
  label: string;
  /** True when choosing it changes the effective restriction. */
  changesRestriction: boolean;
}

export interface ComposerModel {
  chips: ComposerChip[];
  /** The mode the plan will actually use (not necessarily the switch value). */
  effectiveMode: ContextPolicyMode;
  /** "Only these sources" is shown for strict modes. */
  restrictionLabel?: string;
  strictControls: StrictControlOption[];
  /** A visible recovery when a request was blocked by an empty set. */
  recovery?: { kind: "broaden" | "include-source"; label: string; detail: string };
  /** Web is a deliberate, visible choice, never implicit. */
  webToggle?: { enabled: boolean; visible: boolean };
}

export function formatLocatorText(locator?: {
  page?: number;
  cfi?: string;
  sectionId?: string;
  timeSeconds?: number;
  anchor?: string;
}): string | undefined {
  if (!locator) return undefined;
  if (locator.page !== undefined) return `page ${locator.page}`;
  if (locator.sectionId) return locator.sectionId;
  if (locator.cfi) return "section";
  if (locator.timeSeconds !== undefined) {
    const total = Math.floor(locator.timeSeconds);
    return `${Math.floor(total / 60).toString().padStart(2, "0")}:${(total % 60)
      .toString()
      .padStart(2, "0")}`;
  }
  if (locator.anchor) return locator.anchor;
  return undefined;
}

function chipForAttachment(
  attachment: SourceAttachment,
  locatorFallback?: ComposerChipFallbackLocator,
): ComposerChip {
  const locatorText = formatLocatorText(attachment.locator ?? locatorFallback);
  const label = [attachment.title, locatorText].filter(Boolean).join(" · ");
  return {
    id: `chip-${attachment.attachmentId}`,
    kind: attachment.origin === "selection" ? "selection" : "attachment",
    label: attachment.origin === "selection" ? `Selected: ${attachment.title}` : label,
    removable: true,
    attachmentId: attachment.attachmentId,
    locatorText,
  };
}

export interface ComposerModelInput {
  decision: RouteDecision;
  policy: ContextPolicy;
  attachments: SourceAttachment[];
  /** Current web permission from the conversation policy. */
  webAllowed: boolean;
  /** True when the user has pinned a selection for this thread. */
  hasPinnedSelection?: boolean;
}

/**
 * Build the visible composer model. Chips come from the decision's planned
 * sources so a source that is *not* sent can never show as attached; a blocked
 * plan shows no chips and offers recovery instead.
 */
export function buildComposerModel(input: ComposerModelInput): ComposerModel {
  const { decision, policy, attachments, webAllowed } = input;
  const chips: ComposerChip[] = [];

  if (!decision.blocked) {
    // Chip each planned source by its attachment identity when available.
    for (const planned of decision.plannedSources) {
      const attachment = attachments.find(
        (candidate) =>
          (planned.attachmentId && candidate.attachmentId === planned.attachmentId) ||
          (planned.libraryId && candidate.libraryId === planned.libraryId),
      );
      if (attachment) {
        chips.push(chipForAttachment(attachment, planned.viewerPosition));
      } else {
        const locatorText = formatLocatorText(planned.viewerPosition);
        chips.push({
          id: `chip-${planned.attachmentId ?? planned.libraryId ?? planned.title ?? "source"}`,
          kind: planned.selectionText ? "selection" : "attachment",
          label: planned.selectionText
            ? `Selected: ${planned.title ?? "passage"}`
            : [planned.title, locatorText].filter(Boolean).join(" · ") || "Current source",
          removable: true,
          attachmentId: planned.attachmentId,
          locatorText,
        });
      }
    }
    // Active attachments that are not in the plan stay visible but marked
    // inactive: hidden context is worse than an honest extra chip.
    for (const attachment of attachments) {
      if (!attachment.active || attachment.removedAt) continue;
      if (chips.some((chip) => chip.attachmentId === attachment.attachmentId)) continue;
      chips.push({ ...chipForAttachment(attachment), label: `${chipForAttachment(attachment).label} (not sent)` });
    }
  }

  const strict = isStrictPolicy(policy) && policy.mode !== "auto";
  // Compare against the *effective* plan mode: with an auto policy the
  // effective mode is Chat, so "Chat" is not a change.
  const strictControls: StrictControlOption[] = [
    {
      mode: "chat",
      label: "Chat",
      changesRestriction: decision.mode !== "chat",
    },
    {
      mode: "document",
      label: "Document",
      changesRestriction: decision.mode !== "document",
    },
    {
      mode: "library",
      label: "Library",
      changesRestriction: decision.mode !== "library",
    },
  ];

  const model: ComposerModel = {
    chips,
    effectiveMode: decision.mode,
    restrictionLabel: strict && decision.mode !== "auto" ? "Only these sources" : undefined,
    strictControls,
    webToggle: {
      enabled: decision.webAllowed,
      visible: true,
    },
  };

  if (decision.blocked && decision.clarification) {
    model.recovery =
      decision.clarification.kind === "include-source"
        ? {
            kind: "include-source",
            label: "Include this source",
            detail: decision.clarification.message,
          }
        : {
            kind: "broaden",
            // Explicit broadening is a user choice; it is never automatic.
            label: decision.clarification.kind === "ambiguous-source" ? "Choose a source" : "Broaden the search",
            detail: decision.clarification.message,
          };
  }

  void webAllowed;
  return model;
}

/**
 * Apply a chip removal. Removing optional context suppresses reattachment of
 * that source revision (the caller records it in the removed registry);
 * removing a strict attachment reveals the underlying policy — it never
 * silently widens a strict restriction.
 */
export function removalOutcome(options: {
  chip: ComposerChip;
  policy: ContextPolicy;
  attachments: SourceAttachment[];
}): {
  policy: ContextPolicy;
  attachments: SourceAttachment[];
  suppressReattachment: boolean;
  note?: string;
} {
  const remaining = options.attachments.filter(
    (attachment) => attachment.attachmentId !== options.chip.attachmentId,
  );
  const strict = isStrictPolicy(options.policy) && options.policy.mode !== "auto";
  if (options.chip.kind === "selection") {
    return {
      policy: options.policy,
      attachments: remaining,
      suppressReattachment: false,
      note: "The selection is no longer attached; earlier answers keep their provenance.",
    };
  }
  return {
    policy: strict
      ? {
          ...options.policy,
          // Recomputing the allowed set from what remains; an empty remainder
          // must block at routing time, not widen.
          allowedDocumentIds: remaining
            .map((attachment) => attachment.libraryId)
            .filter((id): id is string => Boolean(id)),
        }
      : options.policy,
    attachments: remaining,
    suppressReattachment: !strict,
    note: strict
      ? "The restriction still applies to the remaining sources."
      : "This source will not be re-attached automatically.",
  };
}

/** True when a user action explicitly broadens retrieval. */
export function broadeningAction(options: {
  fromMode: ContextPolicyMode;
  toMode: ContextPolicyMode;
  confirmed: boolean;
}): { allowed: boolean; reason?: string } {
  const broadens =
    options.fromMode !== options.toMode &&
    (options.toMode === "library" || (options.toMode === "chat" && options.fromMode !== "chat"));
  if (broadens && !options.confirmed) {
    return { allowed: false, reason: "broadening requires an explicit user choice" };
  }
  return { allowed: true };
}
