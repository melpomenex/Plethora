import { isAppleOsPlatform } from "../ai/apple/capabilities";
import { invokeCommand, isTauri } from "../tauri";
import type { TranslationProvider } from "./provider";

function isAppleTranslationAvailable(): boolean {
  return isTauri() && isAppleOsPlatform();
}

/** On-device Apple Translation (iOS 17.4+ / macOS 15+) when the native plugin is available. */
export function createAppleTranslationProvider(): TranslationProvider {
  return {
    id: "apple-translation",
    kind: "local",
    version: "1.0.0",
    capabilities: {
      sentenceTranslation: true,
      supportedLanguagePairs: ["*"],
      offlineAvailable: true,
      sendsTextOffDevice: false,
      requiresCredentials: false,
      configured: isAppleTranslationAvailable(),
      supportsCancellation: true,
      privacyDisclosure: "On-device Apple Translation. Text stays on this device.",
    },
    translate: async (request, options) => {
      if (!isAppleTranslationAvailable()) {
        throw new Error("platform_unsupported");
      }
      const result = await invokeCommand<{ translatedText: string }>(
        "plugin:plethora-apple-intelligence|apple_translate_sentence",
        {
          request: {
            text: request.text,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
          },
        },
        { signal: options?.signal },
      );
      return { translatedText: result.translatedText };
    },
  };
}
