import type { FeedbackEventId } from "./events";
import type { HapticEffect } from "./haptics/types";

const OUTCOMES = new Set<HapticEffect>(["success", "warning", "error", "completion", "celebration"]);

type AdmissionRejection = "duplicate" | "cooldown" | "rate-limited";

/** Pure, bounded policy state; callers supply their clock and readiness gates. */
export class HapticAdmission {
  private reservations = new Map<string, number>();
  private eventCooldowns = new Map<FeedbackEventId, number>();
  private submissions: number[] = [];
  private outcomes: number[] = [];
  private lastSubmission = -Infinity;

  admit(event: FeedbackEventId, identity: string, policy: { effect: HapticEffect; cooldownMs: number }, now: number): AdmissionRejection | undefined {
    for (const [key, at] of this.reservations) if (now - at > 30_000) this.reservations.delete(key);
    this.submissions = this.submissions.filter((at) => now - at < 1_000);
    this.outcomes = this.outcomes.filter((at) => now - at < 1_000);
    if (this.reservations.has(identity)) return "duplicate";
    const lastEvent = this.eventCooldowns.get(event);
    if (lastEvent !== undefined && now - lastEvent < policy.cooldownMs) return "cooldown";
    const outcome = OUTCOMES.has(policy.effect);
    if (this.submissions.length >= 8 || outcome && this.outcomes.length >= 4 || now - this.lastSubmission < (outcome ? 120 : 60)) return "rate-limited";
    if (this.reservations.size >= 256) this.reservations.delete(this.reservations.keys().next().value!);
    this.reservations.set(identity, now);
    this.eventCooldowns.set(event, now);
    this.submissions.push(now);
    if (outcome) this.outcomes.push(now);
    this.lastSubmission = now;
  }

  reset(): void {
    this.reservations.clear();
    this.eventCooldowns.clear();
    this.submissions.length = 0;
    this.outcomes.length = 0;
    this.lastSubmission = -Infinity;
  }
}
