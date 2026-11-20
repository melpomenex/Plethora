### Added

- **Sleep Tracking & Learning Insights Dashboard** — Dedicated Learning Insights tab with an interactive multi-month Sleep Chart, biological wake-date anchoring, sleep stage visualization (Deep, REM, Light, Awake), and study session overlays mapping flashcard reviews and reading directly against sleep blocks.
- **Circadian modeling & Sleep Regularity Index (SRI)** — Track day-to-day sleep schedule consistency with SRI, simulate homeostatic sleep pressure and circadian alertness via the Borbély two-process model to identify peak learning windows, and monitor autonomic recovery with overnight HRV (RMSSD and SDNN) and resting heart rate.
- **Memory performance & FSRS-7 recall residuals** — Quantify how sleep duration and architecture impact memory by comparing observed flashcard recall against FSRS-7 predictions, controlling for time-of-day circadian rhythms, card difficulty, and study workload with day-clustered bootstrap confidence intervals and Benjamini-Hochberg FDR control.
- **Evidence Inspector & Study Plan health insights** — Inspect statistical confidence, sample sizes, and limitations for every personal pattern, with embedded health cards in Study Plan progress and home views advising on sleep-informed pacing and readiness.
- **Wearable connections & device priority** — Native mobile bridges for Apple HealthKit (iOS) and Android Health Connect, direct OAuth 2.0 PKCE connectors for Oura Ring, WHOOP, and Google Health (Fitbit / Pixel Watch), and configurable provider priority ordering to resolve multi-device overlaps.
- **Manual sleep logging, sample data & encrypted backups** — Log sleep manually with quality ratings and optional stages, explore features via an interactive synthetic dataset, and import or export records via Apple Health XML, CSV, JSON, or passphrase-encrypted bundles (`.plethora-health.enc`).
- **Local-first Health Vault privacy** — Health telemetry resides in a physically isolated on-device SQLite database (`health.db`) with strict zero-cloud and zero-AI egress guarantees, plus complete vault wiping and compaction under Settings.
- **Comprehensive handbook documentation in 6 locales** — Documented all sleep tracking, wearable integrations, circadian analytics, and privacy guarantees across English, German, Spanish, French, Japanese, and Simplified Chinese.

### Fixed & Improved

- **PDF triple-click paragraph selection & column-gap boundary** — Updated multi-click selection in `PDFViewer` and `pdfCharLayout` (`paragraphRangeAtPdfCaret`, `lineRangeAtPdfCaret`) so triple-clicking selects full paragraphs without crossing column gutters or diagrams.
- **Study plan generation test assertions** — Aligned curriculum coordinator and pinned task assertions across study plan generation suites.
