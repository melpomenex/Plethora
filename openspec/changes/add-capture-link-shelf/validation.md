# Validation

The Capture Activity shelf, source-filtered Library navigation, direct reader opening, localized copy, and native saved-link query are implemented. OpenSpec currently records **17/19 tasks complete**.

## Passing checks

- Frontend: 80 relevant test cases across the metadata wrapper, shelf, query lifecycle, tab-local Library data, existing Library behavior, browser backend, reader navigation, and localization. The main combined run passed 79 cases; the added cached-deletion case passed in the final reader run.
- Native: 15 tests passed across the capture repository (2), shared source rules (1), media-provenance preservation (1), and existing analytics (11).
- Browser extension: `npm run test:browser-extension`, 56 tests passed.
- `npx tsc --noEmit` passed.
- Production `vite build` passed. Bundle budget passed: entry 5 KB, one PDF worker, total distribution 24.3 MB.
- Scoped ESLint reported zero errors; its five warnings are existing unused declarations/directives in the large Library/Dashboard components.
- `git diff --check` and `openspec validate add-capture-link-shelf --strict` passed.
- Rendered components were checked at a wide dark desktop, a narrow light pane, a dark phone, and a light phone with 200% text. The final pass had no horizontal overflow or overlapping reading/original controls, visible focus rings, 40px desktop and 44px phone original-action targets, and working image fallbacks. Reading and original-page callbacks remained separate.
- Ripwire found no gated quality regressions in this change after separating analytics rendering. The source-tree gate's two remaining findings belong to pre-existing volume-rocker/media-playback changes outside this task. The static reader test map did not recognize mocked Vitest coverage; direct reader and existing return-navigation tests passed.

## Outstanding checks

### 5.3 Live native extension smoke

The updated native application has not been rebuilt and restarted for a real browser-extension page/video save, reader open, original open, and View all smoke test. Repository/provenance tests, browser-extension tests, rendered interactions, and event lifecycle tests cover the constituent behavior, but do not substitute for that real running-app check. Leave the task unchecked.

### 5.4 Performance gate

Two full local `npm run bench:check` runs were performed. The first, while native compilation was active, exceeded three existing thresholds. The idle rerun reduced this to one failure:

- `audioEdition/recent-passage-30s-window-10k`: measured cost **0.04242**, versus baseline **0.018856** with tolerance **1.7** (limit **0.0320552**).

The audio implementation, its benchmark, its type-only dependency, seeded input helper, noise anchor, benchmark setup/config, and package manifests are byte-identical to HEAD. A focused run of that unchanged audio suite plus the noise anchor reproduced the failure (cost **0.04353**). The focused run is diagnostic only; it is not the required full gate.

The performance baseline was not relaxed and the audio code was not changed as part of this UI feature. The independently run bundle check passed, but the combined benchmark gate remains red, so leave task 5.4 unchecked. Resolve this separate existing performance failure before declaring the change fully validated.
