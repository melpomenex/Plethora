import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { initializeStrictGifDecoder, type GifDecoderWasmExports } from "../gifDecoder";

const wasmBytes = readFileSync(resolve(
  process.cwd(),
  "src/themes/animatedImage/decoder/gif-decoder.wasm"
));
const fixture = () => new Uint8Array(readFileSync(resolve(
  process.cwd(),
  "src/themes/animatedImage/fixtures/palette-dominance.gif"
)));
const readFixture = (name: string) => new Uint8Array(readFileSync(resolve(
  process.cwd(),
  `src/themes/animatedImage/fixtures/${name}`
)));

async function decoderFor(bytes: Uint8Array) {
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  return initializeStrictGifDecoder(instance.exports as unknown as GifDecoderWasmExports, bytes);
}

describe("bounded GIF decoder WASM", () => {
  it.each([
    ["valid palette index 255", 255, 1, 255],
    ["no transparency", 255, 0, null],
  ] as const)("preserves transparency metadata for %s", (_name, transparentIndex, present, expected) => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    let nextPointer = 1024;
    const exports: GifDecoderWasmExports = {
      memory,
      alloc(capacity) {
        const pointer = nextPointer;
        nextPointer += capacity + 8;
        return pointer;
      },
      dealloc() {},
      decoder_new() { return 1; },
      decoder_info(_handle, pointer) {
        const view = new DataView(memory.buffer, pointer, 16);
        view.setInt32(0, 1, true);
        view.setInt32(4, 1, true);
        view.setInt32(8, 0, true);
        view.setInt32(12, 0, true);
        return 0;
      },
      decoder_next(_handle, pointer) {
        const paletteLength = 256 * 3;
        const length = 20 + paletteLength + 1;
        const view = new DataView(memory.buffer, pointer, length);
        view.setUint16(4, 1, true);
        view.setUint16(6, 1, true);
        view.setUint8(10, 0);
        view.setUint8(11, transparentIndex);
        view.setUint8(12, present);
        view.setUint16(14, paletteLength, true);
        view.setUint32(16, 1, true);
        new Uint8Array(memory.buffer, pointer + 20, paletteLength).fill(0);
        new Uint8Array(memory.buffer, pointer + 20 + paletteLength, 1)[0] = 255;
        return length;
      },
      decoder_free() {},
    };
    const decoder = initializeStrictGifDecoder(exports, new Uint8Array([0]));

    try {
      expect(decoder.next()?.transparentIndex).toBe(expected);
    } finally {
      decoder.close();
    }
  });

  it("decodes indexed frame patches in order with normalized header metadata", async () => {
    const decoder = await decoderFor(fixture());
    try {
      expect(decoder.info).toEqual({ width: 4, height: 4, plays: "infinite" });
      const frames = [];
      for (let frame = decoder.next(); frame; frame = decoder.next()) frames.push(frame);

      expect(frames).toHaveLength(2);
      expect(frames.map(({ delayCentiseconds, width, height, disposal }) => ({
        delayCentiseconds, width, height, disposal,
      }))).toEqual([
        { delayCentiseconds: 10, width: 4, height: 4, disposal: 0 },
        { delayCentiseconds: 90, width: 4, height: 4, disposal: 0 },
      ]);
      expect(new Set(frames[0].indices).size).toBe(1);
      expect(new Set(frames[1].indices).size).toBe(1);
    } finally {
      decoder.close();
    }
  });

  it("rejects a structurally valid frame with corrupt LZW codes", async () => {
    const bytes = fixture();
    const lzwSequence = new Uint8Array([0x02, 0x04, 0x84, 0x8f, 0x09, 0x05, 0x00]);
    let payloadOffset = -1;
    for (let index = 0; index <= bytes.length - lzwSequence.length; index += 1) {
      if (lzwSequence.every((value, byte) => bytes[index + byte] === value)) {
        payloadOffset = index;
        break;
      }
    }
    expect(payloadOffset).toBeGreaterThanOrEqual(0);
    bytes.fill(0, payloadOffset + 2, payloadOffset + 6);

    const decoder = await decoderFor(bytes);
    try {
      expect(() => decoder.next()).toThrow(/invalid or truncated frame data/i);
    } finally {
      decoder.close();
    }
  });

  it("decodes a complete frame whose LZW data omits the end code", async () => {
    const decoder = await decoderFor(readFixture("missing-lzw-end-code.gif"));
    try {
      expect(decoder.info).toEqual({ width: 2, height: 2, plays: 1 });
      const frame = decoder.next();
      expect(frame).not.toBeNull();
      expect(frame?.indices).toEqual(new Uint8Array([0, 1, 0, 1]));
      expect(decoder.next()).toBeNull();
    } finally {
      decoder.close();
    }
  });

  it.each([
    ["disposal-background.gif", 3, "infinite"],
    ["alpha-transparency.gif", 2, "infinite"],
    ["finite-loop-seam.gif", 3, 2],
  ] as const)("decodes within bounds %s", async (name, expectedFrames, plays) => {
    const decoder = await decoderFor(readFixture(name));
    try {
      expect(decoder.info.plays).toBe(plays);
      let count = 0;
      while (decoder.next()) count += 1;
      expect(count).toBe(expectedFrames);
    } finally {
      decoder.close();
    }
  });
});
