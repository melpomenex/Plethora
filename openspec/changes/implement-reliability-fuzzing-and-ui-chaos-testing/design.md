# Design: Reliability Fuzzing, Import Mutation Testing, and UI Chaos/Monkey Testing

## 1. Dual-Layer Reliability Testing Architecture

The reliability framework operates at two fundamentally distinct layers:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                   Dual-Layer Reliability Testing Architecture               │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Layer A: Pure Rust Parser & Ingestion Fuzzing (In-Memory / Fast)      │  │
│  │                                                                       │  │
│  │  • cargo-fuzz / libFuzzer / proptest                                  │  │
│  │  • Targets: PDF, EPUB, Kindle, HTML, Markdown, Share Manifests        │  │
│  │  • Mutation: Bit flips, truncation, chunk duplication, corrupt ZIPs   │  │
│  │  • Invariant: Reject or accept; ZERO panics / infinite loops / OOMs   │  │
│  │  • Output: Auto-minimized crash inputs -> tests/fixtures/regression/  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Layer B: State-Aware UI Monkey & Chaos Tester (iOS Simulator)         │  │
│  │                                                                       │  │
│  │  • Seeded deterministic PRNG (Mulberry32)                             │  │
│  │  • High-level semantic actions (OPEN_DOC, SCROLL, ROTATE, TTS, KILL) │  │
│  │  • State-machine filtering (only chooses valid actions per UI state)  │  │
│  │  • Fault injection hooks (interrupt mid-stage, artificial delays)     │  │
│  │  • Deadlock watchdog: auto-samples thread stacks (sample/lldb) on hang│  │
│  │  • Reproducibility: npm run test:ios:monkey -- --seed <number>        │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Layer A: Pure Rust Parser Fuzzing Specification

Fuzz targets reside in `src-tauri/fuzz/fuzz_targets/` and execute against isolated, pure parsing functions without spinning up WKWebView or the Tauri GUI runtime.

### Fuzz Targets:

1. **`fuzz_pdf`**: Feeds mutated byte streams to `processor::pdf::extract_pdf_content`.
2. **`fuzz_epub`**: Feeds mutated ZIP byte streams to `processor::epub::extract_epub_content`.
3. **`fuzz_kindle`**: Feeds mutated UTF-8 strings to `kindle_clippings::do_import_kindle_clippings_from_text`.
4. **`fuzz_html_markdown`**: Feeds pathological HTML and Markdown to `processor::html` and `processor::markdown`.
5. **`fuzz_share_manifest`**: Feeds mutated JSON payloads to `staged_shares::parse_manifest`.

### Mutation Strategies:
- Byte deletion, insertion, and substitution.
- Header byte replacement (e.g. `%PDF-` -> `\x00\x00\x00\x00`).
- ZIP central directory corruption and offset manipulation.
- Pathological XML entity nesting and unclosed tag injection.
- Unbounded length strings and invalid Unicode sequences.

### Crash Minimization & Permanent Regression Pipeline:
Whenever a fuzzer discovers a crashing or panicking input:
1. `cargo-fuzz` automatically minimizes the reproducer artifact.
2. The minimized input is committed to `src-tauri/tests/fixtures/regression/<target>-<hash>.<ext>`.
3. A corresponding unit test in `src-tauri/tests/fuzz_regression.rs` verifies that the parser returns `Err(...)` without panicking.

---

## 3. Layer B: State-Aware UI Monkey & Action Generator

The UI monkey driver (`scripts/ios-test/monkey.mjs`) navigates the real compiled iOS app on the simulator by selecting semantic actions filtered by the current screen state.

### Semantic Action Set:

```typescript
type SemanticAction =
  | { type: "OPEN_TAB"; tab: "dashboard" | "documents" | "queue" | "review" | "settings" }
  | { type: "IMPORT_FIXTURE"; fixtureId: string }
  | { type: "OPEN_DOCUMENT"; documentId?: string }
  | { type: "CLOSE_DOCUMENT" }
  | { type: "SCROLL"; direction: "up" | "down"; distance: number }
  | { type: "NEXT_PAGE" }
  | { type: "PREV_PAGE" }
  | { type: "START_TTS" }
  | { type: "PAUSE_TTS" }
  | { type: "SEARCH_DOCUMENTS"; query: string }
  | { type: "CLEAR_SEARCH" }
  | { type: "CHANGE_THEME" }
  | { type: "BACKGROUND_APP"; durationMs: number }
  | { type: "FOREGROUND_APP" }
  | { type: "ROTATE_SCREEN"; orientation: "portrait" | "landscape" }
  | { type: "TERMINATE_APP" }
  | { type: "RELAUNCH_APP" }
  | { type: "DELETE_RANDOM_DOCUMENT" };
```

### State-Aware Action Filter:

