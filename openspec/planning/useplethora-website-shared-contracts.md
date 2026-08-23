# useplethora.com — Shared contracts

Owned by `create-useplethora-website-foundation`. Other website changes **consume** these types. They MUST NOT fork parallel shapes. Additive fields land only in `website/src/config/` files listed in the ownership table of the program plan.

TypeScript in this document is normative for implementers. The foundation change SHALL check these types into `website/src/config/*.ts` (or `.ts` modules imported from content collections).

## Platform identifiers

```ts
export type DesktopOs = "windows" | "macos" | "linux";
export type MobileOs = "ios" | "android";
export type PlatformId = DesktopOs | MobileOs;
export type CpuArch = "x64" | "arm64" | "universal";
```

Detection MAY use `navigator.userAgentData` then UA string. Detection MUST never hide other platforms.

## Launch state

```ts
export type IndexingMode = "index" | "noindex";
export type CtaMode = "enabled" | "disabled" | "waitlist" | "notify";

export interface LaunchFlags {
  indexing: IndexingMode;
  downloadsEnabled: boolean;
  checkoutEnabled: boolean;
  analyticsEnabled: boolean;
  demoEnabled: boolean;
  /** When true, public pages still render but store/download buttons are inert with an explanation. */
  commercialStorefrontReady: boolean;
}
```

Environment mapping (Vercel):

| Variable | Production default | Preview/staging default |
|---|---|---|
| `PUBLIC_INDEXING` | `index` only after launch gate | `noindex` |
| `PUBLIC_DOWNLOADS_ENABLED` | `false` until artifacts exist | `false` |
| `PUBLIC_CHECKOUT_ENABLED` | `false` until billing + entity exist | `false` |
| `PUBLIC_ANALYTICS_ENABLED` | `false` until provider + consent decision | `false` |
| `PUBLIC_SITE_ORIGIN` | `https://useplethora.com` | preview URL |
| `PUBLIC_PLAUSIBLE_DOMAIN` | unset until chosen | unset |

No secrets in `PUBLIC_*`. Server-only vars (if any) stay in Vercel, never committed.

## Download destinations

```ts
export type DownloadAvailability =
  | { status: "live"; href: string; arch?: CpuArch[]; store?: "direct" }
  | { status: "store"; href: string; store: "app-store" | "play-store" | "microsoft-store" }
  | { status: "coming-soon"; message: string }
  | { status: "disabled"; message: string };

export interface DownloadManifest {
  version?: string; // app semver once known
  updatedAt?: string; // ISO
  platforms: Record<PlatformId, DownloadAvailability>;
  systemRequirements: Record<PlatformId, string[]>;
}
```

Buttons for `coming-soon` and `disabled` MUST remain visible, not 404, not look like working download links.

## Pricing plans

```ts
export type BillingInterval = "month" | "year";

export interface DisplayPrice {
  amount: string; // "5.99" — display only, not charged
  currency: "USD";
  /** When true, show “localized in stores” footnote instead of claiming this is the store price. */
  storefrontLocalized: boolean;
}

export interface PlanDefinition {
  id: "free" | "pro";
  name: string;
  intervalPrices?: Partial<Record<BillingInterval, DisplayPrice>>;
  cta: {
    mode: CtaMode;
    href?: string; // stripe/paddle/store URL when enabled
    label: string;
  };
  features: PlanFeatureId[];
}

export type PlanFeatureId = string; // canonical ids from claim matrix, not ad-hoc copy
```

Initial **founder** display direction (NOT store truth, NOT in app code): Pro `$5.99` / month, about `$49.99` / year. Copy MUST say storefronts set local prices.

**SHALL NOT** display MockBilling / StoreKit fixture prices (`$9.99` / `$79.99` in `src/lib/billing/`).
The website MUST NOT embed any IAP prices inside the interactive demo.

## Feature claim states

```ts
export type ClaimStatus =
  | "implemented"
  | "tested"
  | "simulator-verified"
  | "device-verified"
  | "shipping"
  | "commercially-release-ready"
  | "planned"
  | "mocked"
  | "platform-limited"
  | "provider-dependent"
  | "blocked-external";

export type ClaimSurface = "homepage" | "features" | "pricing" | "downloads" | "trust" | "audience" | "demo";

export interface ProductClaim {
  id: string;
  statement: string;
  status: ClaimStatus;
  evidencePaths: string[];
  allowedSurfaces: ClaimSurface[];
  /** If false, the claim MUST NOT appear in public copy. */
  public: boolean;
  platforms?: PlatformId[];
  notes?: string;
}
```

Public copy may use a claim only when `public === true` AND status is one of `shipping`, `commercially-release-ready`, or `device-verified` for the platforms named. `implemented`/`tested`/`simulator-verified` MAY appear on staging with a “preview copy” banner, never on indexed production.

## Legal / business placeholders

```ts
export interface LegalPlaceholders {
  legalEntityName: string | null;
  jurisdiction: string | null;
  mailingAddress: string | null;
  supportEmail: string | null;
  privacyEmail: string | null;
  dunsNumber: string | null; // never display publicly even when set
  taxInformation: string | null;
  refundPolicyFinal: boolean;
  termsFinal: boolean;
  privacyFinal: boolean;
}
```

