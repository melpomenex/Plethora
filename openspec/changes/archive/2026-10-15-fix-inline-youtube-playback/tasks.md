## 1. YouTubeViewer Component Lifecycle & Interaction

- [x] 1.1 Fix initial mount lifecycle in `YouTubeViewer.tsx` so `showInlinePlayer` defaults to `true` on open and only resets when switching to a different document
- [x] 1.2 Remove silent click swallowing on the thumbnail play button in `YouTubeViewer.tsx` so user clicks always trigger playback and enable `forceInlinePlayback`
- [x] 1.3 Ensure YouTube iframe embed options, origin parameters, and embed host fallback operate reliably without postMessage origin mismatch errors
- [x] 1.4 Scope pointer events on `LanguageVideoHost` overlay so it does not intercept clicks meant for the video player container

## 2. Linux WebKitGTK Graphics & Media Stability

- [x] 2.1 Audit and update `src-tauri/src/graphics.rs` to ensure WebKitGTK video playback and media compositing remain stable under hardware acceleration
- [x] 2.2 Verify Linux startup environment variables in `scripts/tauri-wrapper.sh` and `src-tauri/src/main.rs` preserve necessary sandbox and media flags

## 3. Testing & Verification

- [x] 3.1 Create `src/components/viewer/__tests__/YouTubeViewer.test.tsx` covering initial mount in inline mode, thumbnail play click handling, and error fallback recovery
- [x] 3.2 Run frontend unit tests (`npx vitest run src/components/viewer/__tests__/YouTubeViewer.test.tsx src/utils/youtubeEmbed.test.ts`)
- [x] 3.3 Verify full test suite and build (`npm run test:run` / `npm run build:check`)
