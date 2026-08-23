import { unavailableDescriptor } from "../capabilities/types";
import type { PlatformCapabilityDescriptor } from "../capabilities/types";
import type { SemanticRetriever, SemanticRetrieveRequest } from "../capabilities/search";
import type { RetrievalResult } from "../../../api/ai-learning";
import { invokeAndroidPlugin, isAndroidAiPluginPlatform } from "./bridge";
import { useSettingsStore } from "../../../stores/settingsStore";

const PLUGIN = "plethora-android-search";

/** Feature flag default is off — SQLite / ai_learning remains source of truth. */
export function isAppSearchDerivedIndexEnabled(): boolean {
  return useSettingsStore.getState().settings.features.androidAppSearchIndex === true;
}

export class AndroidAppSearchRetriever implements SemanticRetriever {
  readonly id = "appsearch-hybrid" as const;

  async getCapability(): Promise<PlatformCapabilityDescriptor> {
    if (!isAndroidAiPluginPlatform() || !isAppSearchDerivedIndexEnabled()) {
      return unavailableDescriptor("search.semantic", "feature_unavailable");
    }
    try {
      return await invokeAndroidPlugin<PlatformCapabilityDescriptor>(PLUGIN, "search_status");
    } catch {
      return unavailableDescriptor("search.semantic", "platform_unsupported");
    }
  }

  async retrieve(_req: SemanticRetrieveRequest): Promise<RetrievalResult[]> {
    const cap = await this.getCapability();
    if (!cap.ready) return [];
    return invokeAndroidPlugin<RetrievalResult[]>(PLUGIN, "retrieve", {
      request: { ..._req, enabled: true },
    });
  }
}
