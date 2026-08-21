# Implementation Tasks

## 1. Error-type parity (the concrete bug)
- [x] 1.1 Fix `src/components/viewer/XThreadErrorState.tsx` so backend snake_case `type` values map to the intended camelCase title/detail keys (or normalize types in a shared helper used by the viewer and any other consumer of `metadata.xThreadError`)
- [x] 1.2 Add a parity test asserting every Rust `ThreadError` variant maps to a non-generic UI copy
- [x] 1.3 Update `XThreadViewer.test.tsx` to assert typed copy for representative errors, not only the generic fallback

## 2. Retrieval pipeline alignment
- [x] 2.1 Audit `src-tauri/src/threadreader.rs`/`twitter.rs` against `xcom.py` behaviors; document alignment in `docs/X_THREAD_RETRIEVAL.md`
- [x] 2.2 Add missing reference capabilities that are valuable and cheap (e.g. hashtags/mentions/expanded URLs on `TwitterPost` if the schema allows) or document as out of scope
- [x] 2.3 Preserve the HTML-unroll fallback (do not regress to xcom.py's dead JSON-only path)

## 3. URL normalization / root identification
- [x] 3.1 Verify `extract_tweet_id`/`extract_screen_name_from_url` and frontend detectors handle www/mobile subdomains, query params, trailing slashes, `/i/status/`; add missing variants
- [x] 3.2 Verify in-thread id → root resolution via ping and canonical URL output

## 4. Typed error UX
- [x] 4.1 Ensure each error case (invalid_url, thread_unavailable, rate_limited, network_error, thread_reader_unavailable, auth/credentials) has distinct friendly copy + Retry/Open-on-X affordances
- [x] 4.2 Confirm no raw internal exception is the primary message; keep raw text as secondary detail only

## 5. Tests
- [x] 5.1 X: single post, multi-post thread, x.com URL variants, inaccessible/deleted post, provider/API failure, fallback path, error-type parity
- [x] 5.2 Rust: extend `threadreader.rs` fixtures/tests for HTML unroll + error classification if gaps found
- [x] 5.3 Run `npm run test:run` affected suites; `cargo test -p` for the Rust crate

## 6. Spec
- [x] 6.1 Confirm spec matches implementation
