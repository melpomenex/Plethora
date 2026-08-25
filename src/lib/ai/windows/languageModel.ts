import { listen } from "@tauri-apps/api/event";
import { getWindowsIntelligenceSnapshot } from "./capabilities";
import { windowsErrorFromUnknown } from "./errors";
import { invokeWindows } from "./plugin";
import { AIError } from "../errors";
import type { AIStreamOptions } from "../providers/types";

export const WINDOWS_SYSTEM_PROVIDER_ID = "ondevice-windows-system";

export interface WindowsLmResponse {
  requestId: string;
  text: string;
  finishReason?: string;
  inputTokens?: number;
  tokenLimit?: number;
  baseModelName?: string;
}

export interface WindowsLmAvailability {
  status: string;
  reason?: string;
  contextSize?: number;
  tokenLimit?: number;
}

export async function windowsLmAvailability(): Promise<WindowsLmAvailability> {
  try {
    return await invokeWindows<WindowsLmAvailability>("windows_lm_ensure_ready");
  } catch {
    const snap = await getWindowsIntelligenceSnapshot();
    return snap.languageModel;
  }
}

export async function windowsLmGenerate(args: {
  requestId: string;
  text: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
  temperature?: number;
  schemaName?: string;
  structured?: boolean;
}): Promise<WindowsLmResponse> {
  try {
    return await invokeWindows<WindowsLmResponse>("windows_lm_generate", { payload: args });
  } catch (error) {
    throw windowsErrorFromUnknown(error, { providerId: WINDOWS_SYSTEM_PROVIDER_ID });
  }
}

export async function windowsLmGenerateStream(
  args: {
    requestId: string;
    text: string;
    systemInstruction?: string;
    maxOutputTokens?: number;
    temperature?: number;
    schemaName?: string;
    structured?: boolean;
  },
  opts?: AIStreamOptions
): Promise<WindowsLmResponse> {
  throwIfAborted(opts?.signal);
  const unlistenFns: Array<() => void> = [];
  let settled = false;

  const cleanup = () => {
    if (settled) return;
    settled = true;
    for (const fn of unlistenFns) fn();
  };

  return new Promise<WindowsLmResponse>((resolve, reject) => {
    void (async () => {
      try {
        const unlistenText = await listen<{ requestId: string; text: string }>(
          "windows-lm://text",
          (event) => {
            if (!settled && event.payload.requestId === args.requestId) {
              opts?.onChunk?.(event.payload.text);
            }
          }
        );
        unlistenFns.push(unlistenText);

        const unlistenComplete = await listen<WindowsLmResponse>("windows-lm://complete", (event) => {
          if (!settled && event.payload.requestId === args.requestId) {
            cleanup();
            resolve(event.payload);
          }
        });
        unlistenFns.push(unlistenComplete);

        const unlistenError = await listen<{ requestId: string; code: string; message: string }>(
          "windows-lm://error",
          (event) => {
            if (!settled && event.payload.requestId === args.requestId) {
              cleanup();
              reject(
                windowsErrorFromUnknown(
                  { code: event.payload.code, message: event.payload.message },
                  { providerId: WINDOWS_SYSTEM_PROVIDER_ID }
                )
              );
            }
          }
        );
        unlistenFns.push(unlistenError);

        opts?.signal?.addEventListener("abort", () => {
          void windowsLmCancel(args.requestId);
        });

        const result = await invokeWindows<WindowsLmResponse>("windows_lm_generate_stream", {
          payload: args,
        });
        if (!settled) {
          cleanup();
          opts?.onChunk?.(result.text);
          resolve(result);
        }
      } catch (error) {
        cleanup();
        reject(windowsErrorFromUnknown(error, { providerId: WINDOWS_SYSTEM_PROVIDER_ID }));
      }
    })();
  });
}

export async function windowsLmCancel(requestId: string): Promise<void> {
  try {
    await invokeWindows("windows_lm_cancel", { payload: { requestId } });
  } catch (error) {
    throw windowsErrorFromUnknown(error, { providerId: WINDOWS_SYSTEM_PROVIDER_ID });
  }
}

export async function windowsLmWarmup(): Promise<void> {
  try {
    await invokeWindows("windows_lm_warmup");
  } catch (error) {
    throw windowsErrorFromUnknown(error, { providerId: WINDOWS_SYSTEM_PROVIDER_ID });
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new AIError("Cancelled", "Request cancelled", {
      code: "cancelled",
      providerId: WINDOWS_SYSTEM_PROVIDER_ID,
    });
  }
}
