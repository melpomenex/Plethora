import type { Settings } from "../../stores/settingsStore";
import type { TTSProviderSettings, TTSSettings, TTSVoiceProfile } from "../../utils/ttsSettings";

export type TTSProviderId =
  | "fal"
  | "groq"
  | "pocket"
  | "system"
  | "openrouter"
  | "elevenlabs"
  | "openai"
  | "openai-compatible"
  | "android"
  | "plethora";

export type TTSProviderKind = "cloud" | "local";

export interface TTSBorrowSource {
  store: "llmProviders" | "audioTranscription";
  provider?: string;
}

export interface TTSAdapterAuth {
  mode: "none" | "apiKey" | "borrowed";
  borrowFrom?: TTSBorrowSource;
  docsUrl?: string;
}

export interface TTSAdapterCapabilities {
  supportsSpeed: boolean;
  supportsInstructions: boolean;
  supportsCloning: boolean;
  supportsCustomVoiceIds: boolean;
  audioFormats: readonly string[];
  maxInputChars: number;
}

export interface TTSModelPricing {
  prompt?: string | number;
  completion?: string | number;
}

export interface TTSModelInfo {
  id: string;
  name: string;
  description?: string;
  vendor?: string;
  supportedVoices: readonly string[] | null;
  supportedParameters: readonly string[];
  contextLength?: number;
  pricing?: TTSModelPricing;
  costPerMillionTokens?: number;
  costTier?: "low" | "medium" | "high";
}

export interface TTSVoiceInfo {
  id: string;
  name: string;
  provider: TTSProviderId;
  modelId: string;
  vendor?: string;
  language?: string;
  gender?: string;
  style?: string;
  metadata?: unknown;
}

export interface TTSAdapterContext {
  settings: Settings;
  tts: TTSSettings;
  config: TTSProviderSettings;
  apiKey?: string;
  borrowedFrom?: { id: string; name: string; provider: string };
  notice?: (message: string) => void;
}

export interface TTSSynthesizeRequest {
  text: string;
  model: string;
  voice?: string;
  responseFormat: string;
  speed?: number;
  instructions?: string;
  preset?: Record<string, unknown>;
  voiceProfile?: TTSVoiceProfile;
}

export interface TTSAudioResult {
  audioUrl: string;
  audioData?: ArrayBuffer;
  mimeType?: string;
  durationSec?: number;
  rawOutput: Record<string, unknown>;
}

export interface TTSProviderAdapter {
  id: TTSProviderId;
  label: string;
  kind: TTSProviderKind;
  auth: TTSAdapterAuth;
  capabilities: TTSAdapterCapabilities;
  /** Whether the adapter can provide a model picker rather than free text. */
  canEnumerateModels?: boolean;
  listModels(ctx: TTSAdapterContext): Promise<TTSModelInfo[]>;
  listVoices(ctx: TTSAdapterContext, modelId: string): Promise<TTSVoiceInfo[]>;
  synthesize(ctx: TTSAdapterContext, request: TTSSynthesizeRequest): Promise<TTSAudioResult>;
}
