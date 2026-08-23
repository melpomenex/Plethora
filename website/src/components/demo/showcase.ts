import activeRaw from '../../config/showcase-v2-active.json' with { type: 'json' };
import catalogRaw from '../../config/showcase-scenes-v2.json' with { type: 'json' };
import manifestRaw from '../../../public/images/showcase/v2/2.0.0-2.7.0+9a6e7dc075b2/asset-manifest-v2.json' with { type: 'json' };

export type ShowcaseLayout = 'desktop' | 'mobile';
export type ShowcaseChapter = 'Collect' | 'Read' | 'Understand' | 'Remember' | 'Return';

export interface ShowcaseRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShowcaseAction {
  id: string;
  label: string;
  nextSceneId: string;
  recommended: boolean;
}

export interface ShowcaseScene {
  id: string;
  chapter: ShowcaseChapter;
  narration: string;
  accessibleDescription: string;
  predecessor: string | null;
  successors: string[];
  fallbackSceneId: string;
  actions: ShowcaseAction[];
}

export interface ShowcaseHotspot {
  id: string;
  actionLabel: string;
  nextSceneId: string;
  rect: ShowcaseRect;
}

export interface ShowcaseFormatSource {
  path: string;
  width: number;
  sha256: string;
}

export interface ShowcaseAsset {
  sceneId: string;
  layout: ShowcaseLayout;
  accessibleDescription: string;
  intrinsicSize: { width: number; height: number };
  safeArea: ShowcaseRect;
  hotspots: ShowcaseHotspot[];
  formats: Record<'avif' | 'webp' | 'png', ShowcaseFormatSource[]>;
  fixtureVersion: string;
  fixtureHash: string;
  gitSha: string;
  sourceType: string;
  theme: string;
}

export interface ShowcaseModel {
  guidedPath: string[];
  scenes: ShowcaseScene[];
  assets: ShowcaseAsset[];
  metadata: {
    catalogId: string;
    fixtureVersion: string;
    fixtureHash: string;
    buildId: string;
    theme: string;
  };
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${label} must be a string array`);
  }
  return value as string[];
}

function parseAction(value: unknown, label: string): ShowcaseAction {
  const action = asRecord(value, label);
  return {
    id: asString(action.id, `${label}.id`),
    label: asString(action.label, `${label}.label`),
    nextSceneId: asString(action.nextSceneId, `${label}.nextSceneId`),
    recommended: action.recommended === true,
  };
}

function parseScene(value: unknown, index: number): ShowcaseScene {
  const label = `catalog.scenes[${index}]`;
  const scene = asRecord(value, label);
  const chapter = asString(scene.chapter, `${label}.chapter`);
  if (!['Collect', 'Read', 'Understand', 'Remember', 'Return'].includes(chapter)) {
    throw new Error(`${label}.chapter is not supported`);
  }
  return {
    id: asString(scene.id, `${label}.id`),
    chapter: chapter as ShowcaseChapter,
    narration: asString(scene.narration, `${label}.narration`),
    accessibleDescription: asString(
      scene.accessibleDescription,
      `${label}.accessibleDescription`,
    ),
    predecessor:
      scene.predecessor === null ? null : asString(scene.predecessor, `${label}.predecessor`),
    successors: asStringArray(scene.successors, `${label}.successors`),
    fallbackSceneId: asString(scene.fallbackSceneId, `${label}.fallbackSceneId`),
    actions: Array.isArray(scene.actions)
      ? scene.actions.map((action, actionIndex) => parseAction(action, `${label}.actions[${actionIndex}]`))
      : [],
  };
}

function parseRect(value: unknown, label: string): ShowcaseRect {
  const rect = asRecord(value, label);
  const result = {
    x: Number(rect.x),
    y: Number(rect.y),
    width: Number(rect.width),
    height: Number(rect.height),
  };
  if (
    Object.values(result).some((entry) => !Number.isFinite(entry) || entry < 0 || entry > 1) ||
    result.x + result.width > 1.001 ||
    result.y + result.height > 1.001
  ) {
    throw new Error(`${label} is outside normalized image bounds`);
  }
  return result;
}

function parseSources(value: unknown, label: string): ShowcaseFormatSource[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} is empty`);
  return value.map((entry, index) => {
    const source = asRecord(entry, `${label}[${index}]`);
    const path = asString(source.path, `${label}[${index}].path`);
    if (!path.startsWith('/images/showcase/v2/')) {
      throw new Error(`${label}[${index}] points outside the approved showcase directory`);
    }
    return {
      path,
      width: Number(source.width),
      sha256: asString(source.sha256, `${label}[${index}].sha256`),
    };
  });
}

