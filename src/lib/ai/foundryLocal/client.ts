import { foundryErrorFromUnknown } from "./errors";
import type {
  FoundryChatCompletionRequest,
  FoundryChatCompletionResponse,
  FoundryConnectionTestResult,
  FoundryLocalStatus,
  FoundryOpenAiStatus,
  FoundryStatusSnapshot,
  FoundryTokenCountResponse,
} from "./types";

const DEFAULT_TIMEOUT_MS = 8_000;
const TTL_MS = 10_000;

let cachedStatus: FoundryStatusSnapshot | null = null;
let cachedStatusKey = "";
let cachedStatusAt = 0;

export function normalizeFoundryBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

export function resetFoundryStatusCache(): void {
  cachedStatus = null;
  cachedStatusKey = "";
  cachedStatusAt = 0;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

/** Foundry must stay on loopback so prompts are not sent to arbitrary hosts. */
export function assertLoopbackFoundryUrl(baseUrl: string): void {
  const root = normalizeFoundryBaseUrl(baseUrl);
  let parsed: URL;
  try {
    parsed = new URL(root);
  } catch {
    throw foundryErrorFromUnknown(
      { code: "runtime_unavailable", message: "Invalid Foundry base URL" },
      { providerId: "ondevice-foundry-local" }
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw foundryErrorFromUnknown(
      { code: "runtime_unavailable", message: "Foundry base URL must use http or https" },
      { providerId: "ondevice-foundry-local" }
    );
  }
  const host = parsed.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    throw foundryErrorFromUnknown(
      {
        code: "runtime_unavailable",
        message: "Foundry base URL must be loopback (127.0.0.1, localhost, or ::1)",
      },
      { providerId: "ondevice-foundry-local" }
    );
  }
}

function linkedAbortSignal(outer?: AbortSignal, timeoutMs?: number): AbortSignal {
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  if (outer?.aborted) {
    controller.abort();
    return controller.signal;
  }
  outer?.addEventListener("abort", onOuterAbort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs !== undefined && timeoutMs > 0) {
    timer = setTimeout(() => controller.abort(), timeoutMs);
  }
  controller.signal.addEventListener(
    "abort",
    () => {
      outer?.removeEventListener("abort", onOuterAbort);
      if (timer !== undefined) clearTimeout(timer);
    },
    { once: true }
  );
  return controller.signal;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const signal = linkedAbortSignal(init.signal, timeoutMs);
  return await fetch(url, { ...init, signal });
}

async function readJsonArray(response: Response): Promise<string[]> {
  if (!response.ok) return [];
  const body = (await response.json()) as unknown;
  return Array.isArray(body) ? body.filter((item) => typeof item === "string") : [];
}

function resolveModel(
  configuredModel: string,
  loadedModels: string[],
  cachedModels: string[]
): { model?: string; status: FoundryStatusSnapshot["status"]; reason?: string } {
  const trimmed = configuredModel.trim();
  if (trimmed) {
    if (loadedModels.includes(trimmed)) return { model: trimmed, status: "available" };
    if (cachedModels.includes(trimmed)) {
      return { model: trimmed, status: "model_unavailable", reason: "model_not_loaded" };
    }
    return { model: trimmed, status: "model_downloadable", reason: "model_not_cached" };
  }
  if (loadedModels.length === 1) return { model: loadedModels[0], status: "available" };
  if (loadedModels.length > 1) {
    return { model: loadedModels[0], status: "available", reason: "multiple_models_loaded" };
  }
  if (cachedModels.length === 1) {
    return { model: cachedModels[0], status: "model_unavailable", reason: "model_not_loaded" };
  }
  if (cachedModels.length > 0) {
    return { model: cachedModels[0], status: "model_downloadable", reason: "model_not_cached" };
  }
  return { status: "model_downloadable", reason: "no_models_cached" };
}

export async function getFoundryStatus(
  baseUrl: string,
  configuredModel = ""
): Promise<FoundryStatusSnapshot> {
  const root = normalizeFoundryBaseUrl(baseUrl);
  assertLoopbackFoundryUrl(root);
  const cacheKey = `${root}|${configuredModel.trim()}`;
  const now = Date.now();
  if (cachedStatus && cachedStatusKey === cacheKey && now - cachedStatusAt < TTL_MS) {
    return cachedStatus;
  }

  try {
    const statusRes = await fetchWithTimeout(`${root}/openai/status`);
    if (!statusRes.ok) {
      const snap: FoundryStatusSnapshot = {
        status: "runtime_unavailable",
        reason: "connection_failed",
        checkedAt: now,
      };
      cachedStatus = snap;
      cachedStatusKey = cacheKey;
      cachedStatusAt = now;
      return snap;
    }

    const statusBody = (await statusRes.json()) as FoundryOpenAiStatus;
    const loadedRes = await fetchWithTimeout(`${root}/openai/loadedmodels`);
    const cachedRes = await fetchWithTimeout(`${root}/openai/models`);
    const loadedModels = await readJsonArray(loadedRes);
    const cachedModels = await readJsonArray(cachedRes);
    const resolved = resolveModel(configuredModel, loadedModels, cachedModels);

    const snap: FoundryStatusSnapshot = {
      status: resolved.status,
      reason: resolved.reason,
      loadedModels,
      cachedModels,
      configuredModel: resolved.model ?? (configuredModel.trim() || undefined),
      checkedAt: now,
    };

    if (statusBody.Endpoints?.length === 0) {
      snap.status = "runtime_unavailable";
      snap.reason = "no_endpoints";
    }

    cachedStatus = snap;
    cachedStatusKey = cacheKey;
    cachedStatusAt = now;
    return snap;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      const snap: FoundryStatusSnapshot = {
        status: "runtime_unavailable",
        reason: "timeout",
        checkedAt: now,
      };
      cachedStatus = snap;
      cachedStatusKey = cacheKey;
      cachedStatusAt = now;
      return snap;
    }
    const snap: FoundryStatusSnapshot = {
      status: "runtime_unavailable",
      reason: "connection_failed",
      checkedAt: now,
    };
    cachedStatus = snap;
    cachedStatusKey = cacheKey;
    cachedStatusAt = now;
    return snap;
  }
}

