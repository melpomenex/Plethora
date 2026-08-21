# Design: Theme-Aware Mode Accent for Scroll Mode

## Context (repository findings)

**Theme architecture.** Themes are plain TypeScript objects conforming to `Theme`
(`src/types/theme.ts`). `ThemeColors` carries flat string colors (`primary`, `onPrimary`,
`secondary`, `surface`, `toolbar`, `link`, `success`, `warning`, …). There are three sources:

- 48 modern themes in `src/themes/builtin.ts` (one, `focus-compact`, spreads `focusTheme`),
  exported together as `builtInThemes`.
- ~121 legacy palettes in `src/themes/legacyIndex.ts`, converted at module load into the
  modern shape (`primary = def.text2`, `secondary = def.border2`) and spread into
  `builtInThemes` — **169 themes total**.
- User-imported custom themes: validated loosely in `ThemeContext.importTheme` (requires
  only `id`, `name`, `colors`) and persisted as full JSON in
  `localStorage["plethora-custom-themes"]`. Selected theme persists as a bare id string in
  `localStorage["plethora-last-theme"]`. No schema versioning exists.

`ThemeContext.applyThemeToDOM` (src/contexts/ThemeContext.tsx:84) writes every
`theme.colors` entry as an inline CSS variable `--color-<key>` on `documentElement`, plus
derived aliases (`--color-primary-foreground`, `--color-muted`, …). Tailwind v4 reads
tokens from the `@theme` block in `src/index.css`; runtime inline variables override those
defaults (this is how every theme works today). Utilities with opacity modifiers
(`bg-primary/15`) and `color-mix()` are already used in the codebase. Theme changes
(including hover-preview via `previewThemeId`) re-run `applyThemeToDOM`, so CSS-variable
consumers update instantly with no reload. Per-theme `customCSS` and vibrancy exist but
are irrelevant here.

There is **no color-math utility anywhere** (no luminance/contrast/OKLCH helper, no color
library in package.json). Some components use `bg-accent`/`text-accent-foreground`, but
`--color-accent` is not defined in `@theme` nor set at runtime — those utilities silently
resolve to nothing; they are precedent for naming only, not a working token.

**Scroll Mode surfaces.** "Scroll Mode" is launched from the reading queue and opens a
full-screen tab (`QueuePage.handleOpenScrollMode` → `type: "queue-scroll"` tab rendering
`QueueScrollPage`). Exactly two launcher controls exist:

- Desktop: `src/components/review/ReviewQueueView.tsx:1080-1095` — two-line button
  ("Scroll Mode" + subtext), `DeviceMobile` icon, `title` tooltip, **no disabled state**,
  styled `bg-gradient-to-r from-purple-500 to-pink-500 text-white` (introduced in commit
  `0ba9f392` "add tiktok scroll mode").
- Mobile: `src/components/mobile/MobileQueueView.tsx:719-728` — icon-only button, same
  gradient, `disabled={filteredItems.length === 0}` with `disabled:opacity-50`.

Related but out of scope: the RSS reader has two orange icon-only entries into the same
scroll page (`RSSReader.tsx:1722-1728, 1809-1818`) — they are theme-neutral already and
visually tied to the orange RSS brand; the in-scroll overlay chrome
(`ScrollOverlayControls`) uses its own dark translucent styling independent of theme.
Neither contains pink. The button represents **enabled / disabled states only** — there is
no persistent active/inactive toggle today; the pink gradient *is* the prominent
(enabled) appearance.

## Goals / Non-Goals

**Goals:**
- One semantic primitive — the mode accent — owned by the theme layer, consumable by any
  future special-mode control without coupling to Scroll Mode.
- Every one of the 169 built-in themes plus arbitrary custom themes resolves to a valid,
  contrast-safe, primary-distinct mode accent with zero theme-file edits required.
- Immediate correctness under live theme preview, theme switching, and restart.
- Non-color prominence cue so the state survives monochrome/e-ink/color-blind conditions.

**Non-Goals:**
- Redesigning the theme system, the queue toolbar, or Scroll Mode functionality/behavior.
- Recoloring RSS scroll entries, overlay chrome, or other special controls (primitive is
  available to them later, but they are not touched).
- Curating explicit accents for all 169 themes.
- Adding a color-library dependency.
- Changing how many themes exist or how themes are browsed/imported.

## Decisions

### D1 — Hybrid resolution: optional explicit value + deterministic derived fallback (Option C)

Add one optional field to `ThemeColors`:

```ts
/** Optional explicit accent for special-mode controls. When absent, a
 *  deterministic palette-derived accent is computed at theme-apply time. */
modeAccent?: string;
```

Precedence chain (each stage must produce a parseable color; otherwise fall through):

1. **Explicit** `theme.colors.modeAccent` — parsed, then lightness/chroma-clamped and
   contrast-corrected by the same rules as derived values (explicit sets the *hue intent*,
   the resolver still guarantees legibility).
