# Animated image fixture corpus

`oracle.json` is the expected coalesced presentation output for the GIFs and
the still-image regression. It records the logical dimensions, normalized
frame start/hold times, loop repeat count, and visible RGBA pixels. RGB values
under fully transparent pixels are intentionally ignored.

The fixtures cover duration-weighted blue/green palette dominance, optimized
partial-frame composition with restore-background disposal, transparent
patch accumulation, a finite loop seam, and the existing still-image route.
The nearby small PNGs are the source layers used to make the GIF fixtures.
`missing-lzw-end-code.gif` is a tiny decoder compatibility fixture: it has a
terminated GIF image-data block and a complete 2×2 frame, but no explicit LZW
end code. It is covered by decoder tests, not the presentation oracle.

The oracle was independently decoded with ImageMagick 7.1.2-34 Q16-HDRI and
FFmpeg n9.0.2. The decoders agreed on frame count, alpha coverage, and every
visible pixel in all fixtures. ImageMagick reports GIF delays of 10/90,
10/10/10, 10/10, and 20/10/20 centiseconds respectively; FFprobe reports the
finite-seam durations as 0.2/0.1/0.2 seconds. Those source delays map to the
normalized cycle durations in the oracle. The finite fixture carries a
Netscape repeat count of one, meaning two total plays.

This is a reference corpus, not a claim that any browser decoder is suitable
for untrusted input. Animated import remains gated on a bounded decoder and
packaged worker/canvas/storage probes.
