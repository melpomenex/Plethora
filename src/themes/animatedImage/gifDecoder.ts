import decoderWasmUrl from "./decoder/gif-decoder.wasm?url";
import {
  AnimatedImagePreparationError,
  type AnimatedImageRepeatCount,
} from "./contracts";

const MAX_PATCH_BUFFER_BYTES = 20 + 768 + 2_073_600;

export interface GifDecoderWasmExports {
  readonly memory: WebAssembly.Memory;
  alloc(capacity: number): number;
  dealloc(pointer: number, capacity: number): void;
  decoder_new(inputPointer: number, inputLength: number): number;
  decoder_info(handle: number, outputPointer: number, outputLength: number): number;
  decoder_next(handle: number, outputPointer: number, outputCapacity: number): number;
  decoder_free(handle: number): void;
}

export interface StrictGifDecoderInfo {
  readonly width: number;
  readonly height: number;
  readonly plays: AnimatedImageRepeatCount;
}

export interface StrictGifFrame {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly delayCentiseconds: number;
  readonly disposal: 0 | 1 | 2 | 3;
  readonly transparentIndex: number | null;
  readonly palette: Uint8Array;
  readonly indices: Uint8Array;
}

export interface StrictGifDecoder {
  readonly info: StrictGifDecoderInfo;
  next(): StrictGifFrame | null;
  close(): void;
}

/** Lazily instantiate the bounded, strict GIF decoder inside the preparation worker. */
export async function createStrictGifDecoder(bytes: Uint8Array): Promise<StrictGifDecoder> {
  const wasmBytes = await fetch(decoderWasmUrl).then((response) => {
    if (!response.ok) throw new Error("GIF decoder module could not be loaded.");
    return response.arrayBuffer();
  });
  const { instance } = await WebAssembly.instantiate(wasmBytes, {});
  return initializeStrictGifDecoder(instance.exports as unknown as GifDecoderWasmExports, bytes);
}

export function initializeStrictGifDecoder(
  exports: GifDecoderWasmExports,
  bytes: Uint8Array
): StrictGifDecoder {
  const inputPointer = allocate(exports, bytes.byteLength);
  new Uint8Array(exports.memory.buffer, inputPointer, bytes.byteLength).set(bytes);
  let handle = 0;
  try {
    handle = exports.decoder_new(inputPointer, bytes.byteLength);
  } finally {
    exports.dealloc(inputPointer, bytes.byteLength);
  }
  if (handle <= 0) {
    throw decoderFailure("The GIF data could not be decoded safely.");
  }

  const infoPointer = allocate(exports, 16);
  const outputPointer = allocate(exports, MAX_PATCH_BUFFER_BYTES);
  if (exports.decoder_info(handle, infoPointer, 4) !== 0) {
    exports.decoder_free(handle);
    exports.dealloc(infoPointer, 16);
    exports.dealloc(outputPointer, MAX_PATCH_BUFFER_BYTES);
    throw decoderFailure("The GIF decoder could not read its header.");
  }
  const infoView = new DataView(exports.memory.buffer, infoPointer, 16);
  const repeatKind = infoView.getInt32(8, true);
  const repeatCount = infoView.getInt32(12, true);
  const info: StrictGifDecoderInfo = {
    width: infoView.getInt32(0, true),
    height: infoView.getInt32(4, true),
    plays: repeatKind === 1 ? "infinite" : repeatKind === 2 ? repeatCount + 1 : 1,
  };

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    exports.decoder_free(handle);
    exports.dealloc(infoPointer, 16);
    exports.dealloc(outputPointer, MAX_PATCH_BUFFER_BYTES);
  };

  return {
    info,
    next() {
      if (closed) return null;
      const length = exports.decoder_next(handle, outputPointer, MAX_PATCH_BUFFER_BYTES);
      if (length === 0) return null;
      if (length < 0) {
        close();
        throw decoderFailure("The GIF contains invalid or truncated frame data.");
      }
      const view = new DataView(exports.memory.buffer, outputPointer, length);
      const left = view.getUint16(0, true);
      const top = view.getUint16(2, true);
      const width = view.getUint16(4, true);
      const height = view.getUint16(6, true);
      const delayCentiseconds = view.getUint16(8, true);
      const disposalValue = view.getUint8(10);
      const transparentIndex = view.getUint8(11);
      const transparentPresent = view.getUint8(12);
      const paletteLength = view.getUint16(14, true);
      const indexLength = view.getUint32(16, true);
      const expectedLength = 20 + paletteLength + indexLength;
      if (
        expectedLength !== length ||
        width <= 0 || height <= 0 ||
        indexLength !== width * height ||
        paletteLength === 0 || paletteLength > 768 || paletteLength % 3 !== 0 ||
        disposalValue > 3 || transparentPresent > 1 ||
        (transparentPresent === 1 && transparentIndex >= paletteLength / 3)
      ) {
        close();
        throw decoderFailure("The GIF decoder returned an invalid frame.");
      }
      const paletteStart = 20;
      const indicesStart = paletteStart + paletteLength;
      return {
        left,
        top,
        width,
        height,
        delayCentiseconds,
        disposal: disposalValue as 0 | 1 | 2 | 3,
        transparentIndex: transparentPresent === 1 ? transparentIndex : null,
        palette: new Uint8Array(exports.memory.buffer, outputPointer + paletteStart, paletteLength).slice(),
        indices: new Uint8Array(exports.memory.buffer, outputPointer + indicesStart, indexLength).slice(),
      };
    },
    close,
  };
}

function allocate(exports: GifDecoderWasmExports, capacity: number): number {
  const pointer = exports.alloc(capacity) >>> 0;
  if (pointer === 0) throw decoderFailure("The GIF decoder ran out of memory.");
  return pointer;
}

function decoderFailure(message: string): AnimatedImagePreparationError {
  return new AnimatedImagePreparationError("decode-failed", message, {
    capability: "module-worker",
  });
}
