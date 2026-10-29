import { invokeCommand, isTauri, isNativeMobile } from "../lib/tauri";

export interface Lfm3Status {
  available: boolean;
  loaded: boolean;
  modelId: string | null;
  backend: string | null;
  error: string | null;
}
export async function getLfm3Status(): Promise<Lfm3Status> {
  if (!isTauri() || isNativeMobile())
    return {
      available: false,
      loaded: false,
      modelId: null,
      backend: null,
      error: "LFM3 requires a compatible desktop runtime in this app build.",
    };
  return invokeCommand<Lfm3Status>("lfm3_tts_status");
}
export async function generateLfm3Speech(options: {
  text: string;
  modelId: string;
  voice: string;
  language: string;
  signal?: AbortSignal;
}) {
  if (!isTauri() || isNativeMobile()) throw new Error("LFM3 requires the desktop app.");
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const requestId = crypto.randomUUID();
  const cancel = () => {
    void invokeCommand("lfm3_tts_cancel", { requestId }).catch(() => {});
  };
  options.signal?.addEventListener("abort", cancel, { once: true });
  try {
    const result = await invokeCommand<{
      audioData: string;
      sampleRate: number;
      durationSec: number;
      backend: string;
    }>("lfm3_tts_synthesize", {
      requestId,
      modelId: options.modelId,
      text: options.text,
      voice: options.voice,
      language: options.language,
    });
    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return { audioUrl: result.audioData, durationSec: result.durationSec, backend: result.backend };
  } finally {
    options.signal?.removeEventListener("abort", cancel);
  }
}