2. **Best palette candidate** — score `secondary`, `link`, `success`, `warning`
   (alpha-flattened) from the theme; pick the highest-scoring per D2.
3. **Synthesized hue rotation** — rotate primary hue ±150° (direction chosen away from the
   closest palette candidate), clamp L/C to the variant-readable ranges in D3.
4. **Global default** — the static `@theme` fallback values (dark variant: desaturated
   cyan `#22d3ee`-family adjusted for legibility; light variant: deep indigo `#4f46e5`-family).
   Reached only when the theme's colors are entirely unparseable (corrupt custom theme);
   the CSS variables are therefore never undefined.

Rationale: 169 themes makes per-theme curation (Option A) a large, error-prone diff, and
inspection shows `secondary` is unreliable as a distinct accent — roughly half the modern
themes define it as a low-alpha neutral or a near-duplicate of primary hue (e.g.
`mistral-light` #ff8205/#ff9e33, glass family `rgba(148,163,184,0.5)`), so naive
"use secondary" (pure Option B) violates the distinctness goal. Hybrid gives curated
quality where wanted, automatic coverage everywhere, and a hard guarantee of valid output.
Pure derivation was rejected because a handful of themes (notably `biolume-abyss`,
`nordic-slate`, `abyssal-depths` — cyan/teal primaries where rotations stay in-family)
may need explicit overrides; those are added later, guided by the QA matrix in tasks.md,
and live **only inside theme definitions**.

### D2 — Derivation algorithm (normative for implementation)

New module `src/themes/modeAccent.ts` exporting
`resolveModeAccent(theme: Theme): { accent: string; foreground: string }` — pure,
synchronous, deterministic, no DOM access. Includes a minimal sRGB ⇄ OKLCH converter
(~80 lines, well-known Björn Ottosson math) plus WCAG relative-luminance/contrast ratio.
Emit colors as hex/rgba strings only — **never `oklch()`/`color-mix()` strings in CSS
variables**, because WebKitGTK/WebView2/WKWebView versions in the support matrix vary;
all perceptual math happens in JS.

Algorithm:

1. Normalize inputs: parse hex (`#rgb,#rgba,#rrggbb,#rrggbbaa`), `rgb()/rgba()`, and
   named-color-free assumption; flatten alpha over `theme.colors.background` using the
   existing `makeOpaque`-style logic (extract it from ThemeContext into the shared module
   rather than duplicating). Unparseable inputs are dropped from consideration.
2. Compute OKLCH for: `primary`, candidates (`secondary`, `link`, `success`, `warning`),
   and the button's surrounding surface (`toolbar` falling back to `card` then
   `background`).
3. **Monochrome detection:** if every candidate and primary has chroma C < 0.04, take the
   neutral path: `accent = onSurface/text` color (guaranteed high contrast by theme
   construction); prominence relies on the border/tint treatment (D5) and the non-color
   cues. Skip hue scoring.
4. Otherwise score each candidate:
   - `hueSep` = angular OKLCH hue distance to primary (0–180°).
   - `contrast` = WCAG ratio of candidate over surface.
   - Score passes iff `hueSep ≥ 60°` AND `contrast ≥ 3.0` AND `0.025 ≤ C ≤ 0.33`
     (excludes mud and neon). Rank passers by `(contrast normalized to [3,4.5] cap) +
     hueSep/180`; pick the top.
5. If no candidate passes, synthesize: start from primary hue, rotate by the smallest of
   `+150°/−150°` that maximizes distance from all candidate hues, set
   `C = clamp(primary.C, 0.08, 0.16)`.
6. Legibility clamp (applies to stages 1, 2, 5 alike): if `L(accent) − L(surface)` is
   negative-inverted (accent darker than a dark surface or lighter than a light surface
   beyond the 3:1 margin), mirror L across the surface-appropriate readable band
   (dark themes: L ∈ [0.55, 0.85]; light themes: L ∈ [0.35, 0.60]). Re-check contrast;
   nudge L in 0.02 steps until `contrast ≥ 3.0` against surface **and** against the
   blended button background `mix(accent 12%, surface)` (bounded loop, ≤ 10 steps).
7. `foreground`: pick `#ffffff` or `#0a0a0a` (whichever yields ≥ 4.5:1 against the final
   solid accent; prefer white on ties). Returned alongside accent for future solid-fill
   consumers; Scroll Mode itself uses tinted backgrounds, not solid fills.

Determinism: same theme object ⇒ same output, always (no randomness, no clock, no locale).
Cost: O(1) color math per theme application (~tens of microseconds); runs only inside
`applyThemeToDOM`.

### D3 — Tokens exposed

Resolver output is written by `applyThemeToDOM` as:

