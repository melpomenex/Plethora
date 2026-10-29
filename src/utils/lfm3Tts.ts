/** Device-independent LFM3 configuration. Matches the pinned native/HF contract. */
export const LFM3_REPO = "LiquidAI/LFM3-Audio-2B-GGUF";
export const LFM3_REVISION = "642697a5597a675cb819ed236ac415c1e60a4f6f";
export const LFM3_MODEL_ID = `hf:llama-cpp-tts:${LFM3_REPO}@${LFM3_REVISION}`;
export const LFM3_PROFILE = "lfm3-audio-v1-q4km-q8-seed42";
export const LFM3_LANGUAGES = [
  ["en-US", "en", "English (US)"],
  ["en-GB", "en-gb", "English (UK)"],
  ["ar", "ar", "Arabic"],
  ["da", "da", "Danish"],
  ["de", "de", "German"],
  ["el", "el", "Greek"],
  ["es", "es", "Spanish"],
  ["fi", "fi", "Finnish"],
  ["fr", "fr", "French"],
  ["he", "he", "Hebrew"],
  ["it", "it", "Italian"],
  ["ja", "ja", "Japanese"],
  ["ko", "ko", "Korean"],
  ["nl", "nl", "Dutch"],
  ["pl", "pl", "Polish"],
  ["pt", "pt", "Portuguese"],
  ["sv", "sv", "Swedish"],
  ["tr", "tr", "Turkish"],
  ["zh", "zh", "Chinese"],
] as const;
export function lfm3Language(locale: string): string {
  const entry = LFM3_LANGUAGES.find(([id]) => id === locale);
  if (!entry) throw new Error("Choose a supported LFM3 language in Settings.");
  return entry[1];
}
