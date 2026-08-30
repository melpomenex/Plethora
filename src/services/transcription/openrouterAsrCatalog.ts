import bundledSnapshot from "./openrouter-asr-models.snapshot.json";
import { OPENROUTER_ASR_MODELS } from "./config";
import type { TranscriptionProviderId } from "./types";

export const OPENROUTER_ASR_CATALOG_URL =
  "https://openrouter.ai/api/v1/models?input_modalities=audio";
export const OPENROUTER_ASR_CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
export const OPENROUTER_ASR_CATALOG_STORAGE_KEY = "plethora-stt-openrouter-catalog-v1";

/** Curated ASR models when provider metadata is incomplete or for guaranteed UX. */
export const OPENROUTER_ASR_CURATED: readonly string[] = [
  OPENROUTER_ASR_MODELS.NEMOTRON,
  OPENROUTER_ASR_MODELS.QWEN_06,
  OPENROUTER_ASR_MODELS.QWEN_17,
];

export interface OpenRouterAsrModelInfo {
  id: string;
  name: string;
  description?: string;
  providerId?: TranscriptionProviderId;
}

export interface AsrCatalogResult {
  models: OpenRouterAsrModelInfo[];
  offline: boolean;
  source: "memory" | "localStorage" | "network" | "snapshot" | "curated";
  fetchedAt?: number;
}

interface StoredAsrCatalog {
  fetchedAt: number;
  models: OpenRouterAsrModelInfo[];
}

const OPENROUTER_MODEL_TO_PROVIDER: Record<string, TranscriptionProviderId> = {
  [OPENROUTER_ASR_MODELS.NEMOTRON]: "openrouter:nemotron-3.5",
  [OPENROUTER_ASR_MODELS.QWEN_06]: "openrouter:qwen3-asr-0.6b",
  [OPENROUTER_ASR_MODELS.QWEN_17]: "openrouter:qwen3-asr-1.7b",
};

let memory: StoredAsrCatalog | null = null;

function snapshotModels(): OpenRouterAsrModelInfo[] {
  const payload = (bundledSnapshot as { data?: unknown }).data ?? bundledSnapshot;
  return normalizeAsrModels(payload);
}

function hasAudioInputCapability(row: Record<string, unknown>): boolean {
  const arch = row.architecture;
  if (arch && typeof arch === "object") {
    const inputModalities = (arch as Record<string, unknown>).input_modalities
      ?? (arch as Record<string, unknown>).inputModalities;
    if (Array.isArray(inputModalities)) {
      return inputModalities.some(
        (m) => typeof m === "string" && (m === "audio" || m.includes("audio")),
      );
    }
  }
  const modalities = row.modalities ?? row.input_modalities ?? row.inputModalities;
  if (Array.isArray(modalities)) {
    return modalities.some(
      (m) => typeof m === "string" && (m === "audio" || m.includes("audio")),
    );
  }
  const id = typeof row.id === "string" ? row.id.toLowerCase() : "";
  return id.includes("asr") || id.includes("whisper") || id.includes("nemotron");
}

export function normalizeAsrModels(payload: unknown): OpenRouterAsrModelInfo[] {
  const rows = Array.isArray(payload) ? payload : [];
  const discovered = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id : "";
    if (!id || !hasAudioInputCapability(item)) return [];
    return [{
      id,
      name: typeof item.name === "string" ? item.name : id,
      description: typeof item.description === "string" ? item.description : undefined,
      providerId: OPENROUTER_MODEL_TO_PROVIDER[id],
    } satisfies OpenRouterAsrModelInfo];
  });

  const byId = new Map<string, OpenRouterAsrModelInfo>();
  for (const model of discovered) {
    byId.set(model.id, model);
  }
  for (const curatedId of OPENROUTER_ASR_CURATED) {
    if (!byId.has(curatedId)) {
      byId.set(curatedId, {
        id: curatedId,
        name: curatedId.split("/").pop() ?? curatedId,
        providerId: OPENROUTER_MODEL_TO_PROVIDER[curatedId],
      });
    }
  }
  return [...byId.values()];
}

function readLocal(): StoredAsrCatalog | null {
  try {
    const raw = localStorage.getItem(OPENROUTER_ASR_CATALOG_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredAsrCatalog>;
    if (typeof value.fetchedAt !== "number" || !Array.isArray(value.models)) return null;
    const models = normalizeAsrModels(value.models);
    return models.length ? { fetchedAt: value.fetchedAt, models } : null;
  } catch {
    return null;
  }
}

function writeLocal(value: StoredAsrCatalog): void {
  try {
    localStorage.setItem(OPENROUTER_ASR_CATALOG_STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* storage optional */
  }
}

async function fetchNetwork(apiKey?: string): Promise<StoredAsrCatalog> {
  const response = await fetch(OPENROUTER_ASR_CATALOG_URL, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`OpenRouter ASR catalog request failed (${response.status}).`);
  }
  const payload = await response.json() as { data?: unknown };
  const models = normalizeAsrModels(payload.data);
  if (!models.length) throw new Error("OpenRouter returned no ASR-capable models.");
  return { fetchedAt: Date.now(), models };
}

export interface AsrCatalogOptions {
  apiKey?: string;
  force?: boolean;
  allowNetwork?: boolean;
}

export async function loadOpenRouterAsrCatalog(
  options: AsrCatalogOptions = {},
): Promise<AsrCatalogResult> {
  const now = Date.now();
  if (!options.force && memory && now - memory.fetchedAt < OPENROUTER_ASR_CATALOG_TTL_MS) {
    return { models: memory.models, offline: false, source: "memory", fetchedAt: memory.fetchedAt };
  }

  const stored = !options.force ? readLocal() : null;
  if (stored && now - stored.fetchedAt < OPENROUTER_ASR_CATALOG_TTL_MS) {
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
      /* fall through */
    }
  }

  if (memory?.models.length) {
    return { models: memory.models, offline: true, source: "memory", fetchedAt: memory.fetchedAt };
  }
  if (stored?.models.length) {
    return { models: stored.models, offline: true, source: "localStorage", fetchedAt: stored.fetchedAt };
  }
  return { models: snapshotModels(), offline: true, source: "snapshot" };
}

export function clearOpenRouterAsrCatalogCache(): void {
  memory = null;
  try {
    localStorage.removeItem(OPENROUTER_ASR_CATALOG_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
