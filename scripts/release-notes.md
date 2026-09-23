### Added

- **Multi-scheduler system restored (FSRS-7, SM-20, SM-18, SM-2)** — Complete spaced-repetition scheduling system with full support for FSRS-7 (dual-trace memory state, fractional elapsed-time intervals, and 34-parameter model), SuperMemo SM-20, SM-18, and classic SM-2. Users can freely select their preferred scheduler per deck or collection.
- **Algorithm Arena** — Built-in experimental laboratory to compare scheduling algorithms side-by-side, simulate long-term retention curves, evaluate review workloads, and inspect interval calculations across thousands of simulated repetitions.
- **Accountless open-source foundation** — Plethora is fully prepared for open-source distribution with an accountless, local-first product architecture. All incremental reading, annotations, scheduling, and local AI capabilities operate completely offline with no cloud account required.
- **Complete Plethora identity consolidation** — Finished end-to-end migration from Incrementum to Plethora across all system identifiers, SQLite database naming (`plethora.db`), native OS keychain services, minisign updater keys, and cross-platform config namespaces, with seamless one-shot automatic adoption of legacy user data.
- **PDF Reflow Engine & Reader Context Menu** — Responsive continuous reading view for multi-column documents on any screen size, coupled with right-click selection menus and `/20rules` knowledge formulation commands for atomic card creation adhering to the 20 Rules of Knowledge Formulation.

### Fixed & Improved

- **Cross-platform build pipeline stability** — Resolved build memory limits and compiler configuration across Linux (Debian & Arch Linux OOM prevention), Windows (MakeAppx sparse identity package footprint and WinRT SDK linking), and AppImage packaging.
- **`no-mistakes` release gate** — Pushes and releases are now protected by the local `no-mistakes` gate, validating build integrity, code review, linting, and automated checks before remote publication.
- **Performance & memory hygiene** — Resolved high-water mark retention issues and strengthened type safety across backend databases and background workers.
