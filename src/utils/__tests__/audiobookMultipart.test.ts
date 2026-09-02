import { describe, expect, it } from "vitest";
import {
  detectMultiPartAudiobook,
  chapterTitleFromFileName,
  formatDisplayChapterTitle,
  parseTitleFromName,
  inferDirectoryTitle,
} from "../audiobookMultipart";

describe("detectMultiPartAudiobook", () => {
  it("detects files matching standard patterns with parts", () => {
    const res = detectMultiPartAudiobook([
      "/books/The Hobbit Part 1.mp3",
      "/books/The Hobbit Part 2.mp3",
    ]);
    expect(res).not.toBeNull();
    expect(res?.title).toBe("The Hobbit");
    expect(res?.parts).toHaveLength(2);
    expect(res?.parts[0].chapterTitle).toBe("Part 1");
    expect(res?.parts[1].chapterTitle).toBe("Part 2");
  });

  it("detects directory of track-numbered chapter files", () => {
    const res = detectMultiPartAudiobook([
      "/Audiobooks/Frank Herbert - Dune/01 - Prologue.mp3",
      "/Audiobooks/Frank Herbert - Dune/02 - Chapter 1.mp3",
      "/Audiobooks/Frank Herbert - Dune/03 - Chapter 2.mp3",
    ]);
    expect(res).not.toBeNull();
    expect(res?.title).toBe("Dune");
    expect(res?.author).toBe("Frank Herbert");
    expect(res?.parts).toHaveLength(3);
    expect(res?.parts[0].chapterTitle).toBe("Prologue");
    expect(res?.parts[1].chapterTitle).toBe("Chapter 1");
    expect(res?.parts[2].chapterTitle).toBe("Chapter 2");
  });

  it("detects multi-disc folder structures", () => {
    const res = detectMultiPartAudiobook([
      "/Audiobooks/War and Peace/Disc 1/01.mp3",
      "/Audiobooks/War and Peace/Disc 1/02.mp3",
      "/Audiobooks/War and Peace/Disc 2/01.mp3",
    ]);
    expect(res).not.toBeNull();
    expect(res?.title).toBe("War and Peace");
    expect(res?.parts).toHaveLength(3);
    expect(res?.parts[0].chapterTitle).toBe("Chapter 1");
    expect(res?.parts[1].chapterTitle).toBe("Chapter 2");
    expect(res?.parts[2].chapterTitle).toBe("Chapter 1");
  });

  it("detects loose files with track numbering", () => {
    const res = detectMultiPartAudiobook([
      "/tmp/01 - The Beginning.mp3",
      "/tmp/02 - The Middle.mp3",
      "/tmp/03 - The End.mp3",
    ]);
    expect(res).not.toBeNull();
    expect(res?.parts).toHaveLength(3);
    expect(res?.parts[0].chapterTitle).toBe("The Beginning");
    expect(res?.parts[1].chapterTitle).toBe("The Middle");
    expect(res?.parts[2].chapterTitle).toBe("The End");
  });

  it("returns null for single file or unrelated loose files", () => {
    expect(detectMultiPartAudiobook(["/tmp/file.mp3"])).toBeNull();
    expect(detectMultiPartAudiobook(["/Downloads/song1.mp3", "/Downloads/notes.mp3"])).toBeNull();
  });
});

describe("chapter title and directory helpers", () => {
  it("formats display chapter title cleanly", () => {
    expect(formatDisplayChapterTitle("01.mp3", 0)).toBe("Chapter 1");
    expect(formatDisplayChapterTitle("007.mp3", 0)).toBe("Chapter 7");
    expect(formatDisplayChapterTitle("01 - An Unexpected Party.mp3", 0)).toBe("An Unexpected Party");
    expect(formatDisplayChapterTitle("Chapter 05.mp3", 0)).toBe("Chapter 5");
  });

  it("infers directory title with author separation and volume subfolder stripping", () => {
    expect(
      inferDirectoryTitle([
        "/media/audiobooks/Andy Weir - Project Hail Mary/Disc 1/track1.mp3",
        "/media/audiobooks/Andy Weir - Project Hail Mary/Disc 2/track1.mp3",
      ])
    ).toEqual({
      title: "Project Hail Mary",
      author: "Andy Weir",
    });
  });

  it("parses title and author from cleaned folder names", () => {
    expect(parseTitleFromName("George Orwell - 1984 (Audiobook)")).toEqual({
      title: "1984",
      author: "George Orwell",
    });
    expect(parseTitleFromName("The Great Gatsby (Unabridged)")).toEqual({
      title: "The Great Gatsby",
    });
  });
});
