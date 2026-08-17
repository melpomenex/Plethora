import bundledSnapshot from "./openrouter-speech-models.snapshot.json";
import type { TTSModelInfo } from "./types";

export const OPENROUTER_CATALOG_URL = "https://openrouter.ai/api/v1/models?output_modalities=speech";
export const OPENROUTER_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
export const OPENROUTER_CATALOG_STORAGE_KEY = "plethora-tts-openrouter-catalog-v1";

export interface CatalogResult {
  models: TTSModelInfo[];
  offline: boolean;
  source: "memory" | "localStorage" | "network" | "snapshot";
  fetchedAt?: number;
}

interface StoredCatalog {
  fetchedAt: number;
  models: TTSModelInfo[];
}

let memory: StoredCatalog | null = null;

function snapshotModels(): TTSModelInfo[] {
  return normalizeModels((bundledSnapshot as { data?: unknown }).data || bundledSnapshot);
}

function normalizeModels(payload: unknown): TTSModelInfo[] {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : "";
    if (!id) return [];
    const supportedVoicesRaw = item.supported_voices ?? item.supportedVoices;
    const supportedVoices = supportedVoicesRaw === null
      ? null
      : Array.isArray(supportedVoicesRaw)
        ? supportedVoicesRaw.filter((value): value is string => typeof value === "string")
        : [];
    const supportedParametersRaw = item.supported_parameters ?? item.supportedParameters;
    const supportedParameters = Array.isArray(supportedParametersRaw)
      ? supportedParametersRaw.filter((value): value is string => typeof value === "string")
      : [];
    const pricing = typeof item.pricing === "object" && item.pricing !== null
      ? { prompt: (item.pricing as Record<string, unknown>).prompt as string | number | undefined, completion: (item.pricing as Record<string, unknown>).completion as string | number | undefined }
      : undefined;
    return [{
      id,
      name: typeof item.name === "string" ? item.name : id,
      description: typeof item.description === "string" ? item.description : undefined,
      vendor: typeof item.vendor === "string" ? item.vendor : id.split("/")[0],
      supportedVoices,
      supportedParameters,
      contextLength: typeof item.context_length === "number" ? item.context_length : typeof item.contextLength === "number" ? item.contextLength : 0,
      pricing,
    } satisfies TTSModelInfo];
  });
}

function withCostTiers(models: TTSModelInfo[]): TTSModelInfo[] {
  const priced = models.map((model) => {
    const value = typeof model.pricing?.prompt === "number" ? model.pricing.prompt : Number(model.pricing?.prompt);
    return Number.isFinite(value) && value >= 0 ? { model, value: value * 1_000_000 } : null;
  }).filter((item): item is { model: TTSModelInfo; value: number } => Boolean(item));
  if (!priced.length) return models;
  const sorted = [...priced].sort((a, b) => a.value - b.value);
  const lowCutoff = sorted[Math.floor((sorted.length - 1) / 3)].value;
  const highCutoff = sorted[Math.floor(((sorted.length - 1) * 2) / 3)].value;
  const prices = new Map(sorted.map(({ model, value }) => [model.id, { value, tier: value <= lowCutoff ? "low" : value >= highCutoff ? "high" : "medium" } as const]));
  return models.map((model) => {
    const price = prices.get(model.id);
    return price ? { ...model, costPerMillionTokens: price.value, costTier: price.tier } : model;
  });
}

function readLocal(): StoredCatalog | null {
  try {
    const raw = localStorage.getItem(OPENROUTER_CATALOG_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredCatalog>;
    if (typeof value.fetchedAt !== "number" || !Array.isArray(value.models)) return null;
    const models = withCostTiers(normalizeModels(value.models));
    return models.length ? { fetchedAt: value.fetchedAt, models } : null;
  } catch {
    return null;
  }
}

function writeLocal(value: StoredCatalog): void {
  try { localStorage.setItem(OPENROUTER_CATALOG_STORAGE_KEY, JSON.stringify(value)); } catch { /* storage is optional */ }
}

async function fetchNetwork(apiKey?: string): Promise<StoredCatalog> {
  const response = await fetch(OPENROUTER_CATALOG_URL, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
  if (!response.ok) throw new Error(`OpenRouter catalog request failed (${response.status}).`);
  const payload = await response.json() as { data?: unknown };
  const models = withCostTiers(normalizeModels(payload.data));
  if (!models.length) throw new Error("OpenRouter returned no speech models.");
  return { fetchedAt: Date.now(), models };
}

export interface CatalogOptions {
  apiKey?: string;
  force?: boolean;
  allowNetwork?: boolean;
}

export async function loadCatalog(options: CatalogOptions = {}): Promise<CatalogResult> {
  const now = Date.now();
  if (!options.force && memory && now - memory.fetchedAt < OPENROUTER_CATALOG_TTL_MS) {
    return { models: memory.models, offline: false, source: "memory", fetchedAt: memory.fetchedAt };
  }

  const stored = !options.force ? readLocal() : null;
  if (stored && now - stored.fetchedAt < OPENROUTER_CATALOG_TTL_MS) {
    memory = stored;
    return { models: stored.models, offline: false, source: "localStorage", fetchedAt: stored.fetchedAt };
  }

  if (options.allowNetwork !== false) {
    try {
      const fresh = await fetchNetwork(options.apiKey);
      memory = fresh;
      writeLocal(fresh);
      return { models: fresh.models, offline: false, source: "network", fetchedAt: fresh.fetchedAt };
    } catch {
      // Keep prior data below. A failed refresh must never blank a usable picker.
    }
  }

  if (memory?.models.length) return { models: memory.models, offline: true, source: "memory", fetchedAt: memory.fetchedAt };
  if (stored?.models.length) return { models: stored.models, offline: true, source: "localStorage", fetchedAt: stored.fetchedAt };
  const snapshot = withCostTiers(snapshotModels());
  return { models: snapshot, offline: true, source: "snapshot" };
}

export async function refreshCatalog(options: Omit<CatalogOptions, "force"> = {}): Promise<CatalogResult> {
  const prior = memory || readLocal();
  try {
    const fresh = await fetchNetwork(options.apiKey);
    memory = fresh;
    writeLocal(fresh);
    return { models: fresh.models, offline: false, source: "network", fetchedAt: fresh.fetchedAt };
  } catch (error) {
    if (prior?.models.length) return { models: prior.models, offline: true, source: "memory", fetchedAt: prior.fetchedAt };
    throw error;
  }
}

export async function getCatalog(options: CatalogOptions = {}): Promise<CatalogResult> {
  return loadCatalog(options);
}

export function clearCatalogCache(): void {
  memory = null;
  try { localStorage.removeItem(OPENROUTER_CATALOG_STORAGE_KEY); } catch { /* ignore */ }
}

export function deriveCostTiers(models: TTSModelInfo[]): TTSModelInfo[] {
  return withCostTiers(models);
}
