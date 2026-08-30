import { ensureCloudAiDisclosure } from "../../../lib/privacy/cloudAiDisclosure";
import { useSettingsStore } from "../../../stores/settingsStore";
import { generateId } from "../../../utils/id";
import {
  DEEPGRAM_LISTEN_URL,
  DEEPGRAM_NOVA3_MODEL,
  DEEPGRAM_WS_URL,
  TRANSCRIPTION_PROVIDER_IDS,
} from "../config";
import {
  mapHttpStatusToTranscriptionError,
  normalizeError,
  readProviderMessage,
  TranscriptionError,
} from "../errors";
import {
  checkPremiumTranscriptionAllowed,
  recordPremiumTranscriptionUsage,
} from "../premiumGuard";
import type {
  PartialTranscript,
  StreamingTranscriptionSession,
  TranscriptionCapabilities,
  TranscriptionInput,
  TranscriptionOptions,
  TranscriptionProviderId,
  TranscriptionResult,
  TranscriptionSegment,
  TranscriptionWord,
} from "../types";
import { audioFilename, secondsToMs } from "./audioHttpUtils";
import { BaseProvider } from "./BaseProvider";
import { resolveDeepgramApiKey } from "./deepgramAuth";

const TRANSCRIPTION_TIMEOUT_MS = 120_000;

interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  speaker?: number;
  confidence?: number;
}

interface DeepgramAlternative {
  transcript?: string;
  words?: DeepgramWord[];
  paragraphs?: {
    paragraphs?: Array<{
      sentences?: Array<{ text: string; start: number; end: number }>;
    }>;
  };
}

interface DeepgramListenResponse {
  metadata?: {
    duration?: number;
    language?: string;
  };
  results?: {
    channels?: Array<{
      alternatives?: DeepgramAlternative[];
    }>;
  };
}

interface DeepgramStreamMessage {
  type?: string;
  is_final?: boolean;
  speech_final?: boolean;
  channel?: {
    alternatives?: DeepgramAlternative[];
  };
}

function normalizeDeepgramResponse(
  payload: DeepgramListenResponse,
  providerId: TranscriptionProviderId,
  model: string,
): TranscriptionResult {
  const alternative = payload.results?.channels?.[0]?.alternatives?.[0];
  const text = alternative?.transcript?.trim() ?? "";
  const words = alternative?.words?.map((word): TranscriptionWord => ({
    word: word.word,
    startMs: secondsToMs(word.start),
    endMs: secondsToMs(word.end),
    speakerId: word.speaker !== undefined ? String(word.speaker) : undefined,
  }));

  const segments: TranscriptionSegment[] = [];
  const sentences = alternative?.paragraphs?.paragraphs
    ?.flatMap((paragraph) => paragraph.sentences ?? []) ?? [];

  if (sentences.length > 0) {
    for (const sentence of sentences) {
      segments.push({
        startMs: secondsToMs(sentence.start),
        endMs: secondsToMs(sentence.end),
        text: sentence.text,
      });
    }
  } else if (text) {
    const durationSeconds = payload.metadata?.duration;
    segments.push({
      startMs: 0,
      endMs: durationSeconds ? secondsToMs(durationSeconds) : 0,
      text,
      words,
    });
  }

  const durationSeconds = payload.metadata?.duration;
  return {
    text,
    language: payload.metadata?.language,
    segments,
    durationSeconds,
    durationMs: durationSeconds ? secondsToMs(durationSeconds) : undefined,
    providerId,
    model,
    metadata: { source: "deepgram" },
  };
}

function buildDeepgramListenUrl(language?: string): string {
  const params = new URLSearchParams({
    model: DEEPGRAM_NOVA3_MODEL,
    smart_format: "true",
    punctuate: "true",
    diarize: "true",
    utterances: "true",
    paragraphs: "true",
  });
  if (language) {
    params.set("language", language);
  }
  return `${DEEPGRAM_LISTEN_URL}?${params.toString()}`;
}

