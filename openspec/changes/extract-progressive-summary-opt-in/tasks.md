## 1. Setting

- [x] 1.1 Add `extractProgressiveSummaries: boolean` to `AIControlsSettings` and to the `aiControls` defaults in `src/stores/settingsStore.ts`, defaulting to `false`; verify with a `settingsStore` unit test asserting the default is `false` and that a persisted `true` hydrates unchanged (`npm run test:run -- src/stores/__tests__/settingsStore.test.ts`)
- [x] 1.2 Add the "Generate AI summaries for extracts during review" toggle row to the Summarization sub-section in `src/components/settings/AIProviderSettings.tsx`, wired to `aiControls.extractProgressiveSummaries`, independent of `autoSummarize`; verify by rendering the AI settings section in a test and asserting the toggle exists, is off by default, and stays operable while `autoSummarize` is off
- [x] 1.3 Update the Summarization section description so it no longer claims the section is only about long extracts; verify with a snapshot/assertion in the same settings test

## 2. Disclosure display

- [x] 2.1 Create `src/lib/extractDisclosure.ts` with the pure `resolveExtractDisplay` helper implementing the design's rules (setting off / `maxLevel <= 0` → full; summary stages; final stage full; partial fraction) and returning `kind` instead of a display string; verify with unit tests covering every branch, including `maxLevel` 1, 3, 4, and 6
- [x] 2.2 Refactor `src/components/review/ExtractScrollItem.tsx` to use the helper, gate the mount effect on `aiControls.extractProgressiveSummaries`, and render the editable textarea from `kind === "full"` instead of comparing against `t("extractScrollItem.fullContent")`; verify by rendering the card with the setting off and asserting no `generateProgressiveSummaries` invocation and an editable textarea
- [x] 2.3 Make the header level badge and content badge derive from the same one-based stage, and hide the header badge when disclosure is inactive; verify with tests for stage 1/3 and the final stage asserting both indicators agree

## 3. Defaults and per-extract control

- [x] 3.1 Change `Extract::new` in `src-tauri/src/models/extract.rs` and the hardcoded `max_disclosure_level: 3` sites in `src-tauri/src/generator/mod.rs` and `src-tauri/src/browser_sync_server.rs` to `0`; verify with `cd src-tauri && cargo test` for the affected modules and by asserting a newly constructed extract has `max_disclosure_level == 0`
- [x] 3.2 Send the raw selector value (`0` included) in both create and update paths in `src/components/extracts/CreateExtractDialog.tsx`; verify with a dialog test that selecting `0` on an existing extract results in `max_disclosure_level: 0` in the update payload, and that a default create payload stores `0`
- [x] 3.3 Update existing fixtures/tests that assert a creation default of `3` (`CreateExtractDialog` tests, marketing fixture, seed helpers) to the new `0` default, keeping fixture coverage explicit; verify with `npm run test:run` on the affected files

## 4. Verification

- [x] 4.1 Run `npx tsc` and `npm run lint` and fix any type or lint findings introduced by the refactor
- [x] 4.2 Run `npm run test:run` for the affected suites and confirm no unrelated failures
- [ ] 4.3 Manually verify in the app: a fresh extract created without a level opens in the Queue with full editable text, no "AI Summary" badge, and no network/provider request; enabling the setting reproduces the previous summary behavior; disabling it again restores full text without deleting cached summaries
- [x] 4.4 Add a release-note/CHANGELOG entry stating that AI extract summaries are now opt-in via Settings → AI → Summarization