```ts
root.style.setProperty("--color-mode-accent", resolved.accent);
root.style.setProperty("--color-mode-accent-foreground", resolved.foreground);
```

`src/index.css` `@theme` gains static defaults (stage-4 values above) so the Tailwind
utilities `bg-mode-accent`, `text-mode-accent`, `border-mode-accent` (and their
`/opacity` modifiers) are generated:

```css
--color-mode-accent: #4f46e5;
--color-mode-accent-foreground: #ffffff;
```

No `--color-mode-accent-muted` variable: the codebase's established way to derive muted
surfaces from a base color is Tailwind opacity modifiers (`bg-primary/15` — used by the
RSS select-mode toggle) and `color-mix()`; introducing a third precomputed token would be
redundant configuration. The muted variant of the mode accent is expressed as
`bg-mode-accent/10`–`/20` at the call site. (The resolver still validates contrast
against that blend internally, see D2 step 6.)

Schema impact: one optional field; `exportTheme` round-trips it automatically
(JSON.stringify of the theme); `importTheme` needs no new validation beyond "parseable
color string if present" (invalid strings are ignored by the resolver, not rejected —
keeps imports lenient, matching current behavior).

### D4 — Component integration (no theme-name awareness)

Both launcher buttons consume only Tailwind token utilities. Shared class contract lives
in one exported constant so desktop/mobile cannot drift
(`src/components/queue/scrollModeEntry.ts`, ~10 lines):

```ts
// Prominent (enabled) state — replaces the pink gradient:
"border border-mode-accent/60 bg-mode-accent/10 text-mode-accent",
"hover:bg-mode-accent/20 hover:border-mode-accent",
// Disabled state unchanged: "disabled:opacity-50 disabled:cursor-not-allowed"
```

Desktop keeps its two-line layout, icon, subtext, `title` tooltip, and min-height; mobile
keeps its icon-only layout, `disabled` gating, and `active:scale-95`. Only the color
classes change. Focus rings: keep each platform's existing focus-visible treatment
(none is customized today; the border does not replace the focus indicator — keyboard
focus continues to use the browser/app default outline, which must not be suppressed).

Prominence model (mapping the request onto reality — the button is a launcher, not a
toggle): *inactive* = disabled state (ordinary muted control, unchanged); *prominent* =
enabled state above. Non-color cues that distinguish it from sibling controls: an
outlined/tinted construction vs. the filled `bg-primary` Start Session button, the
retained `DeviceMobile` icon + label, and position — no hue required. No animation is
added (e-ink friendly); the treatment is static tint + border, which degrades to a
visible gray box/outline on monochrome themes via the D2 neutral path.

Prohibited: any `if (theme.id === …)`/`switch (themeName)` in component code; any literal
pink/purple hex or Tailwind pink/purple class in Scroll Mode UI; computing colors inside
components.

### D5 — Reactivity and persistence

Because the tokens are CSS variables written by `applyThemeToDOM`, all required scenarios
work without new code paths: switching themes while a Scroll Mode tab is open (launcher
buttons re-render from vars; the open scroll page's own chrome is theme-independent),
hover-preview in the theme picker, rapid cycling (pure function, no caches), and restart
(persisted theme id resolves on boot; custom themes load before first paint decision as
today). No persistence-format change: selected theme remains an id string; custom themes
gain at most one optional JSON field.

## Risks / Trade-offs

- [Derived accent looks off on some themes] → Programmatic gate: a vitest suite iterates
  **all** `builtInThemes` (169) asserting parseability, contrast ≥ 3:1, and hue-sep ≥ 60°
  (or the neutral path); manual QA matrix on representative themes; explicit
  `modeAccent` added only to themes the matrix flags (overrides live in theme files).
- [OKLCH conversion bugs produce wrong hues] → Property-style unit tests around known
  hex↔oklch fixtures; converter kept dependency-free and table-tested.
- [Legacy palettes map `primary = text2` (sometimes low-chroma)] → Neutral path handles
  grayscale palettes; chroma floor in scoring excludes mud.
- [Alpha colors break naive parsing] → Parser handles `#rgba/#rrggbbaa/rgba()`; alpha
  flattened over background (precedent: `makeOpaque`).
- [Two launcher implementations drift] → Shared class constant imported by both views.
- [`bg-accent`-style silent-missing-token footgun] → `@theme` defaults committed in the
  same change as first usage, so utilities always exist.
- [Future consumers want solid fills] → `--color-mode-accent-foreground` shipped now so
  solid-fill usage is contrast-safe without another change.

## Migration Plan

Additive, single deploy. No data migration (persisted theme data is ids + custom-theme
JSON that tolerates extra/missing optional fields). Rollback = revert; unused CSS
variables and an unused optional theme field are inert.

## Open Questions

- None structural. Exact stage-4 default hexes and any explicit per-theme overrides are
  tuned during implementation against the QA matrix and do not alter this design.
