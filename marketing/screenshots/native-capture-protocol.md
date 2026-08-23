# Native simulator and store-device capture protocol

Native captures use the exact `marketing-fixture-v2` archive and scene IDs in
`marketing/generated/showcase-scenes-v2.json`. They are a separate source
class from Playwright CSS-viewport captures and must never be substituted for
one another.

## Disposable setup

1. Build the deterministic import archive with `npm run marketing:fixture` and
   `npm run marketing:fixture:tauri`. Record the printed fixture hash.
2. Wipe the simulator app container, or use a physical device dedicated to
   store capture. Install the intended release candidate and launch once so
   the real SQLite migrations complete.
3. Import through **Settings → Import / Export** as documented in
   `marketing/demo-library/TAURI_IMPORT.md`. Confirm 5 documents, 3 extracts,
   and 5 learning items. Never import into a normal user/developer profile.
4. Set the Plethora launch purple theme, `en-US` locale, deterministic system
   text size, light appearance, and a fixed 12:00 status-bar time. Disable
   notifications and account surfaces.

## Named scene checklist

Capture the same approved path, in order:

1. `library.ready` — five fixture documents, featured essay visible.
2. `reader.open` — featured essay at “Recognition is cheap”.
3. `reader.selected` — exact fixture sentence selected; Explain and Learn this
   controls visible.
4. `remember.preview` — pre-authored fixture question/answer in the real Learn
   this proposal sheet.
5. `review.question` — fixture card question with answer concealed.
6. `review.answer` — grounded answer with Good visible.
7. `review.scheduled` — Review Complete, Good, and three-day schedule outcome.
8. `connections.context` — recognition and effort/sleep neighbors visible.

`explain.grounded` is catalogued but omitted until the real explanation UI has
a deterministic pre-authored injection path. Do not replace it with mock UI.

For every scene, compare its sentinels and action labels to the generated
catalog. If the real native layout cannot reach a scene exactly, stop and mark
that scene unavailable; do not crop or composite controls into place.

## Output classes

- Simulator captures: `sourceType: native-simulator`, with simulator model, OS
  version, pixel size, scale, app build ID, fixture version/hash, theme,
  locale, scene ID, and capture time in the sidecar.
- Physical store captures: `sourceType: native-store-device`, with device
  model and native pixel dimensions. Keep Apple/Google store framing and
  required sizes in a dedicated store-listing manifest.
- Browser captures: `sourceType: playwright-css-viewport`. These are the only
  inputs accepted by the website showcase-v2 encoder.

Never place native store captures in a website CSS-viewport capture directory,
and never point the website active manifest at a native store-listing asset.
After review, wipe the disposable app container and retain the archive hash and
capture sidecars with the source set.
