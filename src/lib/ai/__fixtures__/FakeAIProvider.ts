/**
 * Deterministic fake provider for evaluation fixtures and unit tests
 * (design D29): replays canned responses through the real `runTask` +
 * validation pipeline so CI never needs Nano hardware.
 *
 * Script responses in order; when the script runs out, the last response
 * repeats. A scripted `Error` is thrown; a function receives the request and
 * the call index for dynamic behaviour.
 */

import type {
  AIModelCapabilities,
  AIProvider,
  AIRequest,
  AIResponse,
  AIStreamOptions,
} from "../providers/types";

export type FakeResponse =
  | AIResponse
  | Error
  | ((req: AIRequest, call: number) => AIResponse | Error | Promise<AIResponse | Error>);

export function fakeCapabilities(overrides: Partial<AIModelCapabilities> = {}): AIModelCapabilities {
  return {
    textGeneration: true,
    structuredGeneration: false,
    vision: false,
    multiImage: false,
    systemInstructions: true,
    toolCalling: false,
    reasoning: false,
    embeddings: false,
    contextTokens: 4096,
    streaming: true,
    prefixCaching: false,
    offlineAvailable: true,
    downloadState: "downloaded",
    ...overrides,
  };
}

export class FakeAIProvider implements AIProvider {
  readonly id: string;
  readonly kind: "ondevice" | "cloud";
  readonly capabilities: AIModelCapabilities;
  readonly requests: AIRequest[] = [];
  readonly streamOptions: AIStreamOptions[] = [];
  /** How many `generateStream` calls were made (including repairs). */
  callCount = 0;

  private script: FakeResponse[];

  constructor(options: {
    id?: string;
    kind?: "ondevice" | "cloud";
    capabilities?: Partial<AIModelCapabilities>;
    responses?: FakeResponse[];
  } = {}) {
    this.id = options.id ?? (options.kind === "cloud" ? "fake-cloud" : "fake-ondevice");
    this.kind = options.kind ?? "ondevice";
    this.capabilities = fakeCapabilities(options.capabilities);
    this.script = options.responses ?? [];
  }

  async getCapabilities(): Promise<AIModelCapabilities> {
    return this.capabilities;
  }

  generateStream(req: AIRequest, opts: AIStreamOptions = {}): Promise<AIResponse> {
    this.requests.push(req);
    this.streamOptions.push(opts);
    const call = this.callCount++;
    const scripted = this.script.length > 0 ? this.script[Math.min(call, this.script.length - 1)] : null;

    return new Promise<AIResponse>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        opts.signal?.removeEventListener("abort", onAbort);
        fn();
      };
      const onAbort = () =>
        settle(() =>
          reject(Object.assign(new Error("Fake generation was cancelled."), { name: "AbortError" }))
        );

      if (opts.signal?.aborted) {
        onAbort();
        return;
      }
      opts.signal?.addEventListener("abort", onAbort, { once: true });

      const deliver = async () => {
        const outcome =
          typeof scripted === "function" ? await scripted(req, call) : scripted;
        settle(() => {
          if (outcome instanceof Error) {
            reject(outcome);
            return;
          }
          if (outcome) {
            // Emit text in two chunks so streaming behaviour is exercised.
            if (opts.onChunk && outcome.text.length > 1) {
              const mid = Math.floor(outcome.text.length / 2);
              opts.onChunk(outcome.text.slice(0, mid));
              opts.onChunk(outcome.text.slice(mid));
            } else if (opts.onChunk && outcome.text) {
              opts.onChunk(outcome.text);
            }
            resolve(outcome);
            return;
          }
          reject(new Error(`FakeAIProvider[${this.id}] has no scripted response for call ${call}.`));
        });
      };
      void deliver();
    });
  }
}