export function toFoundryLocalStatus(snap: FoundryStatusSnapshot): FoundryLocalStatus {
  const loaded = snap.loadedModels ?? [];
  const cached = snap.cachedModels ?? [];
  const model = snap.configuredModel;
  const modelLoaded = snap.status === "available" && !!model && loaded.includes(model);
  return {
    runtimeHealthy: snap.status !== "runtime_unavailable",
    modelLoaded,
    availableModels: loaded.length > 0 ? loaded : cached,
    model,
  };
}

export async function getFoundryLocalStatus(
  baseUrl: string,
  configuredModel = ""
): Promise<FoundryLocalStatus> {
  return toFoundryLocalStatus(await getFoundryStatus(baseUrl, configuredModel));
}

export async function testFoundryLocalConnection(
  baseUrl: string,
  configuredModel = ""
): Promise<FoundryConnectionTestResult> {
  const snap = await getFoundryStatus(baseUrl, configuredModel);
  const model = snap.configuredModel;
  if (snap.status === "available" && model) {
    return { ok: true, state: "available", model };
  }
  return {
    ok: false,
    state: snap.status,
    model,
  };
}

export async function listFoundryModels(baseUrl: string): Promise<string[]> {
  const root = normalizeFoundryBaseUrl(baseUrl);
  assertLoopbackFoundryUrl(root);
  try {
    const response = await fetchWithTimeout(`${root}/openai/models`);
    return await readJsonArray(response);
  } catch {
    return [];
  }
}

