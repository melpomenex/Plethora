import { isLocalNemotronInstalled } from "../../api/transcription";
import { useSettingsStore } from "../../stores/settingsStore";
import { buildRoutingContextFromSettings, resolveTranscriptionMode } from "./config";
import { canRunLocalNemotron } from "./DeviceCapabilityService";
import { normalizeError, TranscriptionError } from "./errors";
import { estimateCost } from "./pricing";
import { GroqTranscriptionProvider } from "./providers/GroqTranscriptionProvider";
import { LocalNemotronProvider } from "./providers/LocalNemotronProvider";
import { LocalTranscriptionProvider } from "./providers/LocalTranscriptionProvider";
import { createOpenRouterProviders } from "./providers/openrouter";
import { adaptOpenRouterProvider } from "./providers/OpenRouterTranscriptionProviderAdapter";
import { DeepgramProvider } from "./providers/DeepgramProvider";
import { GeminiLiveProvider } from "./providers/GeminiLiveProvider";
import { GeminiTranscribeProvider } from "./providers/GeminiTranscribeProvider";
import { buildFallbackChain, executeWithFallback, selectProvider } from "./TranscriptionRouter";
import type {
  ProviderHealthState,
  TranscriptionInput,
  TranscriptionMode,
  TranscriptionOptions,
  TranscriptionProvider,
  TranscriptionProviderId,
  TranscriptionResult,
  TranscriptionRoutingContext,
} from "./types";
import { TranscriptionStreamingService } from "./streaming/TranscriptionStreamingService";
import { recordUsage } from "./usage";
import type { StreamingTranscriptionSession } from "./types";

export class TranscriptionService {
  private readonly providers = new Map<TranscriptionProviderId, TranscriptionProvider>();
  private healthState: ProviderHealthState = {};
  private readonly streamingService: TranscriptionStreamingService;

  constructor() {
    this.streamingService = new TranscriptionStreamingService(
      this.providers,
      () => this.healthState,
    );
    this.registerDefaults();
  }

  registerProvider(provider: TranscriptionProvider): void {
    this.providers.set(provider.id as TranscriptionProviderId, provider);
  }

  unregisterProvider(providerId: TranscriptionProviderId): void {
    this.providers.delete(providerId);
  }

  getProvider(providerId: TranscriptionProviderId): TranscriptionProvider | undefined {
    return this.providers.get(providerId);
  }

  listProviders(): TranscriptionProvider[] {
    return [...this.providers.values()];
  }

  buildProviderChain(context: TranscriptionRoutingContext): TranscriptionProviderId[] {
    return buildFallbackChain(context);
  }

  async startStreaming(
    input: TranscriptionInput,
    options: TranscriptionOptions = {},
  ): Promise<StreamingTranscriptionSession> {
    return this.streamingService.startStreaming(input, options);
  }

  async transcribe(
    input: TranscriptionInput,
    options: TranscriptionOptions = {},
  ): Promise<TranscriptionResult> {
    const context = await this.resolveRoutingContext(options);
    const mode = options.mode ?? context.mode;

    const providerChain = await selectProvider(
      mode,
      options.requiredCapabilities,
      context,
      this.providers,
      this.healthState,
    );

    if (providerChain.length === 0) {
      throw new TranscriptionError(
        "No transcription providers match the requested mode and capabilities.",
        "PROVIDER_UNAVAILABLE",
      );
    }

    try {
      const { result, providerId } = await executeWithFallback(
        providerChain,
        { ...context, mode },
        async (selectedProviderId) => {
          const provider = this.providers.get(selectedProviderId);
          if (!provider) {
            throw new TranscriptionError(
              `Provider ${selectedProviderId} is not registered.`,
              "PROVIDER_UNAVAILABLE",
              { providerId: selectedProviderId },
            );
          }
          return provider.transcribe(input, { ...options, mode });
        },
      );

      this.markProviderSuccess(providerId);

      const durationSeconds = result.durationSeconds ?? input.durationSeconds ?? 0;
      recordUsage({
        providerId,
        durationSeconds,
        estimatedCostUsd: estimateCost(durationSeconds, providerId),
        timestamp: new Date().toISOString(),
        documentId: input.documentId,
        model: result.model,
      });

      return result;
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.providerId) {
        this.markProviderFailure(normalized.providerId as TranscriptionProviderId);
      }
      throw normalized;
    }
  }

  private async resolveRoutingContext(options: TranscriptionOptions): Promise<TranscriptionRoutingContext> {
    const audio = useSettingsStore.getState().settings.audioTranscription;
    const mode = options.mode ?? resolveTranscriptionMode(audio);
    const nemotronInstalled = canRunLocalNemotron() && await isLocalNemotronInstalled();
    return buildRoutingContextFromSettings(audio, {
      mode,
      allowPremiumFallback: options.allowPremiumFallback,
      legacyGroqEnabled: Boolean(audio.groq?.apiKey),
      healthState: this.healthState,
      localNemotronInstalled: nemotronInstalled,
    });
  }

  private registerDefaults(): void {
    for (const openRouter of createOpenRouterProviders()) {
      this.registerProvider(adaptOpenRouterProvider(openRouter));
    }
    this.registerProvider(new GroqTranscriptionProvider());
    this.registerProvider(new LocalNemotronProvider());
    this.registerProvider(new LocalTranscriptionProvider());
    this.registerProvider(new GeminiTranscribeProvider());
    this.registerProvider(new GeminiLiveProvider());
    this.registerProvider(new DeepgramProvider());
  }

  private markProviderSuccess(providerId: TranscriptionProviderId): void {
    this.healthState[providerId] = {
      healthy: true,
      failureCount: 0,
      lastSuccessAt: Date.now(),
    };
  }

  private markProviderFailure(providerId: TranscriptionProviderId): void {
    const previous = this.healthState[providerId];
    this.healthState[providerId] = {
      healthy: false,
      failureCount: (previous?.failureCount ?? 0) + 1,
      lastFailureAt: Date.now(),
      lastSuccessAt: previous?.lastSuccessAt,
    };
  }
}

let defaultService: TranscriptionService | undefined;

export function getTranscriptionService(): TranscriptionService {
  if (!defaultService) {
    defaultService = new TranscriptionService();
  }
  return defaultService;
}
