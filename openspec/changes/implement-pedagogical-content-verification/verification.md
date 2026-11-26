# Verification: Implement Pedagogical Content Verification

- Vitest: `npx vitest run src/lib/study-plans/studyMode/__tests__/pedagogicalVerifier.test.ts`.
- Rust: `cargo test --manifest-path src-tauri/Cargo.toml study_mode::verifier`.
- Strict OpenSpec validation: `openspec validate implement-pedagogical-content-verification --strict`.
