export type FoundryRuntimeStatus =
  | "available"
  | "runtime_unavailable"
  | "model_unavailable"
  | "model_downloadable";

export interface FoundryStatusSnapshot {
  status: FoundryRuntimeStatus;
  reason?: string;
  loadedModels?: string[];
  cachedModels?: string[];
  configuredModel?: string;
  checkedAt: number;
}

export interface FoundryChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface FoundryChatCompletionRequest {
  model: string;
  messages: FoundryChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface FoundryChatCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export interface FoundryTokenCountResponse {
  tokenCount: number;
}

export interface FoundryOpenAiStatus {
  Endpoints?: string[];
  ModelDirPath?: string;
  PipeName?: string;
}

/** Settings-panel snapshot for Foundry Local health. */
export interface FoundryLocalStatus {
  runtimeHealthy: boolean;
  modelLoaded: boolean;
  availableModels: string[];
  model?: string;
}

export interface FoundryConnectionTestResult {
  ok: boolean;
  state?: FoundryRuntimeStatus;
  model?: string;
}
