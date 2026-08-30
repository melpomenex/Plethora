/**
 * Multi-part audiobook filename detection (moved from src/api/audiobooks.ts
 * so pure planning code and its tests do not pull the API/store graph).
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
  }>;
  totalDuration: number;
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

        const titleParts = cleanedBase.split(" - ");
        const author = titleParts.length >= 2 ? titleParts[0].trim() : undefined;
        const title = titleParts.length >= 2
          ? titleParts.slice(1).join(" - ").trim()
          : baseName;

        return {
          title,
          author,
          parts: sortedPaths.map((path, idx) => ({
            filePath: path,
            partNumber: partNumbers[idx] || idx + 1,
          })),
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
      const titleParts = cleanedFallback.split(" - ");
      const author = titleParts.length >= 2 ? titleParts[0].trim() : undefined;
      const title = titleParts.length >= 2
        ? titleParts.slice(1).join(" - ").trim()
        : cleanedFallback;

      return {
        title,
        author,
        parts: sortedPaths.map((path, idx) => ({
          filePath: path,
          partNumber: idx + 1,
        })),
        totalDuration: 0,
      };
    }
  }

  return null;
}
