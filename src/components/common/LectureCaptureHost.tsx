import { useEffect, useRef, useState } from "react";
import { persistLectureRecording, saveLectureDocument } from "../../lib/ai/android/lectureCapture";
import { getAndroidSpeechProvider } from "../../lib/ai/android/speechProvider";
import { ToastType, useToastStore } from "./Toast";
import { useI18n } from "../../lib/i18n";

export const LECTURE_CAPTURE_EVENT = "plethora:record-lecture";

function stopTracks(recorder: MediaRecorder | null) {
  recorder?.stream.getTracks().forEach((track) => track.stop());
}

export function LectureCaptureHost() {
  const { t } = useI18n();
  const addToast = useToastStore((s) => s.addToast);
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(LECTURE_CAPTURE_EVENT, onOpen);
    return () => window.removeEventListener(LECTURE_CAPTURE_EVENT, onOpen);
  }, []);

  const discard = () => {
    try {
      recorderRef.current?.stop();
    } catch {
      /* already stopped */
    }
    stopTracks(recorderRef.current);
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setOpen(false);
  };

  const stop = async () => {
    const recorder = recorderRef.current;
    recorder?.stop();
    stopTracks(recorder);
    setRecording(false);
    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    chunksRef.current = [];
    recorderRef.current = null;
    const audioUri = await persistLectureRecording(blob);
    const result = await saveLectureDocument({
      audioUri,
      speech: getAndroidSpeechProvider(),
    });
    addToast({
      type: ToastType.Success,
      title: t("commandPalette.recordLecture"),
      message: result.incomplete
        ? t("onDeviceAi.lectureSavedIncomplete")
        : t("onDeviceAi.lectureSaved"),
    });
    setOpen(false);
  };

  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.start();
    recorderRef.current = recorder;
    setRecording(true);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-xl bg-card p-4 shadow-lg">
        <h2 className="text-base font-semibold">{t("commandPalette.recordLecture")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("commandPalette.recordLectureDesc")}</p>
        {recording ? (
          <p className="mt-2 text-sm text-muted-foreground" aria-live="polite">
            {t("commandPalette.recordLectureDesc")}
          </p>
        ) : null}
        <div className="mt-4 flex gap-2">
          {!recording ? (
            <button type="button" className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={() => void start()}>
              {t("onDeviceAi.lectureStart")}
            </button>
          ) : (
            <button type="button" className="rounded-lg bg-destructive px-3 py-2 text-sm text-destructive-foreground" onClick={() => void stop()}>
              {t("onDeviceAi.lectureStop")}
            </button>
          )}
          <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm" onClick={discard}>
            {t("onDeviceAi.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
