import { bench } from "vitest";
import { seededRandom } from "../../test/bench-support";
import { HapticAdmission } from "./admission";
import type { FeedbackEventId } from "./events";

const random = seededRandom(0x68707463);
const events: FeedbackEventId[] = ["navigation.back-completed", "reader.annotation-saved", "review.grade-boundary-crossed"];
const inputs = Array.from({ length: 512 }, (_, index) => ({
  event: events[Math.floor(random() * events.length)]!,
  identity: `operation:${Math.floor(random() * 300)}`,
  now: index * 75,
}));
const admission = new HapticAdmission();
let sink = 0;
bench("haptic-policy-admission-512", () => {
  admission.reset();
  for (const input of inputs) {
    const reason = admission.admit(input.event, input.identity, { effect: "selection", cooldownMs: 80 }, input.now);
    sink ^= reason?.length ?? 1;
  }
});
