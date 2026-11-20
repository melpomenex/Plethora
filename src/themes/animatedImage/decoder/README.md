# GIF decoder WebAssembly module

This small module uses the repository-locked `gif` 0.13.3 Rust crate. The crate
is licensed MIT OR Apache-2.0. It emits decoded indexed patches one frame at a
time; JavaScript applies palette, transparency, disposal and canvas composition.
It enables strict LZW end-code and frame consistency checks and bounds each
decoded patch to the source pixel limit. The caller must still run structural
preflight and enforce cumulative frame, timeline and work limits.

Rebuild with the pinned crate and no network access:

```sh
sfw cargo build --manifest-path src/themes/animatedImage/decoder/Cargo.toml \
  --target wasm32-unknown-unknown --release --offline
cp src/themes/animatedImage/decoder/target/wasm32-unknown-unknown/release/plethora_gif_decoder.wasm \
  src/themes/animatedImage/decoder/gif-decoder.wasm
```

The checked-in Wasm is loaded lazily by the animated-image worker. Its public
functions use caller-owned memory: `alloc`, `dealloc`, `decoder_new`,
`decoder_info`, `decoder_next`, and `decoder_free`. Negative return values are
bounded decoder failures and must never enter playback.

`decoder_next` writes a 20-byte frame header. Byte 11 is the transparency
palette index and byte 12 is an explicit 0/1 presence flag; every `u8` value,
including 255, remains available as a valid palette index.
