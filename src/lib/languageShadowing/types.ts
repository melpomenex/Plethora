import type { PracticeAttempt, PracticeSource, RecordingPolicy } from "../languagePractice";

export type ShadowingFlow = "listen-first" | "immediate" | "continuous";
export interface ShadowingSession { id: string; profileId: string; flow: ShadowingFlow; source: PracticeSource; promptText: string; recordingPolicy: RecordingPolicy; attemptIds: readonly string[]; active: boolean; }
export interface ShadowingCapture { status: "idle" | "requesting" | "recording" | "processing" | "cancelled" | "failed"; microphoneAvailable: boolean; error?: string; }
export type ShadowingAttempt = PracticeAttempt & { mode: "shadowing" };
