### Added

- **PDF Reflow Engine (1st pass)** — Transforms fixed multi-column PDFs into a responsive, continuous reading view tailored for mobile screens and custom font sizes. Powered by a high-performance Rust analysis engine that reconstructs reading order, multi-column blocks, paragraphs, headings, tables, equations, and figures with automated caption association. This is a **1st pass** release of the reflow engine and will be actively refined and improved upon in subsequent updates.
- **20 Rules of Knowledge Formulation command (`/20rules`)** — Invoke `/20rules` or `/formulate` across the Assistant Panel, Document Q&A, and Flashcard Studio to generate high-retention, atomic flashcards strictly adhering to Dr. Piotr Wozniak's 20 Rules of Knowledge Formulation (minimum information principle, cloze deletion, combating interference, avoiding complex enumerations).
- **Desktop PDF context menu** — Right-clicking selected text in the desktop PDF viewer now brings up the full selection context menu (Create Extract, Add Note, Highlight colors, Dictionary/Thesaurus, Flashcard formulation, Explain, Summarize, Learn This), bringing parity with the EPUB reader.
- **Gauntlet Loop workflow** — Added the Gauntlet Loop skill and workflow for systematic build-and-critique evaluation loops against concrete quality bars.

### Fixed & Improved

- **Mobile PDF toolbar spacing & notch clearance** — Reader toolbars consume horizontal safe area insets and minimum edge padding, preventing controls from hugging screen edges in portrait and landscape orientations.
- **Touch selection dismissal in reflow view** — Scrolling through reflowed documents on touch screens reliably dismisses the selection actions sheet without wedging native text selection.
- **First-activation view loading reliability** — Resolved a hydration race condition where Queue and Documents views could render empty on first launch until navigating away and back.
- **Backend memory & formatting hygiene** — Standardized formatting and tightened safety invariants across database, queue, and background transcription subsystems.
