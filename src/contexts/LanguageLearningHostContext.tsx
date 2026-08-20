import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useLanguageProfileStore } from "../stores/languageProfileStore";
import { LanguageLearningHostController } from "../lib/languageHost";
import { LANGUAGE_HOST_CAPABILITY_NAMES } from "../lib/languageHost";
import type {
  LanguageHostCapability,
  LanguageHostCapabilityName,
  LanguageHostResolutionInput,
  LanguageHostSnapshot,
  LanguageHostSource,
  LanguageHostSurface,
} from "../lib/languageHost";

export interface LanguageLearningHostProviderProps {
  hostId: string;
  surface: LanguageHostSurface;
  source: LanguageHostSource;
  languageModeEnabled: boolean;
  explicitProfileId?: string | null;
  capabilities?: Partial<Record<LanguageHostCapabilityName, LanguageHostCapability>>;
  children: ReactNode;
}

export interface LanguageLearningHostContextValue {
  snapshot: LanguageHostSnapshot;
  refresh: () => void;
  controller: LanguageLearningHostController;
}

const LanguageLearningHostContext = createContext<LanguageLearningHostContextValue | null>(null);

function initialSnapshot(props: LanguageLearningHostProviderProps): LanguageHostSnapshot {
  return {
    hostId: props.hostId,
    surface: props.surface,
    status: "resolving",
    source: props.source,
    profileContext: null,
    profile: null,
    capabilities: Object.fromEntries(
      LANGUAGE_HOST_CAPABILITY_NAMES.map((name) => [name, { name, available: false, offline: false, reason: "missing-source" as const }]),
    ) as LanguageHostSnapshot["capabilities"],
    epoch: 0,
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

  const refresh = useCallback(() => setRefreshToken((value) => value + 1), []);

  useEffect(() => {
    let mounted = true;
    const input: LanguageHostResolutionInput = {
      hostId: props.hostId,
      surface: props.surface,
      source: props.source,
      languageModeEnabled: props.languageModeEnabled,
      explicitProfileId: props.explicitProfileId,
      capabilities: props.capabilities,
      resolveProfile: () => resolveProfileContext(
        props.source.contentType,
        props.source.contentId,
        props.explicitProfileId,
      ),
    };
    setSnapshot(initialSnapshot(props));
    void controller.resolve(input).then((next) => {
      if (mounted) setSnapshot(next);
    });
    return () => {
      mounted = false;
      controller.invalidate();
    };
  }, [
    controller,
    resolveProfileContext,
    props.capabilities,
    props.explicitProfileId,
    props.hostId,
    props.languageModeEnabled,
    props.source,
    props.surface,
    refreshToken,
  ]);

  return (
    <LanguageLearningHostContext.Provider value={{ snapshot, refresh, controller }}>
      {props.children}
    </LanguageLearningHostContext.Provider>
  );
}

export function useLanguageLearningHost(): LanguageLearningHostContextValue {
  const context = useContext(LanguageLearningHostContext);
  if (!context) throw new Error("useLanguageLearningHost must be used within LanguageLearningHostProvider");
  return context;
}