Missing fields render as clearly labeled draft banners on staging. Production indexable launch MUST NOT proceed while `termsFinal`, `privacyFinal`, or `legalEntityName` are unset. D-U-N-S MUST never be published on the website.

## Demo states

```ts
export type DemoContentKind = "book" | "article" | "pdf" | "podcast" | "video";

export type DemoStage =
  | "library"
  | "item"
  | "reader"
  | "passage"
  | "explain"
  | "remember-confirm"
  | "card"
  | "review-prompt"
  | "review-reveal"
  | "review-rate"
  | "schedule"
  | "connect"
  | "complete";

export interface DemoState {
  contentKind: DemoContentKind;
  stage: DemoStage;
  passageId: string;
  rating?: 1 | 2 | 3 | 4 | 5;
}

export const DEMO_PRIMARY_PATH: DemoStage[] = [
  "library",
  "item",
  "reader",
  "passage",
  "explain",
  "remember-confirm",
  "card",
  "review-prompt",
  "review-reveal",
  "review-rate",
  "schedule",
  "complete",
];
```

URL: `/#demo` or `/demo?kind=article&stage=reader` (optional). Invalid combos snap to `library`.

## Analytics events

Names are stable. Payloads MUST NOT include document text, typed input, emails, or fingerprints.

```ts
export type WebsiteAnalyticsEvent =
  | { name: "cta_get_plethora"; platform?: PlatformId; surface: string }
  | { name: "cta_all_downloads" }
  | { name: "download_platform_select"; platform: PlatformId }
  | { name: "download_click"; platform: PlatformId; availability: DownloadAvailability["status"] }
  | { name: "pricing_interval_select"; interval: BillingInterval }
  | { name: "pricing_plan_cta"; plan: "free" | "pro"; enabled: boolean }
  | { name: "demo_start"; kind: DemoContentKind }
  | { name: "demo_stage"; stage: DemoStage; kind: DemoContentKind }
  | { name: "demo_complete"; kind: DemoContentKind }
  | { name: "demo_restart" }
  | { name: "docs_view"; path: string }
  | { name: "checkout_start"; plan: "pro"; interval: BillingInterval }
  | { name: "checkout_complete"; plan: "pro" }; // server-side only if a provider exists
```

Local `astro dev`: analytics MUST be off unless `PUBLIC_ANALYTICS_ENABLED=true` is explicitly set.

## Marketing asset manifest

```ts
export interface MarketingAsset {
  id: string;
  kind: "screenshot" | "device-frame" | "og" | "icon" | "video" | "poster";
  sourcePath: string; // repo-relative, pre-optimization
  publicPath: string; // website/public/...
  alt: string;
  license: string; // SPDX or "proprietary-plethora"
  attribution?: string;
  viewport: string; // e.g. "iphone-14-390x844"
  theme: "light" | "dark" | "eink";
  buildId?: string; // app version / git sha of capture
  placeholder: boolean;
}

export interface MarketingAssetManifest {
  storyId: string; // e.g. "memory-sleep-cognition"
  generatedAt?: string;
  assets: MarketingAsset[];
  blockers: string[]; // placeholder ids that block launch
}
```

## Brand tokens (website)

Canonical mascot hexes (enforced in app by `src/__tests__/brandInventory.test.ts`):

| Token | Value | Use |
|---|---|---|
| `--plethora-violet-400` | `#8B5CF6` | mascot gradient |
| `--plethora-violet-500` | `#7C3AED` | mascot gradient / accent |
| `--plethora-violet-800` | `#5B21B6` | mascot gradient |
| `--plethora-beak` | `#F59E0B` | animated Chirp / Knowledge Peck beak |
| `--plethora-beak-icon` | `#6D28D9` | icon-master SVG beak only — do not mix with amber |
| `--plethora-pupil` | `#1E1B4B` | mascot pupil |
| `--plethora-boot` | `#0A0A0A` | Knowledge Peck boot surface |

Website surfaces MUST reuse these for the bird. Marketing chrome MUST NOT flood the page with purple gradients. Paper/ink neutrals are the page background; violet is a mark, not a wallpaper.

App UI still contains a Phase-B-pending green (`#6daa2c`, `BRANDING.md` D11 / RC F-31). Marketing MUST NOT adopt that green as the commercial identity.

## Copy constants

| Role | Text | Source |
|---|---|---|
| Primary promise | Everything you read. Remembered. | This program (overrides `PRODUCT_TAGLINE` for the public site) |
| Supporting line | Read anything. Learn everything. | `BRANDING.md`, `src/config/product.ts` (`PRODUCT_TAGLINE` today) |
| Journey | Capture → Read → Understand → Connect → Remember | This program |
| Trust heading | Your knowledge is yours. | This program |
| Final CTA | Don’t just save it. Remember it. | This program |
| Product name | Plethora | `PRODUCT_NAME` |
| Domain | useplethora.com | This program (not `plethora.app` placeholder) |
| Mascot | Friendly Chirp (P-bird) | `assets/brand/plethora-icon-master.svg` |
| Peck concept | Knowledge Peck | `openspec/changes/knowledge-peck-startup-animation/` |

Do not invent a second mascot. Do not publish `plethora.app` as a live domain unless DNS is actually configured.
