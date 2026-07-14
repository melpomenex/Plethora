### Added

- **True SM-20 5-model ensemble** — Reverse-engineered and implemented the actual SM-20 scheduling algorithm from `sm20.exe`. SM-20 is not a single formula but a weighted ensemble of five independent prediction models blended on every review: M1 (legacy SM-15 scheduler, 6%), M2 (classic SM-15/16 scheduler with A/U-factor optimizer, 14%), M3 (SM-15 raw Bayesian matrix scheduler, 45%), M4 (35-parameter FSRS mixture kernel, 25%), and M5 (analytic stability formula, 10%). M2 and M3 learn automatically on every review and persist across sessions. Every formula was decoded from Ghidra decompilation, verified against raw assembly, and validated against the running binary via Frida injection (20/20 ensemble match, 200 dispersal trials, 34+60 M2 chained reviews, 9/9 M3 live vectors, 40/40 M1 vectors — all exact).

### Fixed & Improved

- **Removed the V4 diagnostic optimizer** — The previous V4 recall fit was a diagnostic-only approximation that never fed into scheduling. It has been replaced by the real ensemble, which handles learning internally via M2's optimizer and M3's matrices.
- **SM-20 rating mapping** — Reviews now map to the SM-20 0–5 grade scale (Again→0, Hard→2, Good→3, Easy→5), matching the binary's expected input.
- **Collection-wide state persistence** — M2's optimizer state and M3's matrix state are stored in new database tables and loaded/saved per review, so learning accumulates across sessions.
- **Browser/PWA backend** — The TypeScript SM-20 implementation mirrors the Rust ensemble (M4+M5+M1 computed fresh; M2/M3 fall back to M4 in offline mode).
