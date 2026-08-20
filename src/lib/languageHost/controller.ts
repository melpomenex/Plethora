import type {
  LanguageHostCapability,
  LanguageHostCapabilityName,
  LanguageHostResolutionInput,
  LanguageHostSnapshot,
} from "./types";
import {
  LANGUAGE_HOST_CAPABILITY_NAMES,
  sourceFingerprint,
} from "./types";

const DEFAULT_CAPABILITY: Omit<LanguageHostCapability, "name"> = {
  available: true,
  offline: true,
};

function defaultCapabilities(
  overrides: Partial<Record<LanguageHostCapabilityName, LanguageHostCapability>> | undefined,
): Readonly<Record<LanguageHostCapabilityName, LanguageHostCapability>> {
  return Object.fromEntries(
    LANGUAGE_HOST_CAPABILITY_NAMES.map((name) => [
      name,
      overrides?.[name] ?? { name, ...DEFAULT_CAPABILITY },
    ]),
  ) as Readonly<Record<LanguageHostCapabilityName, LanguageHostCapability>>;
}

function unavailableCapabilities(
  reason: LanguageHostCapability["reason"],
): Readonly<Record<LanguageHostCapabilityName, LanguageHostCapability>> {
  return defaultCapabilities(
    Object.fromEntries(
      LANGUAGE_HOST_CAPABILITY_NAMES.map((name) => [name, { name, available: false, offline: false, reason }]),
    ) as Partial<Record<LanguageHostCapabilityName, LanguageHostCapability>>,
  );
}

export class LanguageLearningHostController {
  private epoch = 0;
  private abortController: AbortController | null = null;
  private currentSourceFingerprint: string | null = null;

  get currentEpoch(): number {
    return this.epoch;
  }

  async resolve(input: LanguageHostResolutionInput): Promise<LanguageHostSnapshot> {
    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;
    const epoch = ++this.epoch;
    const fingerprint = sourceFingerprint(input.source);
    this.currentSourceFingerprint = fingerprint;
    const base = {
      hostId: input.hostId,
      surface: input.surface,
      source: input.source,
      profileContext: null,
      profile: null,
      epoch,
    } as const;

    if (!input.languageModeEnabled) {
      return { ...base, status: "disabled", capabilities: unavailableCapabilities("language-mode-off") };
    }
    if (!input.source.contentId) {
      return { ...base, status: "unavailable", capabilities: unavailableCapabilities("missing-source") };
    }

    try {
      const profileContext = await input.resolveProfile();
      if (abortController.signal.aborted || epoch !== this.epoch) {
        return { ...base, status: "cancelled", capabilities: unavailableCapabilities("stale-source") };
      }
      if (sourceFingerprint(input.source) !== this.currentSourceFingerprint) {
        return { ...base, status: "stale", capabilities: unavailableCapabilities("stale-source") };
      }
      if (!profileContext) {
        return { ...base, status: "unavailable", capabilities: unavailableCapabilities("no-profile") };
      }

      return {
        ...base,
        status: "ready",
        profileContext,
        profile: profileContext.profile,
        capabilities: defaultCapabilities(input.capabilities),
      };
    } catch (error) {
      if (abortController.signal.aborted || epoch !== this.epoch) {
        return { ...base, status: "cancelled", capabilities: unavailableCapabilities("stale-source") };
      }
      return {
        ...base,
        status: "failed",
        capabilities: unavailableCapabilities("provider-failed"),
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  isCurrent(snapshot: Pick<LanguageHostSnapshot, "epoch" | "source">): boolean {
    return snapshot.epoch === this.epoch && sourceFingerprint(snapshot.source) === this.currentSourceFingerprint;
  }

  invalidate(): void {
    this.epoch += 1;
    this.currentSourceFingerprint = null;
    this.abortController?.abort();
    this.abortController = null;
  }

  dispose(): void {
    this.invalidate();
  }
}

