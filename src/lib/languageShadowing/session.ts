import type { ShadowingCapture, ShadowingFlow, ShadowingSession } from "./types";
import type { PracticeSource, RecordingPolicy } from "../languagePractice";

export function createShadowingSession(input: { id: string; profileId: string; flow: ShadowingFlow; source: PracticeSource; promptText: string; recordingPolicy: RecordingPolicy }): ShadowingSession {
  return { ...input, attemptIds: [], active: true };
}
export function cancelShadowingCapture(capture: ShadowingCapture): ShadowingCapture { return { ...capture, status: "cancelled" }; }
export function canStartCapture(policy: RecordingPolicy, microphoneAvailable: boolean): boolean { return policy.allowMicrophone && microphoneAvailable; }
