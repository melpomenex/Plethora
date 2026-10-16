import type { AppleComposerDictationStart, DictationCapability } from "../../speech/contracts";
import { acquireAudioCapture } from "../../speech/captureOwner";
let releaseLiveCapture: (() => void) | undefined;
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

export async function appleDictationStatus(locale?: string): Promise<DictationCapability> {
  return invokeApple("apple_speech_dictation_status", { payload: { locale } });
}

export async function appleStartLiveSpeech(options?: AppleComposerDictationStart) {
  const release = acquireAudioCapture();
  releaseLiveCapture = release;
  try {
    return options ? await invokeApple("apple_speech_start_live", { payload: options }) : await invokeApple("apple_speech_start_live");
  } catch (error) {
    release(); if (releaseLiveCapture === release) releaseLiveCapture = undefined;
    throw appleErrorFromUnknown(error);
  }
}

export async function appleStopLiveSpeech(options?: Pick<AppleComposerDictationStart, "purpose" | "sessionId">) {
  try {
    return options ? await invokeApple("apple_speech_stop_live", { payload: options }) : await invokeApple("apple_speech_stop_live");
  } catch (error) {
    throw appleErrorFromUnknown(error);
  } finally { releaseLiveCapture?.(); releaseLiveCapture = undefined; }
}
