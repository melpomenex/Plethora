import type { LanguageProfile, ResolvedLanguageProfileContext } from "../../types/languageProfile";
import type { SourceAnchor } from "../../types/languageLexicon";

export type LanguageHostSurface = "reader" | "queue" | "transcript" | "video" | "tutor" | "practice";
export type LanguageHostStatus = "disabled" | "resolving" | "ready" | "unavailable" | "stale" | "failed" | "cancelled";
export type LanguageHostCapabilityName =
  | "analysis"
  | "annotations"
  | "peek"
  | "translation"
  | "readingAssist"
  | "sentenceMode"
  | "originalAudio"
  | "tutor"
  | "reading-assist"
  | "practice"
  | "mining"
  | "frameCapture";

export type LanguageHostActionName =
  | "open-peek"
  | "translate"
  | "sentence-mode"
  | "replay"
  | "reading-assist"
  | "mine"
  | "practice"
  | "tutor"
  | "memorize"
  | "set-state";

export type LanguageHostUnavailableReason =
  | "language-mode-off"
  | "no-profile"
  | "missing-source"
  | "unsupported-surface"
  | "unsupported-capability"
  | "stale-source"
  | "offline"
  | "privacy-blocked"
  | "provider-failed";

export interface LanguageHostCapability {
  name: LanguageHostCapabilityName;
  available: boolean;
  offline: boolean;
  reason?: LanguageHostUnavailableReason;
  detail?: string;
}

export type LanguageHostActionResult<T = void> =
  | { status: "available"; value: T }
  | { status: "pending"; requestId: string }
  | { status: "unavailable"; reason: LanguageHostUnavailableReason; detail?: string }
  | { status: "stale"; detail?: string }
  | { status: "failed"; error: Error };

export interface LanguageHostSource {
  source: SourceAnchor;
  contentType: "document" | "media";
  contentId: string;
  contentFingerprint?: string;
  text?: string;
}

export interface LanguageHostResolutionInput {
  hostId: string;
  surface: LanguageHostSurface;
  source: LanguageHostSource;
  languageModeEnabled: boolean;
  explicitProfileId?: string | null;
  resolveProfile: () => Promise<ResolvedLanguageProfileContext | null>;
  capabilities?: Partial<Record<LanguageHostCapabilityName, LanguageHostCapability>>;
}

export interface LanguageHostSnapshot {
  hostId: string;
  surface: LanguageHostSurface;
  status: LanguageHostStatus;
  source: LanguageHostSource;
  profileContext: ResolvedLanguageProfileContext | null;
  profile: LanguageProfile | null;
  capabilities: Readonly<Record<LanguageHostCapabilityName, LanguageHostCapability>>;
  epoch: number;
  error?: Error;
}

export const LANGUAGE_HOST_CAPABILITY_NAMES: readonly LanguageHostCapabilityName[] = [
  "analysis",
  "annotations",
  "peek",
  "translation",
  "readingAssist",
  "sentenceMode",
  "originalAudio",
  "tutor",
  "practice",
  "mining",
  "frameCapture",
];

export function sourceFingerprint(source: LanguageHostSource): string {
  return [
    source.contentType,
    source.contentId,
    source.contentFingerprint ?? source.source.contentFingerprint ?? "-",
    source.source.sourceId ?? "-",
    JSON.stringify(source.source.locator ?? null),
  ].join("\u001f");
}
