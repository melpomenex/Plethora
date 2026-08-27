import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLanguageProfileStore } from "../stores/languageProfileStore";
import { LanguageLearningHostController } from "../lib/languageHost";
import { LANGUAGE_HOST_CAPABILITY_NAMES, sourceFingerprint } from "../lib/languageHost";
import type {
  LanguageHostCapability,
  LanguageHostCapabilityName,
  LanguageHostResolutionInput,
  LanguageHostSnapshot,
  LanguageHostSource,
  LanguageHostSurface,
} from "../lib/languageHost";
import type { ShadowingRecognitionProvider } from "../lib/languageShadowing";
import type { WritingProvider } from "../lib/languageWriting";
import type { PronunciationProviderManifest } from "../lib/languagePronunciation";
import type { ReadingAssistRegistry } from "../lib/languageReadingAssist";

export interface LanguageLearningHostProviderProps {
  hostId: string;
  surface: LanguageHostSurface;
  source: LanguageHostSource;
  languageModeEnabled: boolean;
  explicitProfileId?: string | null;
  capabilities?: Partial<Record<LanguageHostCapabilityName, LanguageHostCapability>>;
  shadowingProviders?: readonly ShadowingRecognitionProvider[];
  writingProvider?: WritingProvider;
  pronunciationManifest?: PronunciationProviderManifest;
  readingAssistRegistry?: ReadingAssistRegistry;
  resolveCapabilities?: (input: { surface: LanguageHostSurface; profile: NonNullable<LanguageHostSnapshot["profile"]> }) => Partial<Record<LanguageHostCapabilityName, LanguageHostCapability>>;
  children: ReactNode;
}

export interface LanguageLearningHostContextValue {
  snapshot: LanguageHostSnapshot;
  refresh: () => void;
  controller: LanguageLearningHostController;
  shadowingProviders: readonly ShadowingRecognitionProvider[];
  writingProvider?: WritingProvider;
  pronunciationManifest?: PronunciationProviderManifest;
  readingAssistRegistry?: ReadingAssistRegistry;
}

const LanguageLearningHostContext = createContext<LanguageLearningHostContextValue | null>(null);

function initialSnapshot(props: LanguageLearningHostProviderProps): LanguageHostSnapshot {
  return {
    hostId: props.hostId,
    surface: props.surface,
    status: props.languageModeEnabled ? "resolving" : "disabled",
    source: props.source,
    profileContext: null,
    profile: null,
    capabilities: Object.fromEntries(
      LANGUAGE_HOST_CAPABILITY_NAMES.map((name) => [name, { name, available: false, offline: false, reason: "missing-source" as const }]),
    ) as LanguageHostSnapshot["capabilities"],
    epoch: 0,
  };
}

function mergeResolvedSnapshot(
  next: LanguageHostSnapshot,
  resolveCapabilities: LanguageLearningHostProviderProps["resolveCapabilities"],
  surface: LanguageHostSurface,
): LanguageHostSnapshot {
  if (next.status !== "ready" || !next.profile || !resolveCapabilities) return next;
  return {
    ...next,
    capabilities: {
      ...next.capabilities,
      ...Object.fromEntries(
        Object.entries(resolveCapabilities({ surface, profile: next.profile })).map(([name, capability]) => [name, capability]),
      ),
    } as LanguageHostSnapshot["capabilities"],
  };
}

/**
 * Resolves language state at a host boundary. The provider owns cancellation
 * and stale-result handling so reader/video/tutor/practice children can remain
 * presentational and cannot accidentally leak work into another source.
 */
export function LanguageLearningHostProvider(props: LanguageLearningHostProviderProps) {
  const resolveProfileContext = useLanguageProfileStore((state) => state.resolveContext);
  const controllerRef = useRef<LanguageLearningHostController | null>(null);
  if (!controllerRef.current) controllerRef.current = new LanguageLearningHostController();
  const controller = controllerRef.current;
  const [snapshot, setSnapshot] = useState(() => initialSnapshot(props));
  const [refreshToken, setRefreshToken] = useState(0);
  const sourceRef = useRef(props.source);
  sourceRef.current = props.source;
  const resolveCapabilitiesRef = useRef(props.resolveCapabilities);
  resolveCapabilitiesRef.current = props.resolveCapabilities;
  const resolveProfileContextRef = useRef(resolveProfileContext);
  resolveProfileContextRef.current = resolveProfileContext;
  const resolvedSourceFingerprint = sourceFingerprint(props.source);

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  useEffect(() => {
    let mounted = true;
    const currentSource = sourceRef.current;
    const input: LanguageHostResolutionInput = {
      hostId: props.hostId,
      surface: props.surface,
      source: currentSource,
      languageModeEnabled: props.languageModeEnabled,
      explicitProfileId: props.explicitProfileId,
      capabilities: props.capabilities,
      resolveProfile: () => resolveProfileContextRef.current(
        currentSource.contentType,
        currentSource.contentId,
        props.explicitProfileId,
      ),
    };
    setSnapshot(initialSnapshot(props));
    void controller.resolve(input).then((next) => {
      if (!mounted) return;
      setSnapshot(mergeResolvedSnapshot(next, resolveCapabilitiesRef.current, props.surface));
    }).catch((error) => {
      if (!mounted) return;
      setSnapshot({
        ...initialSnapshot(props),
        status: "failed",
        error: error instanceof Error ? error : new Error(String(error)),
      });
    });
    return () => {
      mounted = false;
      controller.invalidate();
    };
  }, [
    controller,
    props.capabilities,
    props.explicitProfileId,
    props.hostId,
    props.languageModeEnabled,
    props.surface,
    refreshToken,
    resolvedSourceFingerprint,
  ]);

  const contextValue = useMemo<LanguageLearningHostContextValue>(() => ({
    snapshot,
    refresh,
    controller,
    shadowingProviders: props.shadowingProviders ?? [],
    writingProvider: props.writingProvider,
    pronunciationManifest: props.pronunciationManifest,
    readingAssistRegistry: props.readingAssistRegistry,
  }), [
    controller,
    props.pronunciationManifest,
    props.readingAssistRegistry,
    props.shadowingProviders,
    props.writingProvider,
    refresh,
    snapshot,
  ]);

  return (
    <LanguageLearningHostContext.Provider value={contextValue}>
      {props.children}
    </LanguageLearningHostContext.Provider>
  );
}

export function useLanguageLearningHost(): LanguageLearningHostContextValue {
  const context = useContext(LanguageLearningHostContext);
  if (!context) throw new Error("useLanguageLearningHost must be used within LanguageLearningHostProvider");
  return context;
}

/** Optional boundary for reusable media/readers that may be mounted without Language Mode. */
export function useOptionalLanguageLearningHost(): LanguageLearningHostContextValue | null {
  return useContext(LanguageLearningHostContext);
}
