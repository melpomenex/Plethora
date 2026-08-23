import { createDocument, updateDocumentContent } from "../../../api/documents";
import type { SpeechProvider, Transcript } from "../capabilities/speech";
import { requirePersistedSpeechSource } from "./speechProvider";

export interface LectureCaptureResult {
  documentId: string;
  audioUri: string;
  transcript?: Transcript;
  incomplete: boolean;
}

/** Persist the recording before any transcription attempt. */
export async function persistLectureRecording(blob: Blob): Promise<string> {
  const stamp = Date.now();
  let objectUrl = `blob:lecture-${stamp}`;
  try {
    if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      objectUrl = URL.createObjectURL(blob);
    }
  } catch {
    /* jsdom / tests may not implement blob URLs */
  }
  return `plethora-lecture:${stamp}:${objectUrl}`;
}

export async function saveLectureDocument(options: {
  audioUri: string;
  transcript?: Transcript;
  speech?: SpeechProvider;
}): Promise<LectureCaptureResult> {
  const audioUri = requirePersistedSpeechSource(options.audioUri);
  let transcript = options.transcript;
  let incomplete = !transcript;
  if (!transcript && options.speech) {
    try {
      transcript = await options.speech.transcribeAudio({ sourceUri: audioUri });
      incomplete = Boolean(transcript.incomplete);
    } catch {
      incomplete = true;
    }
  }
  const text = transcript?.segments.map((s) => s.text).join("\n").trim() || "";
  const title = `Lecture ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const doc = await createDocument(title, audioUri, "markdown");
  const body = [
    text || "*(recording saved; transcription incomplete)*",
    "",
    `Audio: ${audioUri}`,
  ].join("\n");
  await updateDocumentContent(doc.id, body);
  return { documentId: doc.id, audioUri, transcript, incomplete };
}
