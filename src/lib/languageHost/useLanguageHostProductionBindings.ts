import { useCallback, useMemo } from "react";
import type { LanguageProfile } from "../../types/languageProfile";
import type { LanguageHostCapabilityName, LanguageHostCapability, LanguageHostSurface } from "./types";
import {
  createProductionLanguageHostBindings,
  resolveLanguageHostCapabilities,
} from "./capabilities";

export interface LanguageHostProductionBindings {
  resolveCapabilities: (profile: import("../../types/languageProfile").LanguageProfile) => Partial<Record<LanguageHostCapabilityName, LanguageHostCapability>>;
  shadowingProviders: ReturnType<typeof createProductionLanguageHostBindings>["shadowingProviders"];
  writingProvider: ReturnType<typeof createProductionLanguageHostBindings>["writingProvider"];
  pronunciationManifest: ReturnType<typeof createProductionLanguageHostBindings>["pronunciationManifest"];
  readingAssistRegistry: ReturnType<typeof createProductionLanguageHostBindings>["readingAssistRegistry"];
}

/** Production wiring for Language Mode host providers and truthful capabilities. */
export function useLanguageHostProductionBindings(surface: LanguageHostSurface): LanguageHostProductionBindings {
  const bindings = useMemo(() => createProductionLanguageHostBindings(), []);
  const resolveCapabilities = useCallback(
    (profile: LanguageProfile) => resolveLanguageHostCapabilities({ surface, profile }),
    [surface],
  );
  return { ...bindings, resolveCapabilities };
}