function buildDeepgramStreamUrl(language?: string): string {
  const params = new URLSearchParams({
    model: DEEPGRAM_NOVA3_MODEL,
    smart_format: "true",
    punctuate: "true",
    diarize: "true",
    interim_results: "true",
    utterance_end_ms: "1000",
    encoding: "linear16",
    sample_rate: "16000",
  });
  if (language) {
    params.set("language", language);
  }
  return `${DEEPGRAM_WS_URL}?${params.toString()}`;
}

class DeepgramStreamingSession implements StreamingTranscriptionSession {
  readonly id: string;
  readonly providerId: TranscriptionProviderId = TRANSCRIPTION_PROVIDER_IDS.DEEPGRAM_NOVA3;

  private readonly socket: WebSocket;
  private cancelled = false;
  private closed = false;
  private finalText = "";
  private finalSegments: TranscriptionSegment[] = [];
  private partialCallback: ((result: PartialTranscript) => void) | undefined;
  private finalCallback: ((result: TranscriptionSegment) => void) | undefined;
  private errorCallback: ((error: TranscriptionError) => void) | undefined;
  private closeResolver: ((result: TranscriptionResult) => void) | undefined;
  private closeRejecter: ((error: Error) => void) | undefined;

  constructor(socket: WebSocket) {
    this.id = generateId();
    this.socket = socket;

    socket.addEventListener("message", (event) => {
      this.handleMessage(event.data);
    });
    socket.addEventListener("error", () => {
      const error = new TranscriptionError(
        "Deepgram streaming connection failed.",
        "NETWORK_ERROR",
        { recoverable: true, providerId: this.providerId },
      );
      this.errorCallback?.(error);
      this.closeRejecter?.(error);
    });
    socket.addEventListener("close", () => {
      if (this.closed || this.cancelled) return;
      const error = new TranscriptionError(
        "Deepgram streaming connection closed unexpectedly.",
        "NETWORK_ERROR",
        { recoverable: true, providerId: this.providerId },
      );
      this.errorCallback?.(error);
      this.closeRejecter?.(error);
    });
  }

  onPartial(callback: (result: PartialTranscript) => void): void {
    this.partialCallback = callback;
  }

  onFinal(callback: (result: TranscriptionSegment) => void): void {
    this.finalCallback = callback;
  }

  onError(callback: (error: TranscriptionError) => void): void {
    this.errorCallback = callback;
  }

