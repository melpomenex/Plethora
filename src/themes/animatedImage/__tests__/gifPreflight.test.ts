import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { preflightGif } from "../gifPreflight";

const fixture = (name: string) => new Uint8Array(
  readFileSync(resolve(process.cwd(), `src/themes/animatedImage/fixtures/${name}`))
);

describe("GIF structural preflight", () => {
  it("normalizes fixture timing, disposal metadata, alpha and loop intent", () => {
    const palette = preflightGif(fixture("palette-dominance.gif"));
    expect(palette).toMatchObject({ width: 4, height: 4, durationMs: 1_000, plays: "infinite" });
    expect(palette.frames.map(({ delayMs }) => delayMs)).toEqual([100, 900]);

    const disposal = preflightGif(fixture("disposal-background.gif"));
    expect(disposal.durationMs).toBe(300);
    expect(disposal.frames.map(({ disposal: mode }) => mode)).toEqual([1, 2, 2]);
    expect(disposal.transparentCanvas).toBe(true);

    const finite = preflightGif(fixture("finite-loop-seam.gif"));
    expect(finite.durationMs).toBe(500);
    expect(finite.plays).toBe(2);
    expect(finite.frames.map(({ delayMs }) => delayMs)).toEqual([200, 100, 200]);
  });

  it("rejects truncated data, trailing bytes, and bad frame rectangles", () => {
    const valid = fixture("palette-dominance.gif");
    expect(() => preflightGif(valid.subarray(0, valid.length - 1))).toThrow(/ends inside|trailer/i);
    expect(() => preflightGif(new Uint8Array([...valid, 0]))).toThrow(/trailing data/i);

    const outOfBounds = valid.slice();
    const imageDescriptor = outOfBounds.indexOf(0x2c);
    outOfBounds[imageDescriptor + 1] = 4;
    expect(() => preflightGif(outOfBounds)).toThrow(/extends outside/i);
  });

  it("rejects unsupported text rendering and oversized inputs before decode", () => {
    const valid = fixture("palette-dominance.gif");
    const noPaletteHeader = valid.slice(0, 13);
    noPaletteHeader[10] = 0;
    const textExtension = new Uint8Array([...noPaletteHeader, 0x21, 0x01]);
    expect(() => preflightGif(textExtension)).toThrow(/text rendering/i);
    expect(() => preflightGif(new Uint8Array(16 * 1024 * 1024 + 1))).toThrow(/16 MiB/i);
  });
});
