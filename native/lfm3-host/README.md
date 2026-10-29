# Optional LFM3 speech runtime

This sidecar supplies one provider to Plethora's existing TTS adapter. It owns
inference only. The reader and Audio Editions retain their existing playback,
cache and job behavior.

Build on the desktop target's native machine with CMake 3.24+, a C++17 compiler,
Rust and Node:

```sh
npm run build:lfm3
```

The builder fetches llama.cpp at the commit and SHA-256 in `CMakeLists.txt`.
It stages the target-suffixed executable, dynamic backends, dependency libraries
and notices under `src-tauri/bin/`. Tauri development and packaging hooks call
`--ensure`, reusing a matching build. Generated runtimes are ignored by Git.
End users do not build anything or install a development toolkit.

CPU backend variants select a compatible instruction set at runtime. Metal is
enabled by upstream on macOS. To build an optional CUDA package, set
`CUDAToolkit_ROOT` to an installed NVIDIA toolkit and run:

```sh
npm run build:lfm3 -- --cuda
```

The CUDA build stages its redistribution libraries and license; it still
contains CPU backends for systems without an available CUDA device/driver.
Leave `LFM3_CUDA_ARCHITECTURES` unset for portable upstream CUDA architecture
defaults. `native` is a development-only build override, never a release setting.
`LFM3_BUILD_DIR` can select an external build directory. Cross packaging requires
a previously staged matching target. Android/iOS builds skip this desktop host.
Windows and macOS have source/build paths; physical execution has currently been
checked on Linux only. Do not infer a platform qualification from that check.

## Model installation and protocol

Settings uses the existing HF manager for the exact pinned Q4_K_M backbone,
Q8_0 audio projector and license. See `src-tauri/src/models/hf/lfm3.rs` for the
immutable revision, sizes and hashes. Weights are optional downloads, never
bundled. Model rights and native dependency notices are separate obligations.

The parent passes canonical app-managed model paths, an output directory and a
trusted runtime-library directory. The host reports protocol 1 and its pinned
runtime commit, then accepts newline-delimited JSON requests with `id`, `text`,
`voice` and `language`. Responses refer only to `<id>.wav` inside the output root.
The host never opens a network listener or plays audio. It keeps weights warm,
clears utterance state and emits PCM16 mono 24 kHz WAV only after generation EOS.
Both protocol frames and output lengths are bounded. Rust validates the actual
WAV and removes its temporary file after reading it. Cancellation, unload and
app exit kill/reap the process; the next request loads it again. Concurrent
reader prefetch shares one serialized host. Model removal refuses active work.

The optional real-model smoke downloads nothing and needs explicitly supplied
existing weights:

```sh
python3 native/lfm3-host/smoke.py \
  src-tauri/bin/lfm3-host-<target> src-tauri/bin/lfm3-runtime \
  /path/to/LFM3-Audio-2B-Q4_K_M.gguf /path/to/mmproj-LFM3-Audio-2B-Q8_0.gguf
```

It verifies both voices and English locale variants, warm reuse, WAV headers,
invalid input refusal and process cancellation. Ordinary unit tests require no
weights. Evidence and validation limits live in the OpenSpec change directory.
