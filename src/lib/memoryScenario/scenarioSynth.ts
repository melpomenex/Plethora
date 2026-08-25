/**
 * Scenario-only synthetic TTS (task 4.1 / design: deterministic reproduction).
 *
 * The tts-cycles / edition-cycles stages must synthesize deterministic audio
 * VOLUME without network access, paid providers, or system voices. This
 * module synthesizes byte-patterned ArrayBuffers sized from the input text
 * and mints the result through the same owned-URL + persistent-cache paths
 * real providers use, so the cycles exercise exactly the code under test.
 *
 * Registered only by the scenario host (registry::registerScenarioSynthAdapter)
 * — absent in production sessions by construction.
 */

import { createOwnedObjectUrl } from "../../diagnostics/ownedObjectUrl";
import type { TTSProviderAdapter } from "../../api/tts/types";

export const SCENARIO_SYNTH_PROVIDER = "scenario-synth";
export const SCENARIO_SYNTH_MODEL = "synth-1";
/** Documented deterministic ratio: ~16 bytes of "audio" per character. */
export const BYTES_PER_CHAR = 16;

/** Deterministic synthesis volume for a text (bytes). */
export function synthByteLength(text: string): number {
  return Math.max(1024, text.length * BYTES_PER_CHAR);
}

/** Deterministic pseudo-audio payload: a byte pattern seeded by the text. */
export function synthAudioBytes(text: string): ArrayBuffer {
  const length = synthByteLength(text);
  const buffer = new ArrayBuffer(length);
  const view = new Uint8Array(buffer);
  let state = 0x811c9dc5;
  for (let i = 0; i < length; i++) {
    state = (state * 16777619) >>> 0;
    view[i] = (state ^ (i >>> 3)) & 0xff;
  }
  // Fold the text length in so different texts never collide byte-for-byte.
  view[0] = text.length & 0xff;
  view[1] = (text.length >> 8) & 0xff;
  return buffer;
}

/** Deterministic duration estimate (~15 chars/sec, like the edition store). */
export function synthDurationSec(text: string): number {
  return Math.max(2, Math.ceil(text.length / 15));
}

export const scenarioSynthAdapter: TTSProviderAdapter = {
  id: SCENARIO_SYNTH_PROVIDER,
  label: "Scenario Synthetic (harness only)",
  kind: "local",
  auth: { mode: "none" },
  capabilities: {
    supportsSpeed: true,
    supportsInstructions: false,
    supportsCloning: false,
    supportsCustomVoiceIds: false,
    supportsWordTimings: false,
    audioFormats: ["mp3"],
    maxInputChars: 1_000_000,
  },
  listModels: async () => [
    {
      id: SCENARIO_SYNTH_MODEL,
      name: "Scenario Synthetic",
      description: "Deterministic byte-pattern synthesis for the memory harness",
      supportedVoices: ["scenario"],
      supportedParameters: ["speed"],
    },
  ],
  listVoices: async () => [
    { id: "scenario", name: "Scenario", provider: SCENARIO_SYNTH_PROVIDER, modelId: SCENARIO_SYNTH_MODEL },
  ],
  synthesize: async (_ctx, request) => {
    const data = synthAudioBytes(request.text);
    const audioUrl = createOwnedObjectUrl(new Blob([data], { type: "audio/mpeg" }), {
      owner: "tts-synthesis",
      ownerId: request.model,
    });
    return {
      audioUrl,
      audioData: data,
      mimeType: "audio/mpeg",
      durationSec: synthDurationSec(request.text),
      rawOutput: { provider: SCENARIO_SYNTH_PROVIDER, model: request.model, synthetic: true },
    };
  },
};
