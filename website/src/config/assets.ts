import manifest from './asset-manifest.json' with { type: 'json' };

export interface MarketingAsset {
  id: string;
  kind: 'screenshot' | 'device-frame' | 'og' | 'icon' | 'video' | 'poster';
  sourcePath: string;
  publicPath: string;
  alt: string;
  license: string;
  attribution?: string;
  viewport: string;
  theme: 'light' | 'dark' | 'eink';
  buildId?: string;
  width?: number;
  height?: number;
  placeholder: boolean;
  fallbacks?: {
    avif?: string;
    webp?: string;
    png?: string;
  };
}

export interface MarketingAssetManifest {
  storyId: string;
  generatedAt?: string;
  assets: MarketingAsset[];
  blockers: string[];
}

/** Canonical marketing stills. Placeholders in `blockers` must not ship with PUBLIC_INDEXING=index. */
export const MARKETING_ASSETS: MarketingAssetManifest = manifest as MarketingAssetManifest;
