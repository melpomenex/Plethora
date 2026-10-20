# Verification notes — improve-settings-search

Recorded 2026-10-20. Commands were run from the repository root on the
implementation machine (Linux x86_64, Node per repository toolchain).

## Automated gates

| Command | Outcome |
| --- | --- |
| `npx tsc --noEmit` | Pass (no diagnostics). |
| `npx vitest run src/components/settings/search/__tests__ src/components/settings/__tests__/SettingsPage.navigation.test.tsx src/commandPalette/__tests__/registry.test.tsx src/commandPalette/__tests__/registryAvailability.test.tsx` | **77 tests passed** across 7 files. Includes catalog integrity, matcher/ranking, availability, coverage, navigation/reveal, integration, return-navigation, and Command Palette section/availability suites. |
| `npx vitest run src/components/settings/__tests__` | Pass (21 files, **90 tests**) including return navigation, ThemePicker, TTS, AI, privacy, embeddings, and other existing Settings suites. |
| `npx vitest run src/lib/i18n/__tests__/i18n-completeness.test.ts` | Pass (17 tests): all new keys exist in all six locales and preserve placeholders. |
| `npx eslint <changed source files>` | 0 errors; only pre-existing unused/empty-block warnings in touched modules. |
| `npm run bench` / `npm run bench:check` | **Pass.** 63 benchmarks compared; `settings-search/*` measured at **1.02× / 1.03× / 1.10×** of baseline. Bundle check: entry 3 KB, 1 PDF worker, total 26.1 MB. The only warnings are unrelated stale-baseline warnings (current cost >25% below old baseline) for tabs/audio-edition/PDF/ambient benches; no threshold was relaxed. |
| `npm run check:bundle` | Pass: entry 3 KB, 1 PDF worker, total 26.1 MB. Section panels remain lazy. |
| `openspec validate improve-settings-search --strict` | Pass: "Change 'improve-settings-search' is valid". |

## Benchmark baseline rationale

`src/components/settings/search/settingsSearch.bench.ts` adds three
deterministic benches using `seededRandom(0x5eed)`, a module-level consumed
result sink, and void benchmark bodies:

- `settings-search/real-catalog` — normalize + tokenize + tiered match/dedupe
  over the real resolved catalog (`font size`).
- `settings-search/synthetic-1000` — same matcher over 1,000 seeded entries.
- `settings-search/synthetic-1000-typo` — fuzzy/transposition path (`font siez`)
  over the same synthetic catalog.

Baselines in `scripts/perf-baselines.json` use the calibrated costs reported by
`check-perf-budget.mjs` on this implementation run: **2.254**, **9.995**, and
**9.989**. Tolerances are 1.35 / 1.5 / 1.5 to account for the allocation-heavy
synthetic path. No other baseline was altered.

## Acceptance matrix

| Requirement | Evidence |
| --- | --- |
| Search covers reachable settings, not categories alone | Catalog + coverage inventory; `settingsSearch.test.ts` (font-size controls, category + specific results); `SettingsPage.search.test.tsx` (specific result rows with breadcrumbs). |
| Search before visiting a panel | Catalog is component-free and resolved before panels mount; integration tests activate Documents/Audio panels that were never opened. |
| Newly added setting coverage | `settingsSearchCoverage.test.ts` requires every shared section to have inventory + catalog coverage; contributor guide documents the workflow. |
| Familiar phrases and tolerant matching | Matcher tests for `bigger text`, `volume buttons`, `speech to text`, `speech-to-text`, `tts`, `dark mode`, `vibration`, `font siez`, case/space/hyphen equivalence, reversed `EPUB font size`, every-token-in-one-entry. |
| Current interface language + English fallback | Six-locale matching tests (including CJK), async dictionary readiness test, raw-key rejection, English-fallback tests. |
| Ranking/result identity | Tier table, direct-label coverage tie-break, stable order, dedupe-by-destination tests; category vs concrete preference. |
| Selecting a result reveals the setting | Provider + target primitives; integration tests assert arrival attribute, focus, marker, and unchanged values for Appearance, Documents/EPUB, and nested Audio Groq configuration. |
| Waits for loading / nested reveal | Lazy Documents and Audio panel integration tests; provider delayed-registration retry test; integration tab reveal resolvers. |
| Superseded requests | Provider unit test and rapid replacement integration test. |
| Availability and setup | Snapshot predicates; accountless/cloud/platform/companion/FSRS/DAQE/TTS-state tests; recoverable setup (`enable indexing`, Groq API key). |
| Context preservation / back behavior | Compact back restores query, list scroll, and originating result focus; existing return-navigation suite still passes; discard cancellation preserves draft and view. |
| Accessible controls/results | Localized search/clear labels, semantic buttons, polite result-count status, no focus movement while typing or during IME, clear-search focus restoration. |
| Reduced motion / E-Ink | Provider test asserts instant (`auto`) scrolling under `prefers-reduced-motion`; arrival marker uses text + outline, no pulse. E-Ink path also forces instant scrolling (`useIsEink`). |
| Local/private values | Catalog holds no keys/URLs/user content; private-string and unrelated-token queries produce no results; catalog integrity test scans for secret-like values. |

## Manual browser verification (partial)

A Vite dev server was run at a 752 px viewport (compact shell). In the live
Settings UI:

- Typing `font size` produced **3 ranked results** in **14.4 ms** end-to-end
  (input event → two animation frames → rendered result buttons): interface
  Font Size, Documents → EPUB Default Font Size, and the Appearance category.
  Result accessible names carried distinct breadcrumbs, e.g.
  `Font Size, Appearance › Typography` and
  `Default Font Size, Documents › EPUB Documents`.
- Activating the interface Font Size result opened Appearance, scrolled the row
  fully below the content header (target top/bottom 431/504 px inside a
  scroller spanning 136–1124 px), moved focus to the named row, and rendered
  the non-color `SEARCH MATCH` badge plus the arrival class. The stored value
  was unchanged.
- Evidence: `openspec/changes/improve-settings-search/evidence/compact-arrival-font-size.png`.

The dev server was subsequently lost to environment restarts (502s from the
browser host), so the remaining manual checks were **not completed**: compact
hierarchical back in the live browser, long translated labels, no-results
presentation, E-Ink visual treatment, and a measured-device 100 ms check over
the whole catalog. The compact-back query/scroll/focus path, no-results,
reduced-motion scrolling, IME, and two-instance isolation are covered by the
DOM integration tests listed above, but they are not a substitute for a human
touch/E-Ink release pass.
