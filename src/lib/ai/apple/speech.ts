import { invokeApple } from "./plugin";
import { appleErrorFromUnknown } from "./errors";
import { getAppleIntelligenceSnapshot } from "./capabilities";

export async function isAppleSpeechReady(): Promise<boolean> {
  const snap = await getAppleIntelligenceSnapshot();
  return snap.speech.status === "available";
}

export async function appleTranscribeFile(path: string, locale?: string) {
  try {
    return await invokeApple<{
      text: string;
      segments: Array<{ id: string; text: string; startMs: number; endMs: number }>;
      source?: string;
    }>("apple_speech_transcribe_file", { payload: { path, locale } });
  } catch (error) {
    throw appleErrorFromUnknown(error);
  }
}

export async function appleStartLiveSpeech() {
  try {
    return await invokeApple("apple_speech_start_live");
  } catch (error) {
    throw appleErrorFromUnknown(error);
  }
}

export async function appleStopLiveSpeech() {
  try {
    return await invokeApple("apple_speech_stop_live");
  } catch (error) {
    throw appleErrorFromUnknown(error);
  }
}
