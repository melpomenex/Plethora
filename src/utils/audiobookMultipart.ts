/**
 * Multi-part audiobook filename detection (pure planning module).
 *
 * Ordering uses natural numeric comparison ("2" < "10").
 */

import { baseNameOf, naturalCompare, stripExtension } from "./naturalSort";

// Multi-part audiobook (single book in multiple files)
export interface MultiPartAudiobook {
  title: string;
  author?: string;
  parts: Array<{
    filePath: string;
    partNumber: number;
    duration?: number;
    chapterTitle?: string;
  }>;
  totalDuration: number;
}

/**
 * Derive a display title/author from a directory or folder name
 * ("Tolkien - The Hobbit" → author "Tolkien", title "The Hobbit").
 */
export function parseTitleFromName(name: string): { title: string; author?: string } {
  const cleaned = name
    .replace(/\s*\((?:unabridged|abridged|audiobook)\)\s*$/i, "")
    .replace(/^[\s._-]+|[\s._-]+$/g, "")
    .replace(/[_]+/g, " ")
    .trim();
  if (!cleaned) return { title: "Audiobook" };
  const parts = cleaned.split(" - ");
  if (parts.length >= 2) {
    const author = parts[0].trim();
    const title = parts.slice(1).join(" - ").trim();
    if (author && title) return { title, author };
  }
  return { title: cleaned };
}

/**
 * Derive a chapter title candidate from a file name: strip the extension and
 * obvious numbering ("004 - The Troll.mp3" → "The Troll", "Title - 03.mp3" →
 * "Title"). Trailing bare numbers without separators are preserved ("Catch 22" → "Catch 22").
 */
export function chapterTitleFromFileName(fileName: string, fallbackIndex?: number): string {
  const base = stripExtension(baseNameOf(fileName)).trim();

  // Bare chapter/track keywords: "Chapter 01", "Ch 2", "Track 03" without subtitle
  const simpleChapterMatch = base.match(/^(?:chapter|ch|track|trk|part|pt|section|sec)[\s._-]*(\d+)$/i);
  if (simpleChapterMatch) {
    return `Chapter ${parseInt(simpleChapterMatch[1], 10)}`;
  }

  const stripped = base
    // Strip leading track / chapter prefix with separator: "01 - Title", "01. Title", "Chapter 1 - Title"
    .replace(/^(?:(?:chapter|ch|track|trk|part|pt|section|sec)[\s._-]*)?\d+\s*(?:[-–—:._]\s*)+/i, "")
    // Leading track number with optional separator: "01 - Title", "001 Title".
    .replace(/^\s*\d+\s*(?:[-–—:._]\s*)?/, "")
    // Trailing part number behind an explicit separator: "Title - 03".
    .replace(/\s*[-–—:._]\s*\d+$/, "")
    .replace(/^[\s._-]+|[\s._-]+$/g, "")
    .trim();

  if (stripped) {
    return stripped;
  }
  if (fallbackIndex !== undefined && /^\d+$/.test(base)) {
    return `Chapter ${parseInt(base, 10) || fallbackIndex + 1}`;
  }
  return base;
}

/**
 * Format a human-friendly display chapter title. If derived title is a bare number
 * (e.g. "01" or "007"), formats it as "Chapter N".
 */
export function formatDisplayChapterTitle(fileName: string, index?: number): string {
  const derived = chapterTitleFromFileName(fileName, index);
  if (/^\d+$/.test(derived)) {
    const num = parseInt(derived, 10);
    return `Chapter ${!isNaN(num) ? num : index !== undefined ? index + 1 : derived}`;
  }
  return derived;
}

/**
 * Infer parent directory title, collapsing volume subfolders (e.g. Disc 1, CD 2).
 */
export function inferDirectoryTitle(paths: string[]): { title: string; author?: string } | null {
  if (paths.length === 0) return null;
  const dirs = paths.map((p) => {
    const norm = p.replace(/\\/g, "/");
    const idx = norm.lastIndexOf("/");
    return idx === -1 ? "" : norm.slice(0, idx);
  });

  // Collapse volume subfolders (e.g. "Disc 1", "CD 2") into their parent directory
  const collapsed = dirs.map((d) => {
    return d.replace(/\/(?:disc|disk|cd|part|pt|vol|volume)[\s._-]*\d+$/i, "");
  });
  const first = collapsed[0];
  if (!first) return null;
  if (!collapsed.every((d) => d === first)) return null;

  const folderName = first.split("/").filter(Boolean).pop();
  if (!folderName) return null;
  return parseTitleFromName(folderName);
}

