const MIME_TO_EXTENSION: Record<string, string> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
  "audio/aac": "aac",
};

export function audioFilename(audio: File | Blob): string {
  if (audio instanceof File && audio.name.trim()) return audio.name;
  const extension = MIME_TO_EXTENSION[audio.type] || "wav";
  return `audio.${extension}`;
}

export function secondsToMs(value: number): number {
  return Math.round(value * 1000);
}
