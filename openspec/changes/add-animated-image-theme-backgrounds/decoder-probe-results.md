# Decoder gate probe results

**Status: partial; animated import remains gated.** This records host evidence gathered on 2026-11-20. It does not qualify packaged playback or mobile import.

## Linux WebKitGTK host probe

- Host runtime: WebKitGTK `2.54.1` (`webkit2gtk-4.1`), exercised through a GTK WebView on X11.
- The temporary harness served the page over localhost and applied the relevant production CSP directives from `src-tauri/tauri.conf.json`: `worker-src 'self' blob:`, `script-src 'self' 'wasm-unsafe-eval'`, and `script-src-elem 'self' 'unsafe-inline'`.
- A module worker constructed and loaded the Rust/WASM probe. The worker decoded all four valid GIF fixtures (2, 3, 2, and 3 frames) and rejected a trailer-truncated fixture.
- IndexedDB preserved a Blob through a write/read transaction.
- Worker `OffscreenCanvas.convertToBlob({ type: "image/png" })` and main-thread canvas `toBlob("image/png")` both produced PNG Blobs.
- The bounded WASM artifact was 81 KiB. Its probe uses the already locked `gif` 0.13.3 crate, checks frame consistency, and caps decoder memory. The current build tolerates a missing explicit LZW end code only after structural GIF preflight and only when a complete bounded frame is returned; invalid LZW codes still fail.

The first launch on Wayland exited with a display protocol error and no result. The same probe passed after forcing X11. WebKit emitted GBM buffer warnings on X11; all reported API checks still completed.

## Chromium application-worker probe

- Browser: system Chromium `155.0.8059.84` on Arch Linux, launched against the local Vite development origin and production preview.
- The application preparation wrapper recognized a valid `palette-dominance.gif` despite the `image/png` MIME type and `.png` extension. The module worker loaded the checked-in Rust/WASM decoder, composed and encoded the timeline, and returned an animated rendition with two frames, a 1,000 ms cycle, and an independent PNG poster and thumbnail.
- The production-built worker and WASM assets were also loaded directly from Vite preview (`animatedImage.worker-C9E9HS9e.js`, `gif-decoder-C3FC1TRK.wasm`). The same fixture returned a two-frame animated pack and PNG poster.
- The application `FramePackPlayer` decoded and painted both prepared frame Blobs to a real Chromium Canvas2D context within 180 ms, without a fallback.
- The finite red/green/blue loop-seam fixture was correctly classified as still-only by the flash screen; its still fallback remained available. The slower blue/green fixture passed as animated.

## Remaining gate evidence

- This was a temporary localhost WebKitGTK harness, not the packaged Tauri application, AppImage, or its asset origin. It proves the relevant CSP shape and APIs on this host, not the packaged worker path.
- Chromium validated the application preparation worker and Canvas2D player, but not the packaged Tauri asset origin, CSP, durable IndexedDB commit/restart, or lifecycle transitions.
- No Android device is connected, and macOS WKWebView, Windows WebView2, iOS WKWebView, deployed PWA, and the release-mode packaged Linux matrix have not been exercised.
- Worker cancellation/re-entry, saved media restoration across application restart, real responsive-sheet behavior, and the packaged still fallback still need application-level qualification. The frame player's decoder-timeout fallback has deterministic fake-clock coverage.

The 1.2 task stays open until those gaps are addressed. No platform cohort is release-qualified; capability and decode failures retain the poster-only fallback, and animation should not be enabled for an unqualified release target.

## Local regression checks

- The fake-clock player and cadence monitor suites pass 9 tests across two files. They cover capped pacing, pause/resume, stale and timed-out decoder results, the exclusive decode slot, finite loops, one cadence step-down after two overloaded five-second windows, and poster fallback after two more overloaded windows.
- The final animated-image/theme/settings run passed 151 tests across 17 files. It covers GIF preparation, storage and journaling, palette and contrast synthesis, player cadence, theme backdrop policy, modal/picker behavior, and portable colors-only themes, including a GIF drag/drop interaction and save retry. A reader/material run passed another 72 tests across 5 files, including EPUB and PDF viewer behavior and HTML-reader token checks. TypeScript `tsc --noEmit` and ESLint on touched TypeScript modules passed.
- A follow-up Chromium stylesheet probe used the Vite-transformed CSS with image-backdrop and protected-surface attributes enabled. Desktop/mobile content wrappers and `bg-cream` stayed transparent over the rendered gradient underlay, while card and transient `bg-background/*` surfaces kept their theme colors. No browser page errors occurred. This check does not exercise the packaged WebView.
- A user-provided 800×450 GIF with 80 frames decoded through the checked-in Rust/WASM module and the JavaScript adapter. All 80 frame headers matched JavaScript preflight; 79 frames retained transparency index `255`. This verified the fix for the former `255 means no transparency` ABI collision without adding the source media to the repository.
- A second user-provided 477×358 GIF with nine frames omitted the LZW end code beginning at frame three. After allowing the bounded compatibility case, the Rust decoder's RGBA output matched Pillow byte-for-byte on all nine frames, and Chromium preflight plus the WASM adapter decoded all nine frames with matching metadata. The red flash screen initially flagged subtle changes in warm highlights. Requiring a saturated red state and a substantial change in chromaticity let desktop and mobile preparation retain all nine frames and the original 1,620 ms loop. In Chromium, the real theme creator and backdrop components advanced frames both in preview and after saving. The source media was not added to the repository.
- In an isolated WebKitGTK profile with about 1.3 KB of free Local Storage, the same GIF prepared nine frames but the theme registry write failed with `QuotaExceededError`. A large assistant history cache in the desktop profile matched its native SQLite copy exactly. In the isolated probe, startup compaction with a matching native response freed that duplicate. The real theme dialog saved and applied the animated backdrop, and the selected theme and nine frames persisted across reload. With a different native response, compaction preserved the Local Storage copy and the save reported the quota error.
- The latest production Vite build succeeded. `npm run check:bundle` passed after that build with a 6 KB entry and 30.2 MB total bundle output.
- Three seeded benchmark suites now cover 200-frame GIF preflight, 450-frame temporal selection, and weighted OKLCH histogram finalization. Their recorded normalized costs are in `scripts/perf-baselines.json`, and all three passed in the second full benchmark run.
- The settings-search suite passed 31 tests, and strict OpenSpec validation passed with 11 of 18 task checkboxes complete. Packaged and mobile qualification remains open.
- The targeted Playwright scholarly-reader run did not reach its assertions: Vite could not resolve the harness import for `src/utils/articleImport/__tests__/fixtures/arxiv-html-regression/moe-routing.svg?inline`, which is absent from the checkout. Full feature Playwright lifecycle and snapshot checks remain open.
- The full `npm run bench:check` did not pass: two runs reported different regressions in untouched benchmark paths (`reader-speech-index/build` and `haptic-policy-admission-512` on the first run; `commandPalette/scope-filter-2000-results` on the second). The separate bundle-budget check passed.
- `npm run test:scripts` failed in `marketingFreshness.test.mjs` because the repository reports many existing marketing screenshots as unattributed. No animated-image files are involved in that check.
