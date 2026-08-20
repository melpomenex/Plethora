## 0. Dependency gates

Requires #1/#2/#19. Do not start specialized scoring until the shadowing attempt/result contract, provider capabilities, uncertainty semantics, and retention policy are approved.

## 1. Result contract

- [ ] 1.1 Define capability ladder, provider manifest, score/confidence/issue/span/timing/phoneme types, versioning, and unsupported states.
- [ ] 1.2 Extend shadowing attempt/history schema with derived pronunciation results and retention/delete/export policy.

## 2. Providers and UI

- [ ] 2.1 Add local/BYO/cloud provider routing, consent/disclosure, bounded audio upload, retry/cancel, and model capability checks.
- [ ] 2.2 Add transcription/word-confidence/timing feedback first, then specialized pronunciation/phoneme adapters behind capability gates.
- [ ] 2.3 Build accessible feedback UI and active-evidence/practice hooks without scheduler side effects.

## 3. Verification

- [ ] 3.1 Test each capability fallback, uncertainty, provider mismatch, stale result, privacy opt-out, deletion, and retry history.
- [ ] 3.2 Regression-test shadowing/listen-only, audio alignment, mobile/e-ink/accessibility, Queue/learning-item invariants, and no fabricated scores.
