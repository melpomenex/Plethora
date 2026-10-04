### Added
- **Saved Queues** — Create, manage, and persist custom queue presets with customizable filters, sorting, and session goals. Features dedicated toolbar and dropdown integration, quick-switching via Command Palette, and starter presets across 6 locales.
- **Dynamic Adaptive Queue Engine (DAQE)** — Adaptive queue ranking that dynamically balances cognitive load, urgency, spacing, retention goals, and session targets. Supports decision-model providers including OpenAI and Cloudflare Workers AI with explicit session goal guidance.
- **Cactus Whistle Speech-to-Text** — Cross-platform on-device speech recognition powered by the Cactus Whistle STT model, with exhaustive native handling across desktop and mobile.
- **Audio Editions in Queue & Voice Selection** — Listen to long-form content, articles, and PDFs directly in your review queue with multi-part position resume, voice selection, live auditioning, and section synthesis.
- **Pocket-TTS Runtime Provisioning** — Automatically provision and execute the Pocket-TTS runtime directly from the application via `uv`.
- **Enhanced Mobile Web & Article Reader** — Generalized selection actions to saved web articles, ranking the most-used actions on mobile and maintaining an active selection bridge across iframes.
- **Inline Product Showcase** — Added a 49-second animated preview reel directly to documentation showcasing Plethora's core workflows.

### Fixed & Improved
- **Audio Edition Extraction & Playback** — Support PDF text extraction for Audio Editions, repair section synthesis extraction, improve generation UX, and resolve codec playback errors.
- **Saved Queue & Review Invariants** — Resolve foreign key errors on saved queues, sync session goals and DAQE presets to settings upon selection, and properly resolve stored queue strategies.
- **Mobile UI & Styling** — Fix audio edition dialog clipping and tag editor translucency on mobile, repair mobile queue layouts, and prevent raw icon names from rendering as text labels.
- **Review Fallbacks & Media Controls** — Repair card source fallback navigation, SponsorBlock settings, and narrow command scoping when archiving finished videos.
- **Linux AppImage Subprocess Environment** — Prevent `PYTHONHOME` from leaking into Python subprocesses, and restore YouTube HTML5 playback in AppImages.
- **Cross-Platform CI & Packaging Stability** — Extensive build and packaging hardening: Linux runner swap and memory allocation, serial linking with LLD, Windows sparse identity MSIX integration, MSVC build fixes, and Android/iOS build timeout and signing improvements.
