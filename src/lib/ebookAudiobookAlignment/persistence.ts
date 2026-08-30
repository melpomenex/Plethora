import { invokeCommand, isTauri } from "../../lib/tauri";
import type { PlethoraAlignmentMap } from "./types";
import { ALIGNMENT_MAP_VERSION } from "./types";

function sidecarPath(pairId: string): string {
  return `alignments/v2/${pairId}.json`;
}

function cacheKey(pairId: string): string {
  return `plethora:alignment:v2:${pairId}`;
}

export async function saveAlignmentMap(map: PlethoraAlignmentMap): Promise<void> {
  const json = JSON.stringify(map);
  const path = sidecarPath(map.pairId);

  if (isTauri()) {
    try {
      const { appDataDir } = await import("@tauri-apps/api/path");
      const dir = await appDataDir();
      await invokeCommand("write_file", { path: `${dir}${path}`, contents: json });
      return;
    } catch {
      // fall through
    }
  }
  localStorage.setItem(cacheKey(map.pairId), json);
}

export async function loadAlignmentMap(pairId: string): Promise<PlethoraAlignmentMap | null> {
  if (isTauri()) {
    try {
      const { appDataDir } = await import("@tauri-apps/api/path");
      const dir = await appDataDir();
      const contents = await invokeCommand<string>("read_file", {
        path: `${dir}${sidecarPath(pairId)}`,
      });
      return parseMap(contents);
    } catch {
      // fall through
    }
  }
  const stored = localStorage.getItem(cacheKey(pairId));
  return stored ? parseMap(stored) : null;
}

export async function deleteAlignmentMap(pairId: string): Promise<void> {
  localStorage.removeItem(cacheKey(pairId));
  if (isTauri()) {
    try {
      const { appDataDir } = await import("@tauri-apps/api/path");
      const dir = await appDataDir();
      await invokeCommand("delete_file", { path: `${dir}${sidecarPath(pairId)}` });
    } catch {
      // ignore
    }
  }
}

function parseMap(json: string): PlethoraAlignmentMap | null {
  try {
    const map = JSON.parse(json) as PlethoraAlignmentMap;
    if (map.version !== ALIGNMENT_MAP_VERSION) return null;
    return map;
  } catch {
    return null;
  }
}

export function isAlignmentStale(
  map: PlethoraAlignmentMap,
  ebookHash: string,
  audioHash: string,
  transcriptFingerprint: string,
): boolean {
  return (
    map.ebookContentHash !== ebookHash ||
    map.audioContentHash !== audioHash ||
    map.transcriptFingerprint !== transcriptFingerprint
  );
}
