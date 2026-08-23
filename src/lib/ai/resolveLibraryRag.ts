import { useSettingsStore } from "../../stores/settingsStore";
import { resolveAiPath } from "./provider";
import {
  DEFAULT_LIBRARY_RAG,
  type RagComposition,
} from "./ragComposition";
import { RAG_NAMESPACE_LIBRARY } from "./capabilities/search";
import { isAppSearchDerivedIndexEnabled } from "./android/appSearchRetriever";

/**
 * Ask Library pairing. AppSearch is an optional derived index behind a
 * default-off flag; generator "none" is retrieval-only (no silent cloud).
 */
export async function resolveLibraryRagComposition(): Promise<RagComposition> {
  const path = await resolveAiPath("prompt");
  const generatorKind =
    path === "ondevice" ? "ondevice" : path === "cloud" ? "cloud" : "none";
  return {
    retrieverId: isAppSearchDerivedIndexEnabled() ? "appsearch-hybrid" : DEFAULT_LIBRARY_RAG.retrieverId,
    generatorKind,
    namespace: RAG_NAMESPACE_LIBRARY,
  };
}

export function resolveLibraryRagCompositionSync(
  generatorKind: RagComposition["generatorKind"] = "ondevice"
): RagComposition {
  const features = useSettingsStore.getState().settings.features;
  return {
    retrieverId: features.androidAppSearchIndex === true ? "appsearch-hybrid" : "ai_learning",
    generatorKind,
    namespace: RAG_NAMESPACE_LIBRARY,
  };
}
