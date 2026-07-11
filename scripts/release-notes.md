### Added

- **Google Gemini AI provider** — Added Gemini as a configurable provider across desktop, Android, and browser builds, with chat, streaming, model discovery, connection testing, and Gemini 3.5 Flash/Pro defaults through Google AI's OpenAI-compatible API.

### Fixed & Improved

- **Fresh-install dashboard import** — The dashboard import action now opens and mounts the library before invoking the native file picker, restoring document import on clean Windows and Android installations.
- **Android PDF loading** — PDF.js now retains a bundled fallback worker source when Android WebViews reject the preferred module worker, preventing the `GlobalWorkerOptions.workerSrc` load failure.
