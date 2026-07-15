### Added

- **Algorithm Arena scheduler for SM-20** — Binds five spaced-repetition models (SM-2, SM-15, SM-19, SM-20 proper (M4), and FSRS) in a dynamically weighted ensemble. Weights adapt dynamically based on log-loss performance using the Hedge algorithm.
- **R-Metric performance metrics** — Tracks the performance improvement of the Algorithm Arena blend relative to SM-19 alone, showing your data's progress directly in the settings panel and review inspector.
- **Local weight optimizers** — Fits the FSRS model parameters and the 35-parameter SM-20 proper (M4) kernel directly to your local review log. The SM-20 optimizer utilizes coordinate descent with a cross-validation gate to safeguard against overfitting.
- **Pure SM-20 Scheduling Mode** — Added a toggle under settings to schedule reviews using the optimized M4 model alone (bypassing the Arena blend), while keeping Arena scoring running in the background for comparison.

### Fixed & Improved

- **Active indicators in review transparency** — The review inspector now clearly highlights when you are running in Pure SM-20 mode vs the Algorithm Arena blend.
- **Mock browser-side scheduler parity** — Updated the Web/PWA offline scheduler to support the pure M4 scheduling option for full feature parity with the native Tauri runtime.
