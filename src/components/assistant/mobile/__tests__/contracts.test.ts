import { describe, expect, it } from "vitest";
import { FEEDBACK_EVENT_IDS, type FeedbackEventPayloads } from "../../../../lib/feedback/events";
import { FEEDBACK_POLICY_REGISTRY } from "../../../../lib/feedback/policy";
import { ANDROID_DICTATION_COMMANDS, DICTATION_LIMITS, type AppleComposerDictationStart, type DictationStart } from "../../../../lib/speech/contracts";
import { MOBILE_ASSISTANT_CONVERSATION_KEY } from "../contracts";

describe("mobile Assistant additive contracts", () => {
  it("reserves a separate mobile conversation identity", () => {
    expect(MOBILE_ASSISTANT_CONVERSATION_KEY).toBe("mobile:global");
  });
  it.each([
    ["assistant.invoke-armed", "threshold", 250, 10],
    ["assistant.opened", "activation", 250, 10],
    ["assistant.detent-settled", "selection", 120, 0],
  ] as const)("registers %s exclusively through interaction policy", (event, effect, cooldownMs, priority) => {
    const payload: FeedbackEventPayloads[typeof event] = {};
    expect(payload).toEqual({});
    expect(FEEDBACK_EVENT_IDS).toContain(event);
    expect(FEEDBACK_POLICY_REGISTRY[event]).toMatchObject({ kind: "interaction", haptic: true, hapticEffect: { effect, cooldownMs, priority }, toast: "never", sound: null, osNotification: "never" });
  });
  it("keeps new Android commands distinct from legacy file APIs", () => {
    expect(Object.values(ANDROID_DICTATION_COMMANDS)).toEqual(["dictation_status", "start_dictation", "stop_dictation", "cancel_dictation"].map(c => `plugin:plethora-android-speech|${c}`));
    const start: DictationStart = { sessionId: "opaque", locale: "en-US", requireOnDevice: true, networkConsent: false };
    const apple: AppleComposerDictationStart = { ...start, purpose: "composer-dictation" };
    expect(apple.purpose).toBe("composer-dictation");
    expect(DICTATION_LIMITS).toEqual({ initializationMs: 10_000, captureMs: 60_000, finalizationMs: 5_000 });
  });
});
