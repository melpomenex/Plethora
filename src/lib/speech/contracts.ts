/** New composer wire contract; legacy file/lecture commands keep their defaults. */
export type DictationProcessing = "on-device" | "system-service" | "unknown";
export type DictationPermission = "granted" | "denied" | "prompt" | "unknown";
export interface DictationCapability {
  platform: "android" | "ios" | "web" | "unsupported";
  available: boolean;
  locale: string;
  processing: DictationProcessing;
  microphonePermission: DictationPermission;
  speechPermission?: DictationPermission;
  reason?: string;
}
export interface DictationStart {
  sessionId: string;
  locale: string;
  requireOnDevice: boolean;
  networkConsent: boolean;
}
export interface AppleComposerDictationStart extends DictationStart {
  purpose: "composer-dictation";
}
export interface DictationResult { text: string }
export type DictationErrorCode = "denied" | "unavailable" | "busy" | "no-speech" | "timeout" | "interrupted" | "cancelled";
export interface DictationAdapter {
  status(locale: string): Promise<DictationCapability>;
  start(options: DictationStart): Promise<void>;
  stop(sessionId: string): Promise<DictationResult>;
  cancel(sessionId: string): Promise<void>;
}
export const DICTATION_LIMITS = { initializationMs: 10_000, captureMs: 60_000, finalizationMs: 5_000 } as const;
export const ANDROID_DICTATION_COMMANDS = {
  status: "plugin:plethora-android-speech|dictation_status",
  start: "plugin:plethora-android-speech|start_dictation",
  stop: "plugin:plethora-android-speech|stop_dictation",
  cancel: "plugin:plethora-android-speech|cancel_dictation",
} as const;
