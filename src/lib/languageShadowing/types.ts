import type { PracticeAttempt, PracticeSource, RecordingPolicy } from "../languagePractice";

export type ShadowingFlow = "listen-first" | "immediate" | "continuous";
export type ShadowingSttRoute = "local" | "cloud";
export interface ShadowingSession { id: string; profileId: string; flow: ShadowingFlow; source: PracticeSource; promptText: string; recordingPolicy: RecordingPolicy; attemptIds: readonly string[]; active: boolean; }
export interface ShadowingCapture { status: "idle" | "requesting" | "recording" | "processing" | "cancelled" | "failed"; microphoneAvailable: boolean; error?: string; }
export interface ShadowingRecognitionInput { attemptId: string; profileId: string; languageTag: string; sourceFingerprint?: string; audio: Blob; privacy?: "local-only" | "allow-cloud"; }
export interface ShadowingRecognitionProvider { id: string; version: string; route: ShadowingSttRoute; supports: (languageTag: string) => boolean; recognize: (input: ShadowingRecognitionInput, signal?: AbortSignal) => Promise<{ text: string; confidence?: number }>; }
export interface ShadowingRecognitionResult { status: "ready" | "unavailable" | "failed" | "stale"; text?: string; confidence?: number; uncertain: boolean; providerId?: string; providerVersion?: string; reason?: string; }
export type ShadowingAttempt = PracticeAttempt & { mode: "shadowing" };