// Detect if files are parts of the same book
export function detectMultiPartAudiobook(filePaths: string[]): MultiPartAudiobook | null {
  if (filePaths.length < 2) return null;

  // Sort files to ensure proper order (natural: "2" before "10")
  const sortedPaths = [...filePaths].sort(naturalCompare);
  const baseNames = sortedPaths.map((path) => stripExtension(baseNameOf(path)));

  const patterns = [
    // "Book Title Part 1", "Book Title Part 2"
    { regex: /^(.+?)\s+(?:part|pt|volume|vol|book|bk)\s*(\d+)$/i, group: 1 },
    // "Book Title - Part 1", "Book Title - Part 2"
    { regex: /^(.+?)\s*[-:]\s*(?:part|pt|volume|vol|book|bk)\s*(\d+)$/i, group: 1 },
    // "Book Title - 001", "Book Title - 002" (dash then number, no keyword)
    { regex: /^(.+?)\s*[-:]\s+(\d+)$/i, group: 1 },
    // "Book Title 1", "Book Title 2" (numbered at end)
    { regex: /^(.+?)\s+(\d+)$/i, group: 1 },
    // "01 Book Title", "02 Book Title" (numbered at start)
    { regex: /^(\d+)\s+(.+)$/i, group: 2 },
  ];

  for (const pattern of patterns) {
    const matches = baseNames.map((name) => name.match(pattern.regex));

    if (matches.every((m) => m !== null)) {
      const groups = matches.map((m) => m![pattern.group].trim());
      const partNumbers = matches.map((m) => parseInt(m![2]));

      const baseName = groups[0];
      const allSameBase = groups.every((g) => g === baseName);

      if (allSameBase) {
        const cleanedBase = baseName
          .replace(/\s*\((?:unabridged|abridged|audiobook)\)\s*$/i, "")
          .trim();

        const { title, author } = parseTitleFromName(cleanedBase);

        return {
          title,
          author,
          parts: sortedPaths.map((path, idx) => {
            const pNum = partNumbers[idx] || idx + 1;
            let chTitle = formatDisplayChapterTitle(path, idx);
            const escapedBase = baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            const partRegex = new RegExp(`^${escapedBase}\\s*[-:–—]?\\s*(?:part|pt|volume|vol|book|bk|chapter|ch)?\\s*(\\d+)$`, "i");
            const m = chTitle.match(partRegex);
            if (m) {
              chTitle = `Part ${m[1]}`;
            }
            return {
              filePath: path,
              partNumber: pNum,
              chapterTitle: chTitle,
            };
          }),
          totalDuration: 0,
        };
      }
    }
  }

  // Fallback: if filenames are very similar (differ only by number)
  if (baseNames.length >= 2) {
    const first = baseNames[0];
    const last = baseNames[baseNames.length - 1];

    // Find common prefix (removing trailing numbers)
    const firstWithoutNumbers = first.replace(/\d+\s*$/g, "").trim();
    const lastWithoutNumbers = last.replace(/\d+\s*$/g, "").trim();

    if (firstWithoutNumbers === lastWithoutNumbers && firstWithoutNumbers.length > 3) {
      const cleanedFallback = firstWithoutNumbers
        .replace(/\s*\((?:unabridged|abridged|audiobook)\)\s*$/i, "")
        .replace(/\s*[-:]\s*$/, "")
        .trim();
      const { title, author } = parseTitleFromName(cleanedFallback);

      return {
        title,
        author,
        parts: sortedPaths.map((path, idx) => ({
          filePath: path,
          partNumber: idx + 1,
          chapterTitle: formatDisplayChapterTitle(path, idx),
        })),
        totalDuration: 0,
      };
    }
  }

  // Check if files share a directory or volume subdirectories (e.g. "CD 1", "Disc 2")
  const dirInfo = inferDirectoryTitle(sortedPaths);
  if (dirInfo) {
    const allTrackNumbered = baseNames.every((name) =>
      /^\s*\d+[\s._-]+/.test(name) ||
      /^\s*\d+$/.test(name) ||
      /^(?:chapter|ch|track|trk|part|pt|section|sec|disc|cd)[\s._-]*\d+/i.test(name)
    );

    const hasVolumeFolder = sortedPaths.some((p) =>
      /\/(?:disc|disk|cd|part|pt|vol|volume)[\s._-]*\d+\//i.test(p.replace(/\\/g, "/"))
    );

    // In a directory, files must have track/chapter-numbering evidence or volume folder structure
    if (allTrackNumbered || hasVolumeFolder) {
      return {
        title: dirInfo.title,
        author: dirInfo.author,
        parts: sortedPaths.map((path, idx) => ({
          filePath: path,
          partNumber: idx + 1,
          chapterTitle: formatDisplayChapterTitle(path, idx),
        })),
        totalDuration: 0,
      };
    }
  }

  // Loose multi-file pick with track numbering or chapter indicators across all files:
  const allNumbered = baseNames.every((name) =>
    /^\s*\d+[\s._-]+/.test(name) ||
    /^\s*\d+$/.test(name) ||
    /^(?:chapter|ch|track|trk|part|pt|section|sec)[\s._-]*\d+/i.test(name)
  );
  if (allNumbered) {
    const parentName = inferDirectoryTitle(sortedPaths);
    const title = parentName?.title || "Audiobook";
    const author = parentName?.author;
    return {
      title,
      author,
      parts: sortedPaths.map((path, idx) => ({
        filePath: path,
        partNumber: idx + 1,
        chapterTitle: formatDisplayChapterTitle(path, idx),
      })),
      totalDuration: 0,
    };
  }

  return null;
}
