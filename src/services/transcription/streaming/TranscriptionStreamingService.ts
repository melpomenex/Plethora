import { useSettingsStore } from "../../../stores/settingsStore";
import { buildRoutingContextFromSettings, resolveTranscriptionMode } from "../config";
import { normalizeError, TranscriptionError } from "../errors";
import { selectProvider } from "../TranscriptionRouter";
import type {
  ProviderHealthState,
  StreamingTranscriptionSession,
  TranscriptionInput,
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionProviderId,
} from "../types";
import { TranscriptionMode } from "../types";
import { createPseudoStreamingSession } from "./PseudoStreamingSession";

export class TranscriptionStreamingService {
  constructor(
    private readonly providers: Map<TranscriptionProviderId, TranscriptionProvider>,
    private readonly getHealthState: () => ProviderHealthState,
  ) {}

  async startStreaming(
    input: TranscriptionInput,
    options: TranscriptionOptions = {},
  ): Promise<StreamingTranscriptionSession> {
    const context = this.resolveRoutingContext(options);
    const mode = options.mode ?? TranscriptionMode.Realtime;

    const providerChain = await selectProvider(
      mode,
      { streaming: true, ...options.requiredCapabilities },
      context,
      this.providers,
      this.getHealthState(),
    );

    for (const providerId of providerChain) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;

      const capabilities = await provider.capabilities();
      if (capabilities.streaming && provider.startStreaming) {
        try {
          return await provider.startStreaming(input, { ...options, mode });
        } catch (error) {
          const normalized = normalizeError(error, providerId);
          if (normalized.code === "PROVIDER_UNAVAILABLE") {
            continue;
          }
          throw normalized;
        }
      }
    }

    const pseudoProvider = await this.resolvePseudoStreamingProvider(options, context);
    return createPseudoStreamingSession(pseudoProvider, options);
  }

  private async resolvePseudoStreamingProvider(
    options: TranscriptionOptions,
    context: ReturnType<typeof buildRoutingContextFromSettings>,
  ): Promise<TranscriptionProvider> {
    const pseudoChain = await selectProvider(
      options.mode ?? TranscriptionMode.Realtime,
      { pseudoStreaming: true, ...options.requiredCapabilities },
      context,
      this.providers,
      this.getHealthState(),
    );

    for (const providerId of pseudoChain) {
      const provider = this.providers.get(providerId);
      if (!provider) continue;
      const capabilities = await provider.capabilities();
      if (capabilities.pseudoStreaming || capabilities.fileTranscription) {
        return provider;
      }
    }

    throw new TranscriptionError(
      "No streaming or pseudo-streaming transcription providers are available.",
      "PROVIDER_UNAVAILABLE",
    );
  }

  private resolveRoutingContext(options: TranscriptionOptions) {
    const audio = useSettingsStore.getState().settings.audioTranscription;
    const mode = options.mode ?? resolveTranscriptionMode(audio);
    return buildRoutingContextFromSettings(audio, {
      mode,
      allowPremiumFallback: options.allowPremiumFallback,
      legacyGroqEnabled: Boolean(audio.groq?.apiKey),
      healthState: this.getHealthState(),
    });
  }
}
