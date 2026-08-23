/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly PUBLIC_INDEXING?: string;
  readonly PUBLIC_DOWNLOADS_ENABLED?: string;
  readonly PUBLIC_CHECKOUT_ENABLED?: string;
  readonly PUBLIC_ANALYTICS_ENABLED?: string;
  readonly PUBLIC_DEMO_ENABLED?: string;
  readonly PUBLIC_COMMERCIAL_STOREFRONT_READY?: string;
  readonly PUBLIC_SITE_ORIGIN?: string;
  readonly PUBLIC_PLAUSIBLE_DOMAIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