  async pushAudio(chunk: ArrayBuffer): Promise<void> {
    if (this.cancelled || this.closed) return;
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(chunk);
    }
  }

  async close(): Promise<TranscriptionResult> {
    if (this.cancelled) {
      throw new TranscriptionError("Streaming session cancelled.", "CANCELLED", {
        providerId: this.providerId,
      });
    }

    if (this.closed) {
      return {
        text: this.finalText,
        segments: this.finalSegments,
        providerId: this.providerId,
        model: DEEPGRAM_NOVA3_MODEL,
      };
    }

    return new Promise<TranscriptionResult>((resolve, reject) => {
      this.closeResolver = resolve;
      this.closeRejecter = reject;

      const onClose = () => {
        this.socket.removeEventListener("close", onClose);
        try {
          this.finishClose();
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      this.socket.addEventListener("close", onClose);

      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "CloseStream" }));
      } else {
        onClose();
      }
    });
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== "string") return;

    let payload: DeepgramStreamMessage;
    try {
      payload = JSON.parse(data) as DeepgramStreamMessage;
    } catch {
      return;
    }

    if (payload.type === "Metadata") {
      return;
    }

    const alternative = payload.channel?.alternatives?.[0];
    const transcript = alternative?.transcript?.trim();
    if (!transcript) return;

    if (payload.is_final || payload.speech_final) {
      const segment: TranscriptionSegment = {
        startMs: alternative?.words?.[0] ? secondsToMs(alternative.words[0].start) : 0,
        endMs: alternative?.words?.at(-1)
          ? secondsToMs(alternative.words.at(-1)!.end)
          : 0,
        text: transcript,
        words: alternative?.words?.map((word) => ({
          word: word.word,
          startMs: secondsToMs(word.start),
          endMs: secondsToMs(word.end),
          speakerId: word.speaker !== undefined ? String(word.speaker) : undefined,
        })),
      };
      this.finalSegments.push(segment);
      this.finalText = this.finalSegments.map((entry) => entry.text).join(" ").trim();
      this.finalCallback?.(segment);
      this.partialCallback?.({ text: transcript, isFinal: true });
    } else {
      this.partialCallback?.({ text: transcript, isFinal: false });
    }
  }

  private finishClose(): void {
    if (this.closed) return;
    this.closed = true;

    const durationSeconds = this.finalSegments.at(-1)?.endMs
      ? (this.finalSegments.at(-1)!.endMs) / 1000
      : 0;
    void recordPremiumTranscriptionUsage(durationSeconds, {
      providerId: this.providerId,
      model: DEEPGRAM_NOVA3_MODEL,
    });

    const result: TranscriptionResult = {
      text: this.finalText,
      segments: this.finalSegments,
      durationSeconds,
      durationMs: durationSeconds ? secondsToMs(durationSeconds) : undefined,
      providerId: this.providerId,
      model: DEEPGRAM_NOVA3_MODEL,
      metadata: { source: "deepgram-stream" },
    };
    this.closeResolver?.(result);
  }
}

async function postDeepgramTranscription(
  audio: File | Blob,
  language: string | undefined,
  signal: AbortSignal | undefined,
  onProgress: TranscriptionOptions["onProgress"],
  providerId: TranscriptionProviderId,
): Promise<TranscriptionResult> {
  const settings = useSettingsStore.getState().settings;
  const apiKey = resolveDeepgramApiKey(settings);
  if (!apiKey) {
    throw new TranscriptionError(
      "Deepgram needs an API key. Add one in Audio Transcription settings.",
      "AUTH_FAILED",
      { providerId },
    );
  }

  if (
    !(await ensureCloudAiDisclosure({
      featureClass: "transcription",
      provider: "deepgram",
    }))
  ) {
    throw new TranscriptionError(
      "Cloud transcription disclosure declined — audio was not sent.",
      "DISCLOSURE_DECLINED",
      { providerId },
    );
  }

  onProgress?.({ percent: 10, message: "Uploading audio to Deepgram…" });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TRANSCRIPTION_TIMEOUT_MS);
  const abortFromSignal = () => controller.abort();
  signal?.addEventListener("abort", abortFromSignal);

  let response: Response;
  try {
    response = await fetch(buildDeepgramListenUrl(language), {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": audio.type || "application/octet-stream",
      },
      body: audio,
      signal: controller.signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw new TranscriptionError("Transcription cancelled.", "CANCELLED", { providerId });
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new TranscriptionError(
        "Deepgram transcription timed out. Try again with a shorter clip.",
        "TIMEOUT",
        { recoverable: true, providerId },
      );
    }
    throw new TranscriptionError(
      "Network error while contacting Deepgram.",
      "NETWORK_ERROR",
      { recoverable: true, providerId, cause: error },
    );
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromSignal);
  }

  onProgress?.({ percent: 90, message: "Processing Deepgram transcript…" });

  if (!response.ok) {
    const message = await readProviderMessage(response);
    throw mapHttpStatusToTranscriptionError(response.status, message);
  }

  const payload = await response.json() as DeepgramListenResponse;
  onProgress?.({ percent: 100, message: "Deepgram transcription complete" });

  const result = normalizeDeepgramResponse(payload, providerId, DEEPGRAM_NOVA3_MODEL);
  const durationSeconds = result.durationSeconds ?? 0;
  await recordPremiumTranscriptionUsage(durationSeconds, {
    providerId,
    model: DEEPGRAM_NOVA3_MODEL,
  });
  return result;
}

