# Isolated native probe

This is an opt-in feasibility fixture, outside Plethora's source/dependency graph.
It is not a production host, installer or provider. It never downloads weights.
`spike.cpp` uses the pinned TTS template, depthformer and codec helpers, one loaded
backbone/projector, fresh utterance state and fixed synthetic text. Raw upstream
development logs are not the sanitized production protocol proposed in D1.

Put the verified source archive and model pair from `../inputs.lock.json` in
`~/.cache/plethora/lfm3-spike/` (or set `LFM3_SPIKE_ROOT` for the Python fixtures).
The actual development run used the default path. It requires a C++17 compiler,
CMake, Ninja and Python for the fixtures; these are not end-user dependencies.

From the repository root, reproduce the CPU build:

```bash
LFM3_SPIKE_ROOT="$HOME/.cache/plethora/lfm3-spike"
LFM3_SOURCE="$LFM3_SPIKE_ROOT/llama.cpp-ac8e1694d837b11ed0aab944a6a2eee34b9c4d80"
LFM3_BUILD="$LFM3_SPIKE_ROOT/build-cpu"
LFM3_FIXTURES="$PWD/openspec/changes/add-lfm3-audio-local-tts/evidence/spike"
cmake -S "$LFM3_SOURCE" -B "$LFM3_BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=OFF -DLLAMA_BUILD_APP=OFF \
  -DLLAMA_OPENSSL=OFF -DLLAMA_SUBPROCESS=OFF \
  -DGGML_CUDA=OFF -DGGML_NATIVE=ON -DMTMD_VIDEO=OFF
cmake --build "$LFM3_BUILD" --target llama-tts -j2
g++ -std=c++17 -O2 -Wall -Wextra -Werror -c "$LFM3_FIXTURES/spike.cpp" \
  -isystem"$LFM3_SOURCE/include" -isystem"$LFM3_SOURCE/common" \
  -isystem"$LFM3_SOURCE/ggml/include" -isystem"$LFM3_SOURCE/tools/mtmd" \
  -isystem"$LFM3_SOURCE/vendor" -o "$LFM3_SPIKE_ROOT/spike.o"
g++ "$LFM3_SPIKE_ROOT/spike.o" -o "$LFM3_SPIKE_ROOT/lfm3-spike" \
  -Wl,-rpath,"$LFM3_BUILD/bin" \
  "$LFM3_BUILD/bin/libllama-common.so" "$LFM3_BUILD/bin/libmtmd.so" \
  "$LFM3_BUILD/common/libllama-common-base.a" "$LFM3_BUILD/bin/libllama.so" \
  "$LFM3_BUILD/bin/libggml.so" "$LFM3_BUILD/bin/libggml-cpu.so" \
  "$LFM3_BUILD/bin/libggml-base.so"
```

Run the positive fixtures first, capturing stdout as `cpu-results.jsonl`:

```bash
"$LFM3_SPIKE_ROOT/lfm3-spike" \
  "$LFM3_SPIKE_ROOT/LFM3-Audio-2B-Q4_K_M.gguf" \
  "$LFM3_SPIKE_ROOT/mmproj-LFM3-Audio-2B-Q8_0.gguf" \
  "$LFM3_SPIKE_ROOT/output" \
  > "$LFM3_SPIKE_ROOT/cpu-results.jsonl" \
  2> "$LFM3_SPIKE_ROOT/cpu-run.log"
python3 "$LFM3_FIXTURES/check-probes.py"
```

Negative cases assert no published WAVs, request/load cancellation, EOS cap
failure, control-token rejection and a bounded kill/reap of a tiny unresponsive
fixture. The forced-kill case is a supervisor experiment, not a production
supervisor or proof of CUDA/Metal kernel cancellation. Positive WAV frame counts
must include the final codec tail, and the repeated request must be byte-identical
after intervening voices/locales. Human locale/voice quality and the long-run
validation matrix are separate acceptance work.

## CUDA target (RTX 2060 SUPER)

The GPU continuation installs only the pinned NVIDIA redistribution components in
`$LFM3_SPIKE_ROOT/cuda-toolkit/install`; see `../cuda-toolkit.lock.json`. No system
driver or system compiler installation is changed. Configure a separate build:

```bash
LFM3_CUDA="$LFM3_SPIKE_ROOT/cuda-toolkit/install"
LFM3_CUDA_BUILD="$LFM3_SPIKE_ROOT/build-cuda"
cmake -S "$LFM3_SOURCE" -B "$LFM3_CUDA_BUILD" -G Ninja \
  -DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_TESTS=OFF \
  -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_SERVER=OFF -DLLAMA_BUILD_APP=OFF \
  -DLLAMA_OPENSSL=OFF -DLLAMA_SUBPROCESS=OFF -DMTMD_VIDEO=OFF \
  -DGGML_CUDA=ON -DGGML_NATIVE=ON -DGGML_CUDA_NCCL=OFF \
  -DCMAKE_CUDA_ARCHITECTURES=75-real -DCUDAToolkit_ROOT="$LFM3_CUDA" \
  -DCMAKE_CUDA_COMPILER="$LFM3_CUDA/bin/nvcc"
cmake --build "$LFM3_CUDA_BUILD" --target llama-tts -j4
```

Compile `spike.cpp` with `-DLFM3_SPIKE_CUDA=1`, using upstream include paths as
system headers and the CUDA build's libraries/RPATH, and name the binary
`lfm3-spike-cuda`. The CUDA probe requires an actual CUDA device, assigns it to
both the backbone and projector, and requests all backbone layers on GPU.

Capture its `voices` run as `cuda-results.jsonl`, with output directory
`cuda-output`. Then run `LFM3_SPIKE_BACKEND=cuda python3 "$LFM3_FIXTURES/check-probes.py"`.
CPU and CUDA fixtures use separate files. GPU repeat-byte equality is reported
but is not a cross-backend determinism guarantee.

`run-cuda-benchmark.py` uses the existing pinned weights, 30 warm starts, the
fixed 1,000-word corpus and 30 minutes of sustained generation on one loaded
model. It records native file-ready latency, RSS/PSS and sampled GPU allocation,
power, temperature and clocks. It does not measure application first-audible
latency, seams or UI responsiveness; those need the integrated playback path.
The sustained output overwrites one synthetic current clip, bounding disk use.
