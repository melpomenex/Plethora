/**
 * Semantic audiobook import planning (openspec change
 * fix-multipart-audiobook-language-gating-and-entitlement-persistence).
 *
 * Folder/multi-file picks yield physical file lists; this pure module turns
 * them into *semantic* import units before anything is persisted, so a
 * directory representing one multi-file audiobook imports as ONE library item
 * instead of N documents.
 *
 * Grouping evidence, strongest first:
 *  1. Directory boundaries — every subdirectory is its own candidate book.
 *  2. Volume-keyword subfolders (`Disc 1`, `CD 2`, `Part 10`, …) merge into
 *     their parent directory's group.
 *  3. A folder *pick* means the picked root itself is a unit: loose audio at
 *     the root of a picked folder forms one book titled by the folder name.
 *  4. Multi-file *picks* (no folder semantics) group only on filename-pattern
 *     evidence (a shared base title with per-file numbering).
 */

import {
  detectMultiPartAudiobook,
  parseTitleFromName,
  chapterTitleFromFileName,
  formatDisplayChapterTitle,
} from "./audiobookMultipart";
import { isAudiobookFile } from "./audioFormats";
import { baseNameOf, naturalCompare, stripExtension } from "./naturalSort";

export {
  parseTitleFromName,
  chapterTitleFromFileName,
  formatDisplayChapterTitle,
};

export interface PlannerStagedFile {
  path: string;
  relativePath?: string;
  fileName?: string;
}

export interface MultipartBookPlan {
  title: string;
  author?: string;
  /** Parts in natural play order (filename order; embedded track/disc metadata
   * re-orders them Rust-side during import when tags provide it). */
  files: PlannerStagedFile[];
  /** Directory the group was derived from ("" for the picked root), used for
   * logging/diagnostics only. */
  groupKey: string;
}

export interface AudiobookImportPlan {
  audiobooks: MultipartBookPlan[];
  /** Audio files that import standalone (one document each), plus every
   * non-audio file, in original order. */
  standalonePaths: string[];
}

export interface PlanAudiobookImportsOptions {
  /** True when the files came from a FOLDER pick (the root is itself a
   * semantic unit). False for loose multi-file picks. */
  rootIsPickedFolder: boolean;
}

/** Sibling folder names that denote volumes of the parent book. */
const VOLUME_FOLDER_PATTERN =
  /^(?:disc|disk|cd|part|pt|vol|volume|book|chapter|side)[\s._-]*(\d+)$/i;

function directoryOf(relativePath: string): string {
  const idx = relativePath.lastIndexOf("/");
  return idx === -1 ? "" : relativePath.slice(0, idx);
}

function lastSegment(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

function parentDirectory(dir: string): string {
  const idx = dir.lastIndexOf("/");
  return idx === -1 ? "" : dir.slice(0, idx);
}

/** Best-effort common directory prefix of the paths (always "/"-terminated). */
function commonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return "";
  let prefix = paths[0];
  for (const p of paths) {
    while (prefix && !p.startsWith(prefix)) {
      const idx = prefix.lastIndexOf("/");
      prefix = idx === -1 ? "" : prefix.slice(0, idx);
    }
    if (!prefix) break;
  }
  if (!prefix) return "";
  if (prefix.endsWith("/")) return prefix;
  // The prefix is a true directory boundary only when every path continues
  // with "/" after it; otherwise it ends mid-segment ("/Vol" of "/Volume 1")
  // and must be trimmed back.
  if (paths.every((p) => p === prefix || p.startsWith(`${prefix}/`))) {
    return `${prefix}/`;
  }
  return prefix.replace(/[^/]*$/, "");
}

function inferPickedRootName(paths: string[]): string | null {
  const prefix = commonPathPrefix(paths);
  const segs = prefix.split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1] : null;
}

function sortByNaturalOrder(files: PlannerStagedFile[]): PlannerStagedFile[] {
  return files.slice().sort((a, b) =>
    naturalCompare(
      (a.relativePath || a.fileName || baseNameOf(a.path)).replace(/\\/g, "/"),
      (b.relativePath || b.fileName || baseNameOf(b.path)).replace(/\\/g, "/"),
    ),
  );
}

/**
 * Plan semantic import units from a staged file list. Pure: no I/O, no stores.
 */
