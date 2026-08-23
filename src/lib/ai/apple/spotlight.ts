import { invokeApple } from "./plugin";
import { appleErrorFromUnknown } from "./errors";
import { getAppleIntelligenceSnapshot } from "./capabilities";
import { useSettingsStore } from "../../../stores/settingsStore";
import type { RetrievalResponse } from "../../../api/ai-learning";

export function parsePlethoraUri(
  uri: string
): { kind: string; id: string } | null {
  const match = /^plethora:\/\/(document|chunk|extract|card)\/(.+)$/.exec(uri);
  if (!match) return null;
  return { kind: match[1], id: match[2] };
}

export async function appleSpotlightQuery(query: string, limit = 20) {
  try {
    return await invokeApple<{
      hits: Array<{ identifier: string; title?: string; uri?: string }>;
    }>("apple_spotlight_query", { payload: { query, limit } });
  } catch (error) {
    throw appleErrorFromUnknown(error);
  }
}

export async function mergeSpotlightIntoRetrieval(
  query: string,
  sqlite: RetrievalResponse
): Promise<RetrievalResponse> {
  const flags = useSettingsStore.getState().settings.features;
  if (!flags.appleSpotlightIndex) return sqlite;
  const snap = await getAppleIntelligenceSnapshot();
  if (snap.spotlightSemantic.status !== "available") return sqlite;

  let hits: Array<{ identifier: string; title?: string; uri?: string }> = [];
  try {
    const res = await appleSpotlightQuery(query, 20);
    hits = res.hits ?? [];
  } catch {
    return sqlite;
  }

  const byChunk = new Map(sqlite.results.map((r) => [r.chunkId, r]));
  let spotlightHitCount = 0;
  for (const hit of hits) {
    const parsed = parsePlethoraUri(hit.uri ?? hit.identifier);
    if (!parsed) continue;
    spotlightHitCount += 1;
    if (parsed.kind === "chunk" && byChunk.has(parsed.id)) {
      continue;
    }
    if (parsed.kind === "document") {
      continue;
    }
  }
  return {
    ...sqlite,
    results: [...byChunk.values()],
    candidatesScanned: sqlite.candidatesScanned + hits.length,
    spotlightHitCount,
  };
}

export async function mergeSpotlightIntoFts<T extends {
  id: string;
  documentId?: string;
  title?: string;
  excerpt?: string;
  score: number;
  resultType: string;
}>(query: string, results: T[]): Promise<T[]> {
  const flags = useSettingsStore.getState().settings.features;
  if (!flags.appleSpotlightIndex) return results;
  const snap = await getAppleIntelligenceSnapshot();
  if (snap.spotlightSemantic.status !== "available") return results;
  let hits: Array<{ identifier: string; title?: string; uri?: string }> = [];
  try {
    hits = (await appleSpotlightQuery(query, 20)).hits ?? [];
  } catch {
    return results;
  }
  const seen = new Set(
    results.flatMap((r) => [r.id, r.documentId].filter((v): v is string => Boolean(v))),
  );
  const extra: T[] = [];
  for (const hit of hits) {
    const parsed = parsePlethoraUri(hit.uri ?? hit.identifier);
    if (!parsed) continue;
    if (seen.has(parsed.id)) continue;
    seen.add(parsed.id);
    extra.push({
      id: parsed.id,
      resultType: parsed.kind === "extract" ? "extract" : "document",
      title: hit.title,
      excerpt: hit.title,
      score: 0,
      documentId: parsed.kind === "document" ? parsed.id : parsed.id,
    } as T);
  }
  return extra.length === 0 ? results : [...results, ...extra];
}