function parseAsset(value: unknown, index: number): ShowcaseAsset {
  const label = `manifest.assets[${index}]`;
  const asset = asRecord(value, label);
  const layout = asString(asset.layout, `${label}.layout`);
  if (layout !== 'desktop' && layout !== 'mobile') throw new Error(`${label}.layout is invalid`);
  const size = asRecord(asset.intrinsicSize, `${label}.intrinsicSize`);
  const formats = asRecord(asset.formats, `${label}.formats`);
  const hotspots = Array.isArray(asset.hotspots) ? asset.hotspots : [];
  return {
    sceneId: asString(asset.sceneId, `${label}.sceneId`),
    layout,
    accessibleDescription: asString(
      asset.accessibleDescription,
      `${label}.accessibleDescription`,
    ),
    intrinsicSize: {
      width: Number(size.width),
      height: Number(size.height),
    },
    safeArea: parseRect(asset.safeArea, `${label}.safeArea`),
    hotspots: hotspots.map((entry, hotspotIndex) => {
      const hotspot = asRecord(entry, `${label}.hotspots[${hotspotIndex}]`);
      return {
        id: asString(hotspot.id, `${label}.hotspots[${hotspotIndex}].id`),
        actionLabel: asString(
          hotspot.actionLabel,
          `${label}.hotspots[${hotspotIndex}].actionLabel`,
        ),
        nextSceneId: asString(
          hotspot.nextSceneId,
          `${label}.hotspots[${hotspotIndex}].nextSceneId`,
        ),
        rect: parseRect(hotspot.rect, `${label}.hotspots[${hotspotIndex}].rect`),
      };
    }),
    formats: {
      avif: parseSources(formats.avif, `${label}.formats.avif`),
      webp: parseSources(formats.webp, `${label}.formats.webp`),
      png: parseSources(formats.png, `${label}.formats.png`),
    },
    fixtureVersion: asString(asset.fixtureVersion, `${label}.fixtureVersion`),
    fixtureHash: asString(asset.fixtureHash, `${label}.fixtureHash`),
    gitSha: asString(asset.gitSha, `${label}.gitSha`),
    sourceType: asString(asset.sourceType, `${label}.sourceType`),
    theme: asString(asset.theme, `${label}.theme`),
  };
}