export function planAudiobookImports(
  files: PlannerStagedFile[],
  options: PlanAudiobookImportsOptions,
): AudiobookImportPlan {
  const audio: PlannerStagedFile[] = [];
  // Standalone candidates keep their original index so the plan's standalone
  // list preserves the picker's file order (import progress matches it).
  const standalones: Array<{ index: number; path: string }> = [];

  files.forEach((file, index) => {
    const name = file.fileName || baseNameOf(file.path);
    if (isAudiobookFile(name) || isAudiobookFile(file.path)) {
      audio.push({ ...file, fileName: name });
    } else {
      standalones.push({ index, path: file.path });
    }
  });

  const collectStandalone = (extra: PlannerStagedFile[]): string[] => {
    // Demoted audio files rejoin the non-audio ones in the picker's order.
    const indexed = new Map(files.map((f, i) => [f.path, i] as const));
    const merged = [...standalones];
    for (const f of extra) {
      merged.push({ index: indexed.get(f.path) ?? files.length, path: f.path });
    }
    return merged.sort((a, b) => a.index - b.index).map((s) => s.path);
  };

  if (audio.length === 0) {
    return { audiobooks: [], standalonePaths: standalones.map((s) => s.path) };
  }

  // Multi-file picks (no folder semantics): one group only when every
  // filename matches a shared base pattern; otherwise all standalone.
  if (!options.rootIsPickedFolder) {
    if (audio.length >= 2) {
      const detected = detectMultiPartAudiobook(audio.map((f) => f.path));
      if (detected) {
        return {
          audiobooks: [
            {
              title: detected.title,
              author: detected.author,
              files: sortByNaturalOrder(audio),
              groupKey: "",
            },
          ],
          standalonePaths: standalones.map((s) => s.path),
        };
      }
    }
    return { audiobooks: [], standalonePaths: collectStandalone(audio) };
  }

  // Folder pick: group by directory, then merge volume subfolders into parents.
  // When the picker did not provide relativePaths, derive them from the common
  // path prefix so directory semantics still hold.
  const allPaths = files.map((f) => f.path.replace(/\\/g, "/"));
  const prefix = commonPathPrefix(allPaths);
  const withRelative: Array<{ file: PlannerStagedFile; rel: string }> = audio.map((file) => ({
    file,
    rel:
      file.relativePath?.replace(/\\/g, "/") ??
      file.path.replace(/\\/g, "/").slice(prefix.length),
  }));

  const groups = new Map<string, PlannerStagedFile[]>();
  for (const { file, rel } of withRelative) {
    const dir = directoryOf(rel);
    const bucket = groups.get(dir) ?? [];
    bucket.push(file);
    groups.set(dir, bucket);
  }

  // Fold each volume-keyword directory into its parent's group.
  const dirNames = [...groups.keys()];
  for (const dir of dirNames) {
    if (dir === "") continue;
    if (!VOLUME_FOLDER_PATTERN.test(lastSegment(dir))) continue;
    const parent = parentDirectory(dir);
    const bucket = groups.get(dir);
    if (!bucket || bucket.length === 0) continue;
    const parentBucket = groups.get(parent) ?? [];
    groups.set(parent, [...parentBucket, ...bucket]);
    groups.delete(dir);
  }

  const rootName = inferPickedRootName(allPaths);
  const audiobooks: MultipartBookPlan[] = [];
  const demoted: PlannerStagedFile[] = [];

  for (const [dir, bucket] of groups) {
    if (bucket.length < 2) {
      demoted.push(...bucket);
      continue;
    }
    const ordered = sortByNaturalOrder(bucket);
    if (dir === "") {
      // The picked folder itself is the semantic unit (chapter files living
      // directly in the book folder share no filename base, so this is the
      // only evidence that can catch them).
      const { title, author } = parseTitleFromName(rootName ?? "");
      audiobooks.push({ title, author, files: ordered, groupKey: dir });
    } else {
      const { title, author } = parseTitleFromName(lastSegment(dir));
      audiobooks.push({ title, author, files: ordered, groupKey: dir });
    }
  }

  // Deterministic plan order: by title, mirroring natural book sorting.
  audiobooks.sort((a, b) => naturalCompare(a.title, b.title));

  return { audiobooks, standalonePaths: collectStandalone(demoted) };
}
