# Showcase-v2 browser capture protocol

Website product scenes must come from the real Plethora UI and the compiled,
licensed `marketing-fixture-v2`. Do not draw missing controls, mutate stores
after mount, reuse personal databases, or update app visual-test snapshots.

## Pinned launch contract

- Theme: `plethora-purple`, light color scheme.
- Build ID: `<package-version>+<12-character-git-sha>`.
- Locale/timezone: `en-US`, UTC.
- Fixture: version `2.0.0` with its generated SHA-256 and fixed logical time.
- Layouts: desktop `1440×900` at DPR 1 and mobile `390×844` at DPR 1.
- Required path: `library.ready`, `reader.open`, `reader.selected`,
  `remember.preview`, `review.question`, `review.answer`, `review.scheduled`,
  `connections.context`.
- `explain.grounded`: catalogued but optional until the real explanation UI has
  deterministic pre-authored result injection. A mock is not an acceptable
  substitute.

The canonical values live in `marketing/screenshots/capture-policy.json`, and
the compiled graph lives in `marketing/generated/showcase-scenes-v2.json`.

## Regenerate fixture and scenes

```bash
npm run marketing:fixture
npm run marketing:scenes
npm run test:scripts
```

Commit or review compiler output before capture. The fixture hash in both
generated files must match. Scene actions must use stable selectors rendered by
real product controls; hotspot rectangles are measured from those controls.

## Start the explicit capture host

Development builds enable the capture adapter. A production build enables it
only with `VITE_MARKETING_CAPTURE_ENABLED=1`; a URL query alone never activates
fixture import.

```bash
npm run dev:pwa -- --host 127.0.0.1
```

The adapter deletes and recreates only the validated
`plethora-marketing-capture-v2-<fixture-hash-prefix>` IndexedDB namespace. It
commits the fixture before `MainLayout` mounts and verifies persisted documents,
extracts, learning items, files, queue records, sizes, and file hashes.

## Capture the atomic source set

```bash
MARKETING_CAPTURE_URL=http://127.0.0.1:5173 npm run marketing:capture
```

For each required scene/layout, the runner verifies:

- requested fixture, scene, layout, theme, locale, app build, and persisted
  fixture hash;
- expected text sentinels and stable real controls;
- no skeletons, loaders, error UI, placeholder labels, or unexpected titles;
- fonts and visible images decoded, stable animation frames, and no page error;
- requests remain on the capture origin; and
- normalized hotspots match one visible product control each.

The runner uses a staging directory and publishes it under
`marketing/screenshots/source/showcase-v2/<build-and-time>/` only after all 16
captures pass. A failed run writes no usable partial capture directory.

## Manual source review

Open all 16 PNGs and compare them with the named scene checklist. Confirm the
real app chrome, fictional licensed titles/content, expected action controls,
selection/review/schedule state, desktop/mobile legibility, no account or
personal data, and no loading/empty UI. Review `showcase-capture-v2.json` for
matching source hashes and provenance. Classify rejected runs in
`marketing/screenshots/quarantine.json`; do not delete unrelated device work.

## Encode without overwriting

```bash
MARKETING_CAPTURE_SET=marketing/screenshots/source/showcase-v2/<approved-run> npm run marketing:encode
```

The encoder rechecks all sources, then writes AVIF/WebP/PNG derivatives and
`asset-manifest-v2.json` to a new fixture/build-versioned directory under
`website/public/images/showcase/v2/`. It refuses to overwrite an existing set.

Update `website/src/config/showcase-v2-active.json` only after review. Then run:

```bash
cd website
npm test
npm run check
PUBLIC_SHOWCASE_V2_ENABLED=true npm run build
PUBLIC_SHOWCASE_V2_ENABLED=true npm run check:assets
PUBLIC_SHOWCASE_V2_ENABLED=true npm run check:dist
npm run test:e2e
```

`check:assets` validates active approval, provenance, complete layout coverage,
path containment, descriptions, dimensions, per-file hashes, and byte budgets.

## Rollback and native/store captures

Set `PUBLIC_SHOWCASE_V2_ENABLED=false` for the server-rendered Reading Desk
poster and ordered narrative. Asset rollback means pointing the active policy
to a previously reviewed immutable manifest and rebuilding; never edit a
versioned derivative directory in place.

Store screenshots require an installed native release candidate and the
disposable simulator/device procedure in
`marketing/screenshots/native-capture-protocol.md`. Native simulator/device
assets have distinct source types and manifests. They must never enter the
website CSS-viewport asset directory, and browser captures must never be
submitted as store screenshots.