export function parseShowcaseData(
  catalogValue: unknown,
  manifestValue: unknown,
  activeValue: unknown,
): ShowcaseModel {
  const catalog = asRecord(catalogValue, 'catalog');
  const manifest = asRecord(manifestValue, 'manifest');
  const active = asRecord(activeValue, 'active showcase policy');
  const catalogMetadata = asRecord(catalog.metadata, 'catalog.metadata');
  const manifestMetadata = asRecord(manifest.metadata, 'manifest.metadata');
  if (active.approved !== true || active.placeholder !== false) {
    throw new Error('active showcase policy is not approved for production use');
  }

  const metadata = {
    catalogId: asString(catalogMetadata.catalogId, 'catalog.metadata.catalogId'),
    fixtureVersion: asString(catalogMetadata.fixtureVersion, 'catalog.metadata.fixtureVersion'),
    fixtureHash: asString(catalogMetadata.fixtureHash, 'catalog.metadata.fixtureHash'),
    buildId: asString(manifestMetadata.buildId, 'manifest.metadata.buildId'),
    theme: asString(manifestMetadata.theme, 'manifest.metadata.theme'),
  };
  const expected = [
    ['catalogId', metadata.catalogId],
    ['fixtureVersion', metadata.fixtureVersion],
    ['fixtureHash', metadata.fixtureHash],
    ['buildId', metadata.buildId],
    ['theme', metadata.theme],
  ] as const;
  for (const [key, value] of expected) {
    if (manifestMetadata[key] !== value || active[key] !== value) {
      throw new Error(`showcase ${key} does not match the active policy`);
    }
  }

  const scenes = Array.isArray(catalog.scenes)
    ? catalog.scenes.map((scene, index) => parseScene(scene, index))
    : [];
  const assets = Array.isArray(manifest.assets)
    ? manifest.assets.map((asset, index) => parseAsset(asset, index))
    : [];
  const guidedPath = asStringArray(catalog.guidedPath, 'catalog.guidedPath');
  const sceneIds = new Set(scenes.map((scene) => scene.id));

  for (const sceneId of guidedPath) {
    if (!sceneIds.has(sceneId)) throw new Error(`guided scene ${sceneId} is missing from the catalog`);
    for (const layout of ['desktop', 'mobile'] as const) {
      if (!assets.some((asset) => asset.sceneId === sceneId && asset.layout === layout)) {
        throw new Error(`guided scene ${sceneId} is missing its ${layout} asset`);
      }
    }
  }
  for (const asset of assets) {
    if (
      asset.fixtureVersion !== metadata.fixtureVersion ||
      asset.fixtureHash !== metadata.fixtureHash ||
      asset.gitSha !== active.gitSha ||
      asset.theme !== metadata.theme ||
      asset.sourceType !== active.sourceType
    ) {
      throw new Error(`asset ${asset.sceneId}/${asset.layout} violates the active policy`);
    }
    const scene = scenes.find((candidate) => candidate.id === asset.sceneId);
    if (!scene) throw new Error(`asset ${asset.sceneId}/${asset.layout} has no catalog scene`);
    for (const hotspot of asset.hotspots) {
      const action = scene.actions.find((candidate) => candidate.id === hotspot.id);
      if (!action || action.label !== hotspot.actionLabel || action.nextSceneId !== hotspot.nextSceneId) {
        throw new Error(`hotspot ${asset.sceneId}/${asset.layout}/${hotspot.id} is not catalog-backed`);
      }
    }
  }

  return { guidedPath, scenes, assets, metadata };
}

export const SHOWCASE = parseShowcaseData(catalogRaw, manifestRaw, activeRaw);
export const SHOWCASE_SCENE_IDS = SHOWCASE.guidedPath as readonly string[];

export const NARRATIVE_SCENES: Readonly<Record<ShowcaseChapter, string>> = {
  Collect: 'library.ready',
  Read: 'reader.open',
  Understand: 'reader.selected',
  Remember: 'review.question',
  Return: 'connections.context',
};

export function getShowcaseScene(sceneId: string): ShowcaseScene | undefined {
  return SHOWCASE.scenes.find((scene) => scene.id === sceneId);
}

export function getShowcaseAsset(
  sceneId: string,
  layout: ShowcaseLayout,
): ShowcaseAsset | undefined {
  return SHOWCASE.assets.find((asset) => asset.sceneId === sceneId && asset.layout === layout);
}

export function hasShowcaseAsset(sceneId: string, layout: ShowcaseLayout): boolean {
  return getShowcaseAsset(sceneId, layout) !== undefined;
}

export function sourceSet(sources: ShowcaseFormatSource[]): string {
  return sources.map((source) => `${source.path} ${source.width}w`).join(', ');
}
