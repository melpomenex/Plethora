import type { Theme } from "../types/theme";

const MAX_THUMBNAIL_BYTES = 32 * 1024;
let importedThemeIdCounter = 0;

type ExportableTheme = Theme & {
  plethoraExport?: { version: 1; background: "colors-only" };
};

export function isAnimatedImageTheme(theme: Theme | undefined): boolean {
  const imageId = theme?.effects?.backgroundImage?.imageId;
  return Boolean(
    theme?.effects?.imageAnimation ||
    (typeof imageId === "string" && /^media:v1:anim-[a-z0-9-]{8,64}:poster$/.test(imageId))
  );
}

export function serializeThemeForExport(theme: Theme): string {
  const exported = JSON.parse(JSON.stringify(theme)) as ExportableTheme;
  if (isAnimatedImageTheme(theme)) {
    if (exported.effects) {
      delete exported.effects.backgroundImage;
      delete exported.effects.imageAnimation;
      if (Object.keys(exported.effects).length === 0) delete exported.effects;
    }
    exported.plethoraExport = { version: 1, background: "colors-only" };
  }
  return JSON.stringify(exported, null, 2);
}

/** Strip every imported local media handle; keep only a validated tiny swatch. */
export function sanitizeImportedTheme(value: unknown, existingThemes: Theme[]): Theme {
  if (!isRecord(value)) throw new Error("Invalid theme structure");
  const imported = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  const id = imported.id;
  if (typeof id !== "string" || !id.trim() || typeof imported.name !== "string" || !isRecord(imported.colors)) {
    throw new Error("Invalid theme structure");
  }

  const effects = isRecord(imported.effects) ? { ...imported.effects } : null;
  if (effects && isRecord(effects.backgroundImage)) {
    const backgroundImage = effects.backgroundImage;
    const imageId = typeof backgroundImage.imageId === "string" ? backgroundImage.imageId.trim() : "";
    if (imageId && isExternalMediaReference(imageId)) {
      throw new Error("Remote image references are not supported in theme JSON");
    }
    const thumbnailDataUrl = sanitizeThumbnailDataUrl(backgroundImage.thumbnailDataUrl);
    if (thumbnailDataUrl) {
      effects.backgroundImage = { imageId: "", thumbnailDataUrl };
    } else {
      delete effects.backgroundImage;
    }
  }
  if (effects) {
    delete effects.imageAnimation;
    if (Object.keys(effects).length === 0) delete imported.effects;
    else imported.effects = effects;
  } else if ("effects" in imported) {
    delete imported.effects;
  }
  delete imported.plethoraExport;

  const normalized = imported as unknown as Theme;
  if (existingThemes.some((theme) => theme.id === id && isAnimatedImageTheme(theme))) {
    normalized.id = createFreshImportedThemeId(id, existingThemes);
  }
  return normalized;
}

export function isExternalMediaReference(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (/^media:v1:anim-[a-z0-9-]{8,64}:(poster|pack)$/.test(normalized)) return false;
  return (
    normalized.startsWith("//") ||
    /^[a-z][a-z0-9+.-]*:/.test(normalized)
  );
}

export function sanitizeThumbnailDataUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > Math.ceil(MAX_THUMBNAIL_BYTES * 4 / 3) + 64) {
    return null;
  }
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(value);
  if (!match) return null;
  let decoded: string;
  try {
    if (typeof atob !== "function") return null;
    decoded = atob(match[2]);
  } catch {
    return null;
  }
  if (decoded.length <= 0 || decoded.length > MAX_THUMBNAIL_BYTES) return null;
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const mime = match[1].toLowerCase();
  if (mime === "png") {
    return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
      ? value
      : null;
  }
  if (mime === "jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      ? value
      : null;
  }
  return bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    ? value
    : null;
}

function createFreshImportedThemeId(originalId: string, existingThemes: Theme[]): string {
  const occupied = new Set(existingThemes.map((theme) => theme.id));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = createImportSuffix();
    const candidate = `${originalId.slice(0, 96)}-import-${suffix}`;
    if (!occupied.has(candidate)) return candidate;
  }
  throw new Error("A unique theme identifier could not be created");
}

function createImportSuffix(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  importedThemeIdCounter += 1;
  return `${Date.now().toString(36)}-${importedThemeIdCounter.toString(36)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
