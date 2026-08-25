import { invokeApple } from "./plugin";
import { getAppleIntelligenceSnapshot } from "./capabilities";
import { appleErrorFromUnknown } from "./errors";
import { chunkTextByTokens, estimateTokens } from "../chunkTextByTokens";
import { AIError } from "../errors";
import type { AIRequest, AIResponse, AIStreamOptions, AIUsageMetadata } from "../providers/types";

export interface AppleFmResponse {
  requestId: string;
  text: string;
}

export interface AppleFmAvailability {
  status: string;
  reason?: string;
  contextSize?: number;
  tokenCount?: number;
  tokenLimit?: number;
}

export async function appleFmAvailability(): Promise<AppleFmAvailability> {
  try {
    return await invokeApple("apple_fm_availability");
  } catch {
    const snap = await getAppleIntelligenceSnapshot();
    return snap.foundationModels;
  }
}

export async function appleFmGenerate(args: {
  requestId: string;
  text: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
  temperature?: number;
  schemaName?: string;
  structured?: boolean;
}): Promise<AppleFmResponse> {
  try {
    return await invokeApple<AppleFmResponse>("apple_fm_generate", { payload: args });
  } catch (error) {
    throw appleErrorFromUnknown(error, { providerId: "ondevice-apple-foundation" });
  }
}

export async function appleFmGenerateStream(
  args: {
    requestId: string;
    text: string;
    systemInstruction?: string;
    maxOutputTokens?: number;
    temperature?: number;
    schemaName?: string;
    structured?: boolean;
  },
  opts?: AIStreamOptions,
): Promise<AppleFmResponse> {
  throwIfAborted(opts?.signal);
  const { listen } = await import("@tauri-apps/api/event");
  const unlistenFns: Array<() => void> = [];
  let settled = false;

  const cleanup = () => {
    if (settled) return;
    settled = true;
    for (const fn of unlistenFns) fn();
  };

  return new Promise<AppleFmResponse>((resolve, reject) => {
    void (async () => {
      try {
        const unlistenText = await listen<{ requestId: string; text: string }>(
          "apple-fm://text",
          (event) => {
            if (!settled && event.payload.requestId === args.requestId) {
              opts?.onChunk?.(event.payload.text);
            }
          },
        );
        unlistenFns.push(unlistenText);

        const unlistenComplete = await listen<AppleFmResponse>("apple-fm://complete", (event) => {
          if (!settled && event.payload.requestId === args.requestId) {
            cleanup();
            resolve(event.payload);
          }
        });
        unlistenFns.push(unlistenComplete);

        const unlistenError = await listen<{ requestId: string; code: string; message: string }>(
          "apple-fm://error",
          (event) => {
            if (!settled && event.payload.requestId === args.requestId) {
              cleanup();
              reject(
                appleErrorFromUnknown(
                  { code: event.payload.code, message: event.payload.message },
                  { providerId: "ondevice-apple-foundation" },
                ),
              );
            }
          },
        );
        unlistenFns.push(unlistenError);

        opts?.signal?.addEventListener("abort", () => {
          void appleFmCancel(args.requestId);
        });

        const result = await invokeApple<AppleFmResponse>("apple_fm_generate_stream", {
          payload: args,
        });
        if (!settled) {
          cleanup();
          opts?.onChunk?.(result.text);
          resolve(result);
        }
      } catch (error) {
        cleanup();
        reject(appleErrorFromUnknown(error, { providerId: "ondevice-apple-foundation" }));
      }
    })();
  });
}

export async function appleFmCancel(requestId: string): Promise<void> {
  try {
    await invokeApple("apple_fm_cancel", { payload: { requestId } });
  } catch (error) {
    throw appleErrorFromUnknown(error, { providerId: "ondevice-apple-foundation" });
  }
}

export async function appleFmCountTokens(text: string, systemInstruction?: string): Promise<AIUsageMetadata> {
  try {
    return await invokeApple<AIUsageMetadata>("apple_fm_count_tokens", {
      payload: { text, systemInstruction },
    });
  } catch (error) {
    throw appleErrorFromUnknown(error, { providerId: "ondevice-apple-foundation" });
  }
}

export async function appleFmWarmup(): Promise<void> {
  try {
    await invokeApple("apple_fm_warmup");
  } catch (error) {
    throw appleErrorFromUnknown(error, { providerId: "ondevice-apple-foundation" });
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AIError("Cancelled", "Request cancelled", {
      code: "cancelled",
      providerId: "ondevice-apple-foundation",
    });
  }
}

/**
 * Hierarchical map-reduce for over-budget prompts. `libraryAnswer` is never
 * sliced into citation units — the task layer already truncated the chunk list.
 */
export async function runChunkedGeneration(
  req: AIRequest,
  contextTokens: number,
  opts?: AIStreamOptions,
): Promise<AIResponse> {
  throwIfAborted(opts?.signal);
  const promptTokens = estimateTokens(`${req.systemInstruction ?? ""}${req.text}`);
  if (promptTokens > contextTokens && req.schemaName === "libraryAnswer") {
    throw new AIError("InputTooLarge", "Library answer exceeds the on-device context window", {
      code: "invalid_argument",
      providerId: "ondevice-apple-foundation",
    });
  }

  const budget = Math.max(1000, contextTokens - (req.maxOutputTokens ?? 512) - 256);
  const pieces =
    req.structured === true || req.schemaName === "libraryAnswer"
      ? [req.text]
      : chunkTextByTokens(req.text, budget);

  if (pieces.length <= 1) {
    const genArgs = {
      requestId: req.requestId,
      text: req.text,
      systemInstruction: req.systemInstruction,
      maxOutputTokens: req.maxOutputTokens,
      temperature: req.temperature,
      schemaName: req.schemaName,
      structured: req.structured,
    };
    const result = opts?.onChunk
      ? await appleFmGenerateStream(genArgs, opts)
      : await appleFmGenerate(genArgs);
    opts?.onChunk?.(result.text);
    return { requestId: result.requestId ?? req.requestId, text: result.text };
  }

  const partials: string[] = [];
  for (let i = 0; i < pieces.length; i++) {
    throwIfAborted(opts?.signal);
    const result = await appleFmGenerate({
      requestId: `${req.requestId}:chunk:${i}`,
      text: pieces[i],
      systemInstruction: req.systemInstruction,
      maxOutputTokens: req.maxOutputTokens,
      temperature: req.temperature,
      schemaName: req.schemaName,
      structured: req.structured,
    });
    partials.push(result.text);
    opts?.onChunk?.(result.text);
  }

  throwIfAborted(opts?.signal);
  const reduced = await appleFmGenerate({
    requestId: `${req.requestId}:reduce`,
    text: partials.join("\n\n"),
    systemInstruction: req.systemInstruction,
    maxOutputTokens: req.maxOutputTokens,
    temperature: req.temperature,
    schemaName: req.schemaName,
    structured: req.structured,
  });
  opts?.onChunk?.(reduced.text);
  return { requestId: reduced.requestId ?? req.requestId, text: reduced.text };
}
