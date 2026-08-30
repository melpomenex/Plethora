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
      const invocation = invokeCommand<{ translatedText: string }>(
        "plugin:plethora-apple-intelligence|apple_translate_sentence",
        {
          request: {
            text: request.text,
            sourceLanguage: request.sourceLanguage,
            targetLanguage: request.targetLanguage,
          },
        },
      );
      if (!options?.signal) {
        return { translatedText: (await invocation).translatedText };
      }
      const signal = options.signal;
      // The native bridge has no cancellation channel; surface aborts
      // promptly to the caller instead of leaving the promise pending.
      const result = await Promise.race([
        invocation,
        new Promise<never>((_, reject) => {
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          if (signal.aborted) {
            abort();
          } else {
            signal.addEventListener("abort", abort, { once: true });
          }
        }),
      ]);
      return { translatedText: result.translatedText };
    },
  };
}
