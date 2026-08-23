import { unavailableDescriptor } from "../capabilities/types";
import type { PlatformCapabilityDescriptor } from "../capabilities/types";
import type { IdentifyLanguageResult, LanguageIdProvider } from "../capabilities/language";
import { invokeAndroidPlugin, isAndroidAiPluginPlatform } from "./bridge";

const PLUGIN = "plethora-android-nlp";

export class AndroidLanguageIdProvider implements LanguageIdProvider {
  readonly id = "android-mlkit-language-id";

  async getCapability(): Promise<PlatformCapabilityDescriptor> {
    if (!isAndroidAiPluginPlatform()) {
      return unavailableDescriptor("language.identify", "platform_unsupported");
    }
    try {
      return await invokeAndroidPlugin<PlatformCapabilityDescriptor>(PLUGIN, "language_id_status");
    } catch {
      return unavailableDescriptor("language.identify", "platform_unsupported");
    }
  }

  async identifyLanguage(text: string): Promise<IdentifyLanguageResult> {
    const sample = text.slice(0, 400);
    if (!sample.trim()) return { language: "und", confidence: 0 };
    return invokeAndroidPlugin<IdentifyLanguageResult>(PLUGIN, "identify_language", {
      request: { text: sample },
    });
  }
}

export const DEFAULT_ENTITY_EXTRACTION_ENABLED = false;
