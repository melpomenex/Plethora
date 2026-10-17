# Baseline protocol and platform capability matrix

Task 0.3 supporting material. This file records the **recording protocol**, the **actual environment facts verified on 2026-10-17**, and the **provider/OS/WebView capability matrix** that later validation tasks must not exceed. Measured timing values are intentionally absent until a release build is measured per the protocol below; validation budgets in validation.md remain *proposed* until then.

## 1. Environment facts (verified, not estimated)

| Item | Verified value | How verified |
|---|---|---|
| Desktop host OS | Omarchy (Arch) v26.8.1, kernel 7.2.5-3-omarchy, x86_64 | `uname -a`, `/etc/os-release` |
| Desktop CPU/RAM | 24 threads, 23 GiB RAM | `nproc`, `free -h` |
| Desktop WebView engine | WebKitGTK 2.52.6 | `pkg-config --modversion webkit2gtk-4.1` |
| Toolchain | Node 11.19.0, cargo 1.89.0 | `node -v`, `cargo --version` |
| App revision measured | 3.3.0 at commit `42510d8cfb9aea18408a24e5fa6c4cc46163018e` | `package.json`, `src-tauri/tauri.conf.json` |
| Reference phone | Pixel 9 Pro XL, Android 17 (SDK 37) | `adb shell getprop` |
| Phone WebView | Vanadium WebView 155.0.8059.84.0 (min targetSdk 33) | `adb shell dumpsys webviewupdate` |
| Phone app build | com.plethora.app 3.3.0 (versionCode 3003000, targetSdk 36), last updated 2026-10-16 | `adb shell dumpsys package com.plethora.app` |

No macOS or Windows host is available in this environment; those platforms remain **outstanding release gates**, not measured rows. No measurement below is copied from any earlier session without re-running the protocol.

## 2. Recording protocol for timing budgets

For each supported platform, record in this order:

1. Build the release artifact from the exact commit (`npm run tauri:build:*` per platform), record artifact hash and build command.
2. Record the environment row above for the measuring machine (OS build, WebView version, CPU/RAM, storage type).
3. Warm-up: perform the measured flow at least 3 times unmeasured, then take **≥30 samples**; discard the first 3; report median and p95.
4. Cold invocation is measured separately: force-close the app (native) or hard-reload (browser), then measure lazy module load to interactive composer; never average cold samples into warm values.
5. Separate **UI-local** spans from **provider/network** spans. UI-local budgets (invoke→composer, input→paint, stop acknowledgment, draft durability, cached citation detail) must be measured with a stub/fixture provider that incurs no network.
6. Record provider time-to-first-event/first-visible-text per capability separately; do not fold it into UI budgets.
7. Attach a trace artifact per measured row: browser performance marks or native WebView timing. A row without a trace is not accepted.
8. **Privacy in traces:** traces may contain durations, counts, platform/provider capability and anonymous error codes only. Never question text, quotes, keys, file paths or raw model output.

Fixture set for the large-context journey: 1,000-page PDF, 3,000-item library metadata set, 1,000-message conversation fixture and a long timed transcript (fixtures F1–F4, section 4). Record fixture SHA-256 hashes with every measurement so budget comparisons are equivalent across runs.

Warm-up/cold distinction is mandatory: validation budgets apply to warm runs unless a row explicitly says cold; the cold lazy-invoke budget is p95 ≤500 ms on the recorded release fixture/device.

## 3. Provider / OS / WebView capability matrix

Capability fields mirror `AIModelCapabilities` in `src/lib/ai/providers/types.ts`. "Declared" is read from source at HEAD; "runtime-verified" rows require an actual session and are marked `—` until recorded. Streaming here means **plain chat streaming** (`streamChatWithLLM` / `llm_stream_chat`); context-bearing streaming does not exist yet (design D8, task 6.2) and must never be assumed from this column.

