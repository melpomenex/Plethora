import type { TranslationProvider } from "./provider";
import { invokeCommand, isNativeMobile, isTauri, nativePlatform } from "../tauri";

function isAndroid(): boolean {
  if (!isTauri() || !isNativeMobile()) return false;
  const platform = nativePlatform();
  return platform === null ? true : platform === "android";
}

/**
 * ML Kit Translate as a `kind: "local"` adapter in the existing registry.
 * Desktop / missing plugin → unconfigured (selector skips it).
 */
export function createMlKitTranslationProvider(): TranslationProvider {
  return {
    id: "android-mlkit-translate",
    kind: "local",
    version: "1.0.0-alpha",
    capabilities: {
      sentenceTranslation: true,
      supportedLanguagePairs: ["*"],
      offlineAvailable: true,
      sendsTextOffDevice: false,
      requiresCredentials: false,
      configured: isAndroid(),
      supportsCancellation: true,
      privacyDisclosure: "On-device ML Kit Translate. Text stays on this device.",
    },
    translate: async (request) => {
      if (!isAndroid()) {
        throw new Error("platform_unsupported");
      }
      const result = await invokeCommand<{ translatedText: string }>(
        "plugin:plethora-android-nlp|translate_sentence",
        {
          request: {
            text: request.text,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
          },
        }
      );
      return { translatedText: result.translatedText };
    },
  };
}
