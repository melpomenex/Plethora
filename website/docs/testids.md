# `data-testid` convention

Marketing-site tests own these attributes. Prefer accessible role/heading queries; add a testid only when the role is ambiguous or the target is a slot other owners fill.

## Format

- kebab-case
- Prefix by surface when needed (`home-demo-slot`, not `demoSlot`)
- Do not encode copy in the id (ids stay stable when E rewrites headlines)

## Chrome / layout (foundation + quality gates)

| Attribute | Element |
|---|---|
| `data-testid="skip-link"` | Skip to content |
| `data-testid="site-header"` | Global header |
| `data-testid="site-nav"` | Primary nav |
| `data-testid="site-main"` | `#main` landmark |
| `data-testid="site-footer"` | Global footer |
| `data-testid="home-demo-slot"` | `#demo` island mount (also `data-home-demo-slot`) |
| `data-testid="demo-page"` | Focused `/demo` Reading Desk mount |

## Homepage / demo (B / D)

| Attribute | Element |
|---|---|
| `data-testid="mascot"` | Friendly Chirp / Knowledge Peck mark that may animate |
| `data-testid="device-frame"` | Screenshot frame that must reserve aspect-ratio |
| `data-claim-id="<claim id>"` | Optional marker when a claim from `claims.ts` is rendered |

Showcase interaction tests should prefer roles and stable manifest action
labels. Structural diagnostics may use `data-demo-island`,
`data-showcase-simulator`, `data-stage`, `data-mode`, `data-scene-image`,
`data-image-state`, `data-showcase-hotspot`, and `data-recommended`. These map
to state or contract identifiers, never to presentation copy.

## Historical quotes

Changelog (or any page) may quote former names if the containing element has `data-historical-quote`. Banned-phrase grep skips those subtrees.

## Visual snapshots

Website visual baselines belong in `website/tests/` only. Never update `src/visual/__snapshots__` from marketing capture. Update showcase baselines explicitly with `npm run test:e2e -- tests/e2e/showcase-responsive.spec.ts --update-snapshots`, review every rendered image, then rerun without the update flag.
