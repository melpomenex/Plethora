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

## Homepage / demo (B / D)

| Attribute | Element |
|---|---|
| `data-testid="mascot"` | Friendly Chirp / Knowledge Peck mark that may animate |
| `data-testid="device-frame"` | Screenshot frame that must reserve aspect-ratio |
| `data-claim-id="<claim id>"` | Optional marker when a claim from `claims.ts` is rendered |

## Historical quotes

Changelog (or any page) may quote former names if the containing element has `data-historical-quote`. Banned-phrase grep skips those subtrees.

## Visual snapshots

Website visual baselines belong in `website/tests/` only. Never update `src/visual/__snapshots__` from marketing capture. Update with an explicit `npm run test:visual:website -- --update-snapshots` when those tests exist.