| Provider | ID | Platform | Text gen | Structured | Vision | Tools | Embeddings | Offline | Stream (plain chat) | Context-bearing stream |
|---|---|---|---|---|---|---|---|---|---|---|
| Gemini Nano (on-device) | `on-device` (android-genai) | Android 13+ device tiers | runtime snapshot | runtime snapshot | runtime snapshot (varies) | logical false | separate runtime | yes | snapshot.streaming | **not proposed yet** |
| Apple Foundation Models | `apple-foundation` | macOS/iOS with Apple Intelligence | ready-gated | ready-gated | no | no | no | yes | ready-gated (`streaming: false` in model info, streaming when ready) | **not proposed yet** |
| Apple Core AI | `apple-core-ai` | macOS 26/iOS 26 | ready-gated | — | no | no | no | yes | not exposed | **not proposed yet** |
| Windows System (Phi) | `windows-system` | Windows on supported hardware | lmReady-gated | — | no | no | no | yes | lmReady-gated | **not proposed yet** |
| Foundry Local | `foundry-local` | Windows/macOS/Linux host runtime | ready-gated | — | no | no | no | yes | ready-gated | **not proposed yet** |
| Local decision engine | `local-decision` | All | limited | no | no | no | no | yes | `streaming: false` | no |
| OpenAI | `openai` | Desktop/mobile via Tauri | yes | yes (JSON schema path) | yes | existing tools path | no | no | yes | **not proposed yet** |
| Anthropic | `anthropic` | Desktop/mobile via Tauri | yes | yes | yes | existing tools path | no | no | yes | **not proposed yet** |
| Gemini | `gemini` | Desktop/mobile via Tauri | yes | yes | yes | existing tools path | no | no | yes | **not proposed yet** |
| DeepSeek | `deepseek` | Desktop/mobile via Tauri | yes | yes | no (vision off) | existing tools path | no | no | yes | **not proposed yet** |
| OpenRouter | `openrouter` | Desktop/mobile via Tauri | model-dependent | model-dependent | model-dependent | model-dependent | no | no | yes | **not proposed yet** |
| Ollama (local host) | `ollama` | Desktop local network | yes | model-dependent | model-dependent | model-dependent | model-dependent | local host, not device | yes | **not proposed yet** |
| Ollama (custom/remote endpoint) | `ollama` + custom `baseUrl` | Any with network | yes | model-dependent | model-dependent | model-dependent | no | no | yes | **not proposed yet** |

Privacy rule enforced by this matrix: a custom/remote Ollama endpoint is *remote* for privacy purposes no matter how the provider is labeled (design D4). Capability rows that gate flags (`assistantTurnStreaming`, `assistantConversationSync`) must be recorded per platform before those flags default on.

OS / WebView rows relevant to the change:

| Platform | Shell | WebView | Assistant presentations to validate | Status |
|---|---|---|---|---|
| Linux desktop (this host) | Tauri + WebKitGTK 2.52.6 | WebKit | sidebar, Q&A workspace, palette, PWA-mode browser | available for measurement |
| macOS | Tauri + WKWebView | WKWebView | sidebar, workspace, palette | outstanding gate (no host) |
| Windows | Tauri + WebView2 | WebView2 | sidebar, workspace, palette | outstanding gate (no host) |
| Android (Pixel 9 Pro XL, Android 17) | Tauri + Vanadium WebView 155 | Chromium 155 | global host, selection Ask, dictation | device available for measurement |
| iOS | Tauri + WKWebView | WKWebView | global host, selection Ask, dictation | outstanding gate (no device) |

## 4. Fixture corpus (task 0.4 cross-reference)

Numbered deliberately for citation from measurements and tests:

- **F1 large PDF** — generated synthetic 1,000-page PDF with page/quote anchors, stored under `src/lib/ai/assistant/conversations/__tests__/fixtures/` when task 1.5 lands; hash recorded with measurements.
- **F2 library scale** — 3,000-item synthetic metadata set (generated in-test by seeded PRNG, not a committed binary).
- **F3 long conversation** — 1,000-message synthetic conversation generated by seeded PRNG.
- **F4 long timed transcript** — extends the existing `transcript.ts` fixture to >prose budget length with deterministic timestamps.
- **F5 legacy storage fixtures** — raw sidebar/Q&A/Zustand/SQLite-shaped records in `legacy/` (see the fixture manifest there; oversized, corrupt, unknown-field and duplicate-ID variants included).

Fixtures contain **no production user data**. F1/F4 are synthetic; F5 is rebuilt from hand-authored synthetic records plus derivations of the shapes in `documentQaSessions.ts` and `AssistantPanel.tsx`, sanitized by construction.
