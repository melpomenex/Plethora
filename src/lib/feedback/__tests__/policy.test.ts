/**
 * Contract tests for the feedback policy registry (scaffolding for the
 * unify-notifications-and-sound change). These pin the design invariants from
 * openspec/changes/unify-notifications-and-sound/design.md §2–§3 so the
 * implementation model cannot drift the data while building the orchestrator.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FEEDBACK_SOUND_FILES } from "../../../utils/soundService";
import { FEEDBACK_EVENT_IDS } from "../events";
import {
  FEEDBACK_POLICY_REGISTRY,
  SOUND_ROLE_GATE,
  SOUND_ROLE_TO_FEEDBACK_TYPE,
  type SoundRole,
} from "../policy";

const ALL_ROLES: SoundRole[] = [
  "acknowledge",
  "confirm",
  "complete",
  "celebrate",
  "attention",
  "warning",
  "error",
];

describe("feedback policy registry", () => {
  it("covers every declared event id exactly", () => {
    const registryKeys = Object.keys(FEEDBACK_POLICY_REGISTRY).sort();
    const eventIds = [...FEEDBACK_EVENT_IDS].sort();
    expect(registryKeys).toEqual(eventIds);
  });

  it("keeps the sound palette within the 4–7 role budget", () => {
    expect(ALL_ROLES.length).toBeGreaterThanOrEqual(4);
    expect(ALL_ROLES.length).toBeLessThanOrEqual(7);
  });

  it("maps every non-attention role to a sound asset that exists on disk", () => {
    for (const [role, feedbackType] of Object.entries(SOUND_ROLE_TO_FEEDBACK_TYPE)) {
      const soundUrl = FEEDBACK_SOUND_FILES[feedbackType];
      expect(soundUrl, `role "${role}" must map to a FeedbackType with a file`).toBeTruthy();
      const assetPath = join(process.cwd(), "public", soundUrl);
      expect(existsSync(assetPath), `missing bundled asset ${assetPath} for role "${role}"`).toBe(
        true
      );
    }
  });

  it("gates every role by exactly one of the two existing sound settings", () => {
    for (const role of ALL_ROLES) {
      expect(["feedback", "notification"]).toContain(SOUND_ROLE_GATE[role]);
    }
  });

  it("never uses sound as the sole channel", () => {
    for (const [eventId, policy] of Object.entries(FEEDBACK_POLICY_REGISTRY)) {
      if (policy.sound === null) continue;
      // A sound-bearing event must have a visual channel: a toast, an OS
      // notification, or (for the never/never cases) existing inline UI — the
      // inline cases are exactly the review/timer surfaces documented in the
      // design, so pin them by name to force a doc update if the list grows.
      const hasToast = policy.toast !== "never";
      const hasOs = policy.osNotification !== "never";
      const documentedInlineSurfaces = [
        "review.card-graded",
        "review.session-completed",
        "review.streak-milestone",
        "focus.phase-completed",
      ];
      expect(
        hasToast || hasOs || documentedInlineSurfaces.includes(eventId),
        `event "${eventId}" plays a sound but has no documented visual channel`
      ).toBe(true);
    }
  });

  it("keeps passive events out of every interruption channel", () => {
    for (const [eventId, policy] of Object.entries(FEEDBACK_POLICY_REGISTRY)) {
      if (policy.importance !== "passive") continue;
      expect(policy.toast, `passive event "${eventId}" must not toast`).toBe("never");
      expect(policy.osNotification, `passive event "${eventId}" must not notify`).toBe("never");
    }
  });

  it("never time-gates critical events behind quiet hours", () => {
    for (const [eventId, policy] of Object.entries(FEEDBACK_POLICY_REGISTRY)) {
      if (policy.importance !== "critical") continue;
      expect(policy.quietHours, `critical event "${eventId}" must ignore quiet hours`).toBe(false);
    }
  });

  it("requires visibility rules and tags to be consistent with OS delivery", () => {
    for (const [eventId, policy] of Object.entries(FEEDBACK_POLICY_REGISTRY)) {
      if (policy.osNotification === "never") {
        expect(policy.osVisibility, `event "${eventId}"`).toBe("never");
      } else {
        expect(policy.osVisibility, `event "${eventId}"`).not.toBe("never");
        expect(policy.osTag, `OS-capable event "${eventId}" needs a dedupe tag`).toBeTruthy();
      }
    }
  });

  it("uses non-negative cooldowns", () => {
    for (const [eventId, policy] of Object.entries(FEEDBACK_POLICY_REGISTRY)) {
      expect(policy.cooldownMs, `event "${eventId}"`).toBeGreaterThanOrEqual(0);
    }
  });

  it("only the review reminder is suppressed during an active review session", () => {
    const suppressed = Object.entries(FEEDBACK_POLICY_REGISTRY)
      .filter(([, policy]) => policy.suppressDuringReview)
      .map(([eventId]) => eventId);
    expect(suppressed).toEqual(["reminder.reviews-due"]);
  });
});
