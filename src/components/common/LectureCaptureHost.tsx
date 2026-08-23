import { useEffect, useRef, useState } from "react";
import { persistLectureRecording, saveLectureDocument } from "../../lib/ai/android/lectureCapture";
import { floatToPcm16leBase64 } from "../../lib/ai/android/pcm";
import { getAndroidSpeechProvider } from "../../lib/ai/android/speechProvider";
import { ToastType, useToastStore } from "./Toast";
import { useI18n } from "../../lib/i18n";

export const LECTURE_CAPTURE_EVENT = "plethora:record-lecture";

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  start(): void;
  abort(): void;
  stop(): void;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};

function stopTracks(recorder: MediaRecorder | null) {
  recorder?.stream.getTracks().forEach((track) => track.stop());
}

function startBrowserCaptions(
  onPartial: (text: string) => void
): BrowserSpeechRecognition | null {
  const Ctor = (
    window as unknown as {
      SpeechRecognition?: new () => BrowserSpeechRecognition;
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    }
  ).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: new () => BrowserSpeechRecognition })
      .webkitSpeechRecognition;
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";
  recognition.onresult = (event) => {
    let text = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const piece = event.results[i];
      if (piece) text += piece[0]?.transcript ?? "";
    }
    const trimmed = text.trim();
    if (trimmed) onPartial(trimmed);
  };
  recognition.onerror = () => {
    /* persist-first STT still runs after stop */
  };
  try {
    recognition.start();
    return recognition;
  } catch {
    return null;
  }
}

function attachPcmTap(stream: MediaStream): { stop: () => Promise<string> } {
  const ctx = new AudioContext({ sampleRate: 16_000 });
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  processor.onaudioprocess = (event) => {
    chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
  };
  const mute = ctx.createGain();
  mute.gain.value = 0;
  source.connect(processor);
  processor.connect(mute);
  mute.connect(ctx.destination);
  const inputRate = ctx.sampleRate || 16_000;
  return {
    stop: async () => {
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
      await ctx.close().catch(() => undefined);
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Float32Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      return floatToPcm16leBase64(merged, inputRate);
    },
  };
}

export function LectureCaptureHost() {
  const { t } = useI18n();
  const addToast = useToastStore((s) => s.addToast);
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [partial, setPartial] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const pcmTapRef = useRef<{ stop: () => Promise<string> } | null>(null);
  const captionsRef = useRef<BrowserSpeechRecognition | null>(null);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(LECTURE_CAPTURE_EVENT, onOpen);
    return () => window.removeEventListener(LECTURE_CAPTURE_EVENT, onOpen);
  }, []);

  const stopLiveInputs = () => {
    try {
      captionsRef.current?.abort();
    } catch {
      /* already stopped */
    }
    captionsRef.current = null;
  };

  const discard = () => {
    try {
      recorderRef.current?.stop();
    } catch {
      /* already stopped */
    }
    stopLiveInputs();
    void pcmTapRef.current?.stop();
    pcmTapRef.current = null;
    stopTracks(recorderRef.current);
    recorderRef.current = null;
    chunksRef.current = [];
    setPartial("");
    setRecording(false);
    setOpen(false);
  };

  const stop = async () => {
    const recorder = recorderRef.current;
    const blob = await new Promise<Blob>((resolve) => {
      if (!recorder) {
        resolve(new Blob(chunksRef.current, { type: "audio/webm" }));
        return;
      }
      recorder.addEventListener(
        "stop",
        () => resolve(new Blob(chunksRef.current, { type: "audio/webm" })),
        { once: true }
      );
      try {
        recorder.stop();
      } catch {
        resolve(new Blob(chunksRef.current, { type: "audio/webm" }));
      }
    });
    stopLiveInputs();
    const pcmBase64 = (await pcmTapRef.current?.stop()) ?? "";
    pcmTapRef.current = null;
    stopTracks(recorder);
    setRecording(false);
    chunksRef.current = [];
    recorderRef.current = null;
    const audioUri = await persistLectureRecording(blob);
    const result = await saveLectureDocument({
      audioUri,
      speech: getAndroidSpeechProvider(),
      pcmBase64: pcmBase64 || undefined,
    });
    addToast({
      type: ToastType.Success,
      title: t("commandPalette.recordLecture"),
      message: result.incomplete
        ? t("onDeviceAi.lectureSavedIncomplete")
        : t("onDeviceAi.lectureSaved"),
    });
    setPartial("");
    setOpen(false);
  };

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    setPartial("");
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.start();
    recorderRef.current = recorder;
    pcmTapRef.current = attachPcmTap(stream);
    captionsRef.current = startBrowserCaptions(setPartial);
    setRecording(true);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-card p-4 shadow-lg">
        <h2 className="text-base font-semibold">{t("commandPalette.recordLecture")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("commandPalette.recordLectureDesc")}</p>
        {recording ? (
          <p className="mt-2 max-h-24 overflow-auto text-sm text-muted-foreground" aria-live="polite">
            {partial || t("onDeviceAi.lectureListening")}
          </p>
        ) : null}
        <div className="mt-4 flex gap-2">
          {!recording ? (
            <button
              type="button"
              className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
              onClick={() => void start()}
            >
              {t("onDeviceAi.lectureStart")}
            </button>
          ) : (
            <button
              type="button"
              className="rounded-lg bg-destructive px-3 py-2 text-sm text-destructive-foreground"
              onClick={() => void stop()}
            >
              {t("onDeviceAi.lectureStop")}
            </button>
          )}
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-2 text-sm"
            onClick={discard}
          >
            {t("onDeviceAi.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
