### Fixed & Improved

- **YouTube mobile playback & embed host reset** — The YouTube viewer reset effect now preserves the platform-aware host selection (`youtube.com` on native mobile, Tauri, and Linux) instead of hardcoding `youtube-nocookie.com`, preventing blank player loading in mobile WebViews.
- **On-device YouTube transcript gating & status parsing** — Fixed PO-token gating false positives in the Rust InnerTube caption fetcher and corrected status discriminant checks in `youtubeTranscriptBrowser.ts`, allowing mobile devices to resolve native InnerTube captions directly without falling back to datacenter IP fetches.
- **Scroll queue tab data isolation** — Fixed scroll position updates in `QueueScrollPage` to target only the active tab's pane and preserve existing tab metadata, preventing tab data clobbering and blank document viewer restores.