```typescript
function getValidActions(currentState: AppUiState): SemanticAction[] {
  const actions: SemanticAction[] = [];
  
  if (currentState.activeModal) {
    actions.push({ type: "CLOSE_MODAL" }, { type: "SUBMIT_MODAL" });
    return actions;
  }
  
  if (currentState.isReaderOpen) {
    actions.push(
      { type: "CLOSE_DOCUMENT" },
      { type: "SCROLL", direction: "down", distance: 300 },
      { type: "SCROLL", direction: "up", distance: 300 },
      { type: "NEXT_PAGE" },
      { type: "PREV_PAGE" },
      { type: "START_TTS" },
      { type: "BACKGROUND_APP", durationMs: 2000 },
      { type: "ROTATE_SCREEN", orientation: currentState.orientation === "portrait" ? "landscape" : "portrait" }
    );
    return actions;
  }
  
  // Base dashboard/library navigation
  actions.push(
    { type: "OPEN_TAB", tab: "dashboard" },
    { type: "OPEN_TAB", tab: "documents" },
    { type: "OPEN_TAB", tab: "queue" },
    { type: "OPEN_TAB", tab: "review" },
    { type: "OPEN_TAB", tab: "settings" },
    { type: "IMPORT_FIXTURE", fixtureId: pickRandomFixture() },
    { type: "BACKGROUND_APP", durationMs: 1500 },
    { type: "TERMINATE_APP" },
    { type: "CHANGE_THEME" }
  );
  
  if (currentState.documentCount > 0) {
    actions.push(
      { type: "OPEN_DOCUMENT" },
      { type: "DELETE_RANDOM_DOCUMENT" },
      { type: "SEARCH_DOCUMENTS", query: "test" }
    );
  }
  
  return actions;
}
```

---

## 4. Chaos Scenarios & Test-Build Fault Injection Hooks

### Adversarial Reliability Scenarios:
1. **Kill mid-staging (10%, 50%, 95%)**:
   Terminate the simulator process while chunked bytes are streaming; verify no orphan DB entries and clean recovery on restart.
2. **Concurrent Duplicate Ingestion**:
   Dispatch 5 simultaneous import requests for the same file; verify exactly one succeeds and four return `DuplicateDocument` errors without deadlock.
3. **TTS Switch While Backgrounded**:
   Start audio TTS on Document A, trigger background transition, foreground app, immediately switch to Document B.
4. **Rapid Rotation under Heavy Render**:
   Rotate orientation between portrait and landscape 10 times in 5 seconds while a 100-page PDF is rendering.

### Test-Build-Only Fault Injection (`src-tauri/src/test_hooks.rs`):

```rust
#[cfg(debug_assertions)]
pub fn check_fault_injection(stage: &str) -> Result<()> {
    if let Ok(target) = std::env::var("PLETHORA_TEST_FAIL_IMPORT_STAGE") {
        if target == stage {
            return Err(PlethoraError::Internal(format!("Injected fault at stage: {}", stage)));
        }
    }
    if let Ok(delay) = std::env::var("PLETHORA_TEST_DELAY_IMPORT_STAGE") {
        if let Ok(ms) = delay.parse::<u64>() {
            std::thread::sleep(std::time::Duration::from_millis(ms));
        }
    }
    Ok(())
}

#[cfg(not(debug_assertions))]
#[inline(always)]
pub fn check_fault_injection(_stage: &str) -> Result<()> {
    Ok(())
}
```

---

## 5. Deadlock Stack Sampling Engine

When the harness watchdog detects that the process is alive but the UI heartbeat has stopped advancing for > 5 seconds:

```bash
# scripts/ios-test/sample-hang.sh
PID=$(pgrep -f "com.plethora.app" || true)
if [ -n "$PID" ]; then
  echo "Capturing process stack sample for hung PID $PID..."
  sample "$PID" 3 -file "$ARTIFACT_DIR/hang_sample.txt" || true
  lldb --batch -p "$PID" -o "thread backtrace all" -o "quit" > "$ARTIFACT_DIR/lldb_threads.txt" 2>&1 || true
fi
```

The resulting `hang_sample.txt` and `lldb_threads.txt` provide actionable thread backtraces showing exact lock contentions, Tokio worker stalls, or GCD deadlocks.

---

## 6. Automated Run Tiers on Mac Mini

| Tier | Command | Purpose | Typical Duration | Frequency |
|---|---|---|---|---|
| **Smoke** | `npm run test:ios:smoke` | Fast build, boot, navigate, relaunch | ~1–2 min | Every major iOS change |
| **Imports** | `npm run test:ios:imports` | Run full malformed fixture corpus | ~2–3 min | Pre-commit / PR gate |
| **E2E** | `npm run test:ios:e2e` | Deterministic Maestro user journeys | ~3–5 min | Pre-release / nightly |
| **Monkey** | `npm run test:ios:monkey -- --steps 300` | Seeded semantic chaos test | ~5 min | Daily / feature testing |
| **Fuzz** | `npm run test:fuzz:imports -- --seconds 300` | Pure Rust parser fuzzing | ~5 min | Nightly / parser edits |
| **Soak** | `npm run test:ios:soak -- --hours 2` | Long-running memory leak detection | 2 hours | Weekly / soak runs |
| **Nightly** | `npm run test:ios:nightly` | Full suite (smoke + E2E + 10 monkey seeds + fuzzing) | ~30–45 min | Nightly scheduled run |
