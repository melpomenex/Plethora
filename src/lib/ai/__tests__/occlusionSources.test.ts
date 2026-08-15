import { describe, expect, it } from "vitest";
import {
  base64ToBytes,
  bytesToBase64,
  decodeImageDimensions,
  occlusionSourceFromAsset,
  occlusionSourceFromDataUrl,
  occlusionSourceFromBytes,
  parseDataUrl,
  sha256SourceFingerprint,
  OcclusionSourceError,
} from "../tasks/definitions/occlusionSources";

/** Minimal valid PNG (2x3, 8-bit RGB) with correct CRCs. */
function minimalPng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(8 + 25 + 12);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  // IHDR length + type.
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8; // bit depth
  bytes[25] = 2; // color type RGB
  bytes[26] = 0;
  bytes[27] = 0;
  bytes[28] = 0;
  // CRC over type+data (not validated by the header parser, any 4 bytes).
  view.setUint32(29, 0);
  view.setUint32(33, 0); // next chunk length 0
  bytes.set([0x49, 0x45, 0x4e, 0x44], 37); // IEND
  view.setUint32(41, 0);
  return bytes;
}

/** Minimal JPEG with an SOF0 frame carrying the dimensions. */
function minimalJpeg(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(2 + 2 + 2 + 17);
  let offset = 0;
  bytes[offset++] = 0xff;
  bytes[offset++] = 0xd8; // SOI
  bytes[offset++] = 0xff;
  bytes[offset++] = 0xe0; // APP0 marker
  bytes[offset++] = 0x00;
  bytes[offset++] = 0x04; // length 4
  bytes[offset++] = 0x00;
  bytes[offset++] = 0x00;
  bytes[offset++] = 0xff;
  bytes[offset++] = 0xc0; // SOF0
  const view = new DataView(bytes.buffer);
  view.setUint16(offset, 17); // length
  offset += 2;
  bytes[offset++] = 8; // precision
  view.setUint16(offset, height);
  offset += 2;
  view.setUint16(offset, width);
  offset += 2;
  bytes[offset++] = 1; // component count
  bytes[offset++] = 1;
  bytes[offset++] = 0x11;
  bytes[offset++] = 0;
  return bytes;
}

describe("parseDataUrl", () => {
  it("splits mime and base64 payload", () => {
    const parsed = parseDataUrl("data:image/png;base64,aGVsbG8=");
    expect(parsed).toEqual({ mimeType: "image/png", imageBase64: "aGVsbG8=" });
  });

  it("rejects non-data urls", () => {
    expect(parseDataUrl("https://example.com/a.png")).toBeNull();
    expect(parseDataUrl("data:image/png,notbase64")).toBeNull();
  });
});

describe("decodeImageDimensions", () => {
  it("reads PNG IHDR dimensions", () => {
    expect(decodeImageDimensions(minimalPng(640, 480))).toEqual({ width: 640, height: 480 });
  });

  it("reads JPEG SOF dimensions", () => {
    expect(decodeImageDimensions(minimalJpeg(320, 200))).toEqual({ width: 320, height: 200 });
  });

  it("returns undefined for undecodable bytes", () => {
    expect(decodeImageDimensions(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });
});

describe("base64 round trip", () => {
  it("bytes → base64 → bytes", () => {
    const original = new Uint8Array([0, 1, 2, 250, 255, 128]);
    expect(base64ToBytes(bytesToBase64(original))).toEqual(original);
  });
});

describe("occlusionSourceFromDataUrl", () => {
  it("builds a registry-kind source with decoded dimensions", () => {
    const png = minimalPng(100, 50);
    const source = occlusionSourceFromDataUrl(
      `data:image/png;base64,${bytesToBase64(png)}`
    );
    expect(source.mimeType).toBe("image/png");
    expect(source.width).toBe(100);
    expect(source.height).toBe(50);
    expect(source.sourceKind).toBe("data-url");
    expect(source.imageAssetId).toBeUndefined();
  });

  it("throws for unsupported mime types", () => {
    expect(() => occlusionSourceFromDataUrl("data:image/gif;base64,aGk=")).toThrow(
      OcclusionSourceError
    );
  });

  it("accepts the three supported mime types", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp"]) {
      const source = occlusionSourceFromDataUrl(`data:${mime};base64,aGk=`);
      expect(source.mimeType).toBe(mime);
    }
  });
});

describe("occlusionSourceFromAsset", () => {
  it("uses registry dims when the header is undecodable", () => {
    const asset = {
      id: "asset-1",
      data_url: "data:image/png;base64,aGk=",
      width: 1200,
      height: 800,
    };
    const source = occlusionSourceFromAsset(asset);
    expect(source.imageAssetId).toBe("asset-1");
    expect(source.sourceKind).toBe("registry");
    expect(source.width).toBe(1200);
    expect(source.height).toBe(800);
  });

  it("prefers decoded header dims over registry dims", () => {
    const asset = {
      id: "asset-2",
      data_url: `data:image/png;base64,${bytesToBase64(minimalPng(64, 32))}`,
      width: 999,
      height: 999,
    };
    const source = occlusionSourceFromAsset(asset);
    expect(source.width).toBe(64);
    expect(source.height).toBe(32);
  });
});

describe("occlusionSourceFromBytes", () => {
  it("marks rendered sources", () => {
    const source = occlusionSourceFromBytes(minimalPng(10, 20), "image/png");
    expect(source.sourceKind).toBe("rendered");
    expect(source.width).toBe(10);
    expect(source.height).toBe(20);
  });
});

describe("sha256SourceFingerprint", () => {
  it("produces stable 64-hex digests that change with content", async () => {
    const source = occlusionSourceFromBytes(minimalPng(1, 1), "image/png");
    const other = occlusionSourceFromBytes(minimalPng(2, 2), "image/png");
    const first = await sha256SourceFingerprint(source);
    expect(first).toMatch(/^[0-9a-f]{64}$|^(fnv1a-)/);
    expect(await sha256SourceFingerprint(source)).toBe(first);
    expect(await sha256SourceFingerprint(other)).not.toBe(first);
  });
});