export async function chatCompletions(
  baseUrl: string,
  request: FoundryChatCompletionRequest,
  signal?: AbortSignal
): Promise<FoundryChatCompletionResponse> {
  const root = normalizeFoundryBaseUrl(baseUrl);
  assertLoopbackFoundryUrl(root);
  try {
    const response = await fetchWithTimeout(
      `${root}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, stream: false }),
        signal,
      },
      request.max_tokens && request.max_tokens > 2048 ? 120_000 : 60_000
    );
    if (!response.ok) {
      if (response.status === 404) {
        throw foundryErrorFromUnknown(
          { code: "model_unavailable", message: "Model unavailable" },
          { providerId: "ondevice-foundry-local" }
        );
      }
      throw foundryErrorFromUnknown(
        { code: "runtime_unavailable", message: `Foundry request failed (HTTP ${response.status})` },
        { providerId: "ondevice-foundry-local" }
      );
    }
    return (await response.json()) as FoundryChatCompletionResponse;
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw foundryErrorFromUnknown(
        { code: "cancelled", message: "Request cancelled" },
        { providerId: "ondevice-foundry-local" }
      );
    }
    throw foundryErrorFromUnknown(error, { providerId: "ondevice-foundry-local" });
  }
}

export async function chatCompletionsStream(
  baseUrl: string,
  request: FoundryChatCompletionRequest,
  opts: {
    signal?: AbortSignal;
    onChunk?: (chunk: string) => void;
  } = {}
): Promise<FoundryChatCompletionResponse> {
  const root = normalizeFoundryBaseUrl(baseUrl);
  assertLoopbackFoundryUrl(root);
  try {
    const response = await fetchWithTimeout(
      `${root}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, stream: true }),
        signal: opts.signal,
      },
      request.max_tokens && request.max_tokens > 2048 ? 120_000 : 60_000
    );
    if (!response.ok) {
      throw foundryErrorFromUnknown(
        { code: "runtime_unavailable", message: `Foundry request failed (HTTP ${response.status})` },
        { providerId: "ondevice-foundry-local" }
      );
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw foundryErrorFromUnknown(
        { code: "runtime_unavailable", message: "Empty streaming response" },
        { providerId: "ondevice-foundry-local" }
      );
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";
    let finishReason: string | undefined;
    let model = request.model;
    let usage: FoundryChatCompletionResponse["usage"] | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as {
            model?: string;
            choices?: Array<{
              delta?: { content?: string };
              finish_reason?: string;
            }>;
            usage?: FoundryChatCompletionResponse["usage"];
          };
          if (parsed.model) model = parsed.model;
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            accumulated += delta;
            opts.onChunk?.(delta);
          }
          if (parsed.choices?.[0]?.finish_reason) {
            finishReason = parsed.choices[0].finish_reason;
          }
          if (parsed.usage) usage = parsed.usage;
        } catch {
          // Ignore malformed SSE chunks.
        }
      }
    }

    if (!accumulated && !finishReason) {
      throw foundryErrorFromUnknown(
        { code: "inference_failed", message: "Empty streaming response from Foundry Local" },
        { providerId: "ondevice-foundry-local" }
      );
    }

    return {
      id: "foundry-stream",
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: accumulated },
          finish_reason: finishReason,
        },
      ],
      usage,
    };
  } catch (error) {
    if (opts.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw foundryErrorFromUnknown(
        { code: "cancelled", message: "Request cancelled" },
        { providerId: "ondevice-foundry-local" }
      );
    }
    throw foundryErrorFromUnknown(error, { providerId: "ondevice-foundry-local" });
  }
}

export async function countFoundryTokens(
  baseUrl: string,
  request: FoundryChatCompletionRequest,
  signal?: AbortSignal
): Promise<FoundryTokenCountResponse> {
  const root = normalizeFoundryBaseUrl(baseUrl);
  assertLoopbackFoundryUrl(root);
  try {
    const response = await fetchWithTimeout(
      `${root}/v1/chat/completions/tokenizer/encode/count`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        signal,
      }
    );
    if (!response.ok) {
      throw foundryErrorFromUnknown(
        { code: "runtime_unavailable", message: `HTTP ${response.status}` },
        { providerId: "ondevice-foundry-local" }
      );
    }
    return (await response.json()) as FoundryTokenCountResponse;
  } catch (error) {
    throw foundryErrorFromUnknown(error, { providerId: "ondevice-foundry-local" });
  }
}