export class DeepgramProvider extends BaseProvider {
  readonly id: TranscriptionProviderId = TRANSCRIPTION_PROVIDER_IDS.DEEPGRAM_NOVA3;
  readonly name = "Deepgram Nova-3";
  readonly model = DEEPGRAM_NOVA3_MODEL;

  capabilities(): TranscriptionCapabilities {
    return {
      fileTranscription: true,
      streaming: true,
      pseudoStreaming: false,
      segmentTimestamps: true,
      wordTimestamps: true,
      diarization: true,
      languageDetection: true,
      customVocabulary: true,
      offline: false,
      supportedLanguages: "auto",
    };
  }

  isConfigured(settings = useSettingsStore.getState().settings): boolean {
    return Boolean(resolveDeepgramApiKey(settings));
  }

  async healthCheck() {
    const configured = this.isConfigured();
    return {
      healthy: configured,
      message: configured ? undefined : "Deepgram API key not configured",
      checkedAt: Date.now(),
    };
  }

  async transcribe(
    input: TranscriptionInput,
    options: TranscriptionOptions = {},
  ): Promise<TranscriptionResult> {
    this.assertNotAborted(options.signal);

    const audio = input.file;
    if (!audio) {
      throw new TranscriptionError(
        "Deepgram transcription requires an audio file or blob.",
        "INVALID_INPUT",
        { providerId: this.id },
      );
    }

    const settings = useSettingsStore.getState().settings;
    await checkPremiumTranscriptionAllowed(settings, input.durationSeconds ?? 0);

    const language =
      options.language && options.language !== "auto" ? options.language : undefined;

    try {
      return await postDeepgramTranscription(
        audio,
        language,
        options.signal,
        options.onProgress,
        this.id,
      );
    } catch (error) {
      throw normalizeError(error, this.id);
    }
  }

  async startStreaming(
    input: TranscriptionInput,
    options: TranscriptionOptions = {},
  ): Promise<StreamingTranscriptionSession> {
    this.assertNotAborted(options.signal);

    const settings = useSettingsStore.getState().settings;
    await checkPremiumTranscriptionAllowed(settings, input.durationSeconds ?? 0);

    const apiKey = resolveDeepgramApiKey(settings);
    if (!apiKey) {
      throw new TranscriptionError(
        "Deepgram needs an API key. Add one in Audio Transcription settings.",
        "AUTH_FAILED",
        { providerId: this.id },
      );
    }

    if (
      !(await ensureCloudAiDisclosure({
        featureClass: "transcription",
        provider: "deepgram",
      }))
    ) {
      throw new TranscriptionError(
        "Cloud transcription disclosure declined — audio was not sent.",
        "DISCLOSURE_DECLINED",
        { providerId: this.id },
      );
    }

    const language =
      options.language && options.language !== "auto" ? options.language : undefined;
    const url = buildDeepgramStreamUrl(language);
    const socket = new WebSocket(url, ["token", apiKey]);

    return new Promise<StreamingTranscriptionSession>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new TranscriptionError(
          "Timed out connecting to Deepgram streaming.",
          "TIMEOUT",
          { recoverable: true, providerId: this.id },
        ));
      }, 10_000);

      socket.addEventListener("open", () => {
        clearTimeout(timeoutId);
        resolve(new DeepgramStreamingSession(socket));
      });

      socket.addEventListener("error", () => {
        clearTimeout(timeoutId);
        reject(new TranscriptionError(
          "Failed to connect to Deepgram streaming.",
          "NETWORK_ERROR",
          { recoverable: true, providerId: this.id },
        ));
      });
    });
  }
}

export {
  buildDeepgramListenUrl,
  buildDeepgramStreamUrl,
  normalizeDeepgramResponse,
  postDeepgramTranscription,
};
