/**
 * Chatterbox local TTS helpers for Audio Edition creation.
 *
 * The local Chatterbox Turbo service (`http://localhost:8000/v1`) speaks an
 * OpenAI-compatible dialect with three quirks the generic adapter does not
 * assume: output is always 24 kHz mono 16-bit WAV, there is no speed
 * parameter, and long inputs are slow enough (and heavy enough on 8 GB
 * cards) that requests must stay small and strictly serialized.
 */

import type { Platform } from "../lib/tauri";
import { getPlatform } from "../lib/tauri";

export const CHATTERBOX_PROVIDER_ID = "openai-compatible";
export const CHATTERBOX_MODEL_ID = "chatterbox-turbo";
export const CHATTERBOX_DEFAULT_VOICE = "default";
/** Per-request character cap: bounds Turbo inference latency and VRAM.
 * 500, not 1000: the s3gen attention kernels segfaulted on a ~976-char
 * request (quadratic memory in sequence length), killing the whole service.
 * The server enforces the same cap itself, so this stays in sync with it. */
export const CHATTERBOX_MAX_CHARS_PER_REQUEST = 500;

export interface ChatterboxHealthOptions {
  /** Override OS detection (tests, unusual runtimes). Defaults to getPlatform(). */
  platform?: Platform;
}

function recoveryHint(baseUrl: string, platform: Platform): string {
  const generic =
    `Check Settings → Text To Speech → Base URL and make sure the server behind ${baseUrl} is running, then retry.`;
  // The app cannot know how a user self-hosts their server; on Linux the
  // common shape is a systemd user service, so offer it as an example only.
  if (platform === "linux") {
    return `${generic} If you run it as a systemd user service, start it first (e.g. systemctl --user start chatterbox-tts).`;
  }
  return generic;
}

export interface ChatterboxHealth {
  ok: boolean;
  /** Human-readable failure reason (for inline dialog errors). */
  error?: string;
}

/**
 * Probe the local Chatterbox service. Never throws: unreachable service is
 * an expected state (service not started) and surfaces as `{ ok: false }`.
 */
export async function checkChatterboxHealth(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000,
  options: ChatterboxHealthOptions = {}
): Promise<ChatterboxHealth> {
  const norm = baseUrl.trim().replace(/\/+$/, "");
  if (!norm) {
    return { ok: false, error: "No Chatterbox base URL configured." };
  }
  // The health endpoint lives at the server root, while OpenAI-style base
  // URLs carry a /v1 suffix (http://host:8000/v1 + /health would 404).
  const healthUrl = `${norm.replace(/\/v1\/?$/, "")}/health`;
  const platform = options.platform ?? getPlatform();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(healthUrl, { signal: controller.signal });
    if (!res.ok) {
      return {
        ok: false,
        error: `Chatterbox service at ${norm} answered ${res.status}. ${recoveryHint(norm, platform)}`,
      };
    }
    return { ok: true };
  } catch {
    return {
      ok: false,
      error: `Cannot reach the Chatterbox service at ${norm}. ${recoveryHint(norm, platform)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Split text into sentence-aware chunks of at most `maxChars` characters.
 * Sentences are detected on `.`/`?`/`!` followed by whitespace (or the end
 * of input); an over-long single sentence is hard-split. Returns at least
 * one chunk for non-empty input, never empty chunks.
 */
export function splitTextForChatterbox(
  text: string,
  maxChars: number = CHATTERBOX_MAX_CHARS_PER_REQUEST
): string[] {
  const input = text.trim();
  if (!input) return [];
  if (input.length <= maxChars) return [input];

  const sentences = input.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [input];
  const chunks: string[] = [];
  let current = "";

  const push = (s: string) => {
    const t = s.trim();
    if (t) chunks.push(t);
  };

  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    // Hard-split pathological single sentences (no terminal punctuation).
    if (sentence.length > maxChars) {
      if (current) {
        push(current);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += maxChars) {
        push(sentence.slice(i, i + maxChars));
      }
      continue;
    }
    if ((current + " " + sentence).trim().length > maxChars && current) {
      push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  push(current);
  return chunks;
}

interface WavParams {
  sampleRate: number;
  numChannels: number;
  bitsPerSample: number;
}

/**
 * Parse a 16-bit PCM WAV buffer, returning header params + raw PCM payload.
 * Supports the canonical 44-byte header and extended headers with extra
 * chunks before `data` (walks sub-chunks). Returns null when unparseable.
 */
function parseWav(buffer: ArrayBuffer): { params: WavParams; pcm: Uint8Array } | null {
  const view = new DataView(buffer);
  if (buffer.byteLength < 44) return null;
  const ascii = (off: number, len: number) => {
    let s = "";
    for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(off + i));
    return s;
  };
  if (ascii(0, 4) !== "RIFF" || ascii(8, 4) !== "WAVE" || ascii(12, 4) !== "fmt ") return null;
  if (view.getUint16(20, true) !== 1) return null; // PCM only
  const params: WavParams = {
    numChannels: view.getUint16(22, true),
    sampleRate: view.getUint32(24, true),
    bitsPerSample: view.getUint16(34, true),
  };
  if (params.bitsPerSample !== 16) return null;
  // Walk sub-chunks from offset 36 to find "data".
  let off = 36;
  while (off + 8 <= buffer.byteLength) {
    const id = ascii(off, 4);
    const size = view.getUint32(off + 4, true);
    if (id === "data") {
      return { params, pcm: new Uint8Array(buffer, off + 8, Math.min(size, buffer.byteLength - off - 8)) };
    }
    off += 8 + size;
  }
  return null;
}

/**
 * Concatenate same-format 16-bit PCM WAV buffers (as returned by sequential
 * Chatterbox chunk syntheses) into a single WAV. Throws on format mismatch
 * or unparseable input so callers fail loudly instead of writing garbage.
 */
export function concatenateWavBlobs(parts: ArrayBuffer[]): ArrayBuffer {
  if (parts.length === 0) throw new Error("Nothing to concatenate.");
  const parsed = parts.map((p, i) => {
    const r = parseWav(p);
    if (!r) throw new Error(`Chunk ${i + 1}/${parts.length} is not a supported 16-bit PCM WAV.`);
    return r;
  });
  const first = parsed[0].params;
  for (let i = 1; i < parsed.length; i++) {
    const p = parsed[i].params;
    if (p.sampleRate !== first.sampleRate || p.numChannels !== first.numChannels || p.bitsPerSample !== first.bitsPerSample) {
      throw new Error(`Chunk ${i + 1} format mismatch; cannot concatenate.`);
    }
  }
  const totalPcm = parsed.reduce((n, p) => n + p.pcm.byteLength, 0);
  const out = new ArrayBuffer(44 + totalPcm);
  const view = new DataView(out);
  const writeAscii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + totalPcm, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, first.numChannels, true);
  view.setUint32(24, first.sampleRate, true);
  view.setUint32(28, (first.sampleRate * first.numChannels * first.bitsPerSample) / 8, true);
  view.setUint16(32, (first.numChannels * first.bitsPerSample) / 8, true);
  view.setUint16(34, first.bitsPerSample, true);
  writeAscii(36, "data");
  view.setUint32(40, totalPcm, true);
  const bytes = new Uint8Array(out);
  let off = 44;
  for (const p of parsed) {
    bytes.set(p.pcm, off);
    off += p.pcm.byteLength;
  }
  return out;
}
