### Added

- **Expanded on-device AI (Gemini Nano) on Android** — summary/Q&A, flashcard generation, explanations, extract analysis, review hints, and image study now run entirely on-device through ML Kit / AICore with streaming, cancellation, and capability-aware routing. The model downloads inside the app and works fully offline and private. Gemini Nano runs on flagship devices with sufficient RAM, including the **Google Pixel 8, 8a, 8 Pro, Pixel 9, 9 Pro, 9 Pro XL, and Samsung Galaxy S24 series**; the status panel reports `device_unsupported` and falls back to your cloud provider elsewhere.
- **AI actions on a text selection (mobile)** — selecting text in the reader now surfaces AI actions, and the surrounding context is sent along with the selection so responses stay grounded in the page you're reading.
- **Camera capture → flashcards (Image Registry)** — take a photo on-device and generate flashcards from it without the image or text ever leaving the device.

### Fixed & Improved

- **Library import and category filter** — imported items now pick up the default category instead of landing uncategorized, and the Library gained a category filter.
- **NotebookLM auth/listing errors** — authentication and listing failures now surface a clear error with a re-authenticate flow instead of failing silently.
