# Marketing scripts

Canonical fixture source: `marketing/demo-library/library.json`.
Scene source: `marketing/showcase-scenes-v2.source.json`.
Approved website captures: `marketing/screenshots/source/showcase-v2/` → `website/public/images/showcase/v2/`.
Active policy: `website/src/config/showcase-v2-active.json`.

The old `marketing/asset-manifest.json` and `website/public/images/product/`
pipeline is retained only for non-showcase legacy surfaces. It is quarantined
from showcase-v2.

## Seed (opt-in)

Does **not** run on normal installs.

```bash
# Build PDF/EPUB/WAV and copy into demo/books + demo/audio
MARKETING_SEED=1 node scripts/marketing/seed-demo-library.mjs

# Wipe seeded demo files only
MARKETING_SEED=1 node scripts/marketing/seed-demo-library.mjs --reset --reset-only
```

Re-seed after wipe: omit `--reset-only`. `SKIP_DEMO_IMPORT=1` still disables first-run import.

## Build the deterministic fixture and scene catalog

```bash
npm run marketing:fixture
npm run marketing:scenes
npm run marketing:fixture:tauri # only for the native disposable-profile path
```

Both compilers are deterministic. Review the fixture hash printed by
`marketing:fixture`; it must match the generated scene catalog and every
capture sidecar. The compiler rejects unlicensed files, external URLs,
personal/account data, broken references, unknown binaries, and commercial
covers.

## Author or change a scene

1. Edit `marketing/showcase-scenes-v2.source.json`. A real scene must declare
   sentinels, accessible description, predecessor/successors, layout support,
   fallback, and actions bound to stable `[data-showcase-action]` or
   `[data-showcase-region]` selectors in product UI.
2. Add or adjust a persisted fixture record in
   `marketing/demo-library/library.json`; never make a capture-only in-memory
   store the source of truth.
3. Run `npm run marketing:fixture`, `npm run marketing:scenes`, and
   `npm run test:scripts`. Unknown scenes, graph breaks, missing selectors,
   fixture drift, and unsupported required layouts fail closed.
4. If a real UI cannot deterministically reach the state, keep it optional and
   define an honest fallback. `explain.grounded` follows this rule and is
   omitted from the launch path until the real explanation UI supports a
   deterministic pre-authored injection path.

## Browser capture and encode

Start an explicit dev/capture build in one terminal:

```bash
npm run dev:pwa -- --host 127.0.0.1
```

Capture and encode in another terminal. Encoding never overwrites an existing
versioned set.

```bash
MARKETING_CAPTURE_URL=http://127.0.0.1:5173 npm run marketing:capture
MARKETING_CAPTURE_SET=marketing/screenshots/source/showcase-v2/<capture-run> npm run marketing:encode

cd website
npm run check:assets
```

The capture runner seeds a fresh hash-namespaced IndexedDB database before the
product mounts, disables motion, waits for fixture/scene/sentinel/font/image
readiness, measures hotspots from real controls, and publishes nothing unless
all 16 required scene/layout captures pass. Manually review every source PNG
before changing the active policy.

To activate a reviewed set, add its exact source and derivative directories to
`marketing/licenses/ATTRIBUTION.md`, classify older runs in
`marketing/screenshots/quarantine.json`, and update only
`website/src/config/showcase-v2-active.json`. The website validator confirms
the catalog, fixture/build/theme provenance, dimensions, paths, hashes, and
budgets.

## Rollback

Set `PUBLIC_SHOWCASE_V2_ENABLED=false` to render the server-only Reading Desk
poster and complete five-chapter narrative without the simulator. To roll back
assets, point `website/src/config/showcase-v2-active.json` at a previously
reviewed, still-present versioned manifest; never copy new files over an old
version directory. Rebuild and run the website gates before deployment.

## Native and store screenshots

Store screenshots must come from the native release-candidate simulator or a
dedicated physical device using `marketing/screenshots/native-capture-protocol.md`
and `marketing/demo-library/TAURI_IMPORT.md`. They use the same fixture and
scene IDs but a distinct `native-simulator` or `native-store-device` source
type and store-listing manifest. Browser CSS-viewport captures are never store
art, and native/device images are never website showcase inputs.

## Freshness

```bash
npm run marketing:freshness
PUBLIC_INDEXING=index npm run marketing:freshness
```

The indexed run still fails while legacy required stills or legal launch
blockers remain placeholders. Quarantine classifications prevent legacy,
superseded, and personal-device files from entering the active showcase without
deleting them.

Detailed browser protocol: `capture-screenshots.md`. Website visual snapshots
live under `website/tests/`; never update `src/visual/__snapshots__` from this
workflow.
