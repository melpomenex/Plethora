import { describe, expect, it } from "vitest";
import {
  chapterTitleFromFileName,
  planAudiobookImports,
  type PlannerStagedFile,
} from "../audiobookImportPlanner";

function staged(path: string, relativePath?: string): PlannerStagedFile {
  const rel = relativePath ?? path.split("/").pop() ?? path;
  return { path, relativePath: rel, fileName: rel.split("/").pop() ?? rel };
}

function folderPick(files: Array<[string, string]>) {
  return planAudiobookImports(
    files.map(([path, rel]) => staged(path, rel)),
    { rootIsPickedFolder: true },
  );
}

function loosePick(paths: string[]) {
  return planAudiobookImports(
    paths.map((p) => staged(p, undefined)),
    { rootIsPickedFolder: false },
  );
}

describe("planAudiobookImports — folder picks", () => {
  it("basic multipart: chapter-named tracks in the picked root become ONE book", () => {
    const plan = folderPick([
      ["/books/The Hobbit/01 - An Unexpected Party.mp3", "01 - An Unexpected Party.mp3"],
      ["/books/The Hobbit/02 - Roast Mutton.mp3", "02 - Roast Mutton.mp3"],
      ["/books/The Hobbit/03 - A Short Rest.mp3", "03 - A Short Rest.mp3"],
    ]);
    expect(plan.audiobooks).toHaveLength(1);
    expect(plan.standalonePaths).toHaveLength(0);
    expect(plan.audiobooks[0].title).toBe("The Hobbit");
    expect(plan.audiobooks[0].files).toHaveLength(3);
  });

  it("natural sort: 1, 2, 10 order regardless of lexicographic scrambling", () => {
    const plan = folderPick([
      ["/b/10.mp3", "10.mp3"],
      ["/b/1.mp3", "1.mp3"],
      ["/b/2.mp3", "2.mp3"],
    ]);
    expect(plan.audiobooks[0].files.map((f) => f.fileName)).toEqual(["1.mp3", "2.mp3", "10.mp3"]);
  });

  it("multiple books in one selected root are separated", () => {
    const plan = folderPick([
      ["/a/A/01.mp3", "A/01.mp3"],
      ["/a/A/02.mp3", "A/02.mp3"],
      ["/a/B/01.mp3", "B/01.mp3"],
      ["/a/B/02.mp3", "B/02.mp3"],
      ["/a/notes.pdf", "notes.pdf"],
    ]);
    expect(plan.audiobooks).toHaveLength(2);
    expect(plan.audiobooks.map((b) => b.title).sort()).toEqual(["A", "B"]);
    expect(plan.standalonePaths).toEqual(["/a/notes.pdf"]);
  });

  it("multi-disc layout merges into one book in order", () => {
    const plan = folderPick([
      ["/books/Book/Disc 1/01.mp3", "Book/Disc 1/01.mp3"],
      ["/books/Book/Disc 1/02.mp3", "Book/Disc 1/02.mp3"],
      ["/books/Book/Disc 2/01.mp3", "Book/Disc 2/01.mp3"],
    ]);
    expect(plan.audiobooks).toHaveLength(1);
    expect(plan.audiobooks[0].title).toBe("Book");
    expect(plan.audiobooks[0].files.map((f) => f.relativePath)).toEqual([
      "Book/Disc 1/01.mp3",
      "Book/Disc 1/02.mp3",
      "Book/Disc 2/01.mp3",
    ]);
  });

  it("volume-keyword subfolders (Part 1/Part 2, cd2, Disk 10) merge under the parent", () => {
    const plan = folderPick([
      ["/b/Book/Part 1/a.mp3", "Book/Part 1/a.mp3"],
      ["/b/Book/Part 2/b.mp3", "Book/Part 2/b.mp3"],
      ["/b/Other/cd2/c.mp3", "Other/cd2/c.mp3"],
      ["/b/Other/cd1/d.mp3", "Other/cd1/d.mp3"],
      ["/b/Z/Disk 9/e.mp3", "Z/Disk 9/e.mp3"],
      ["/b/Z/Disk 10/f.mp3", "Z/Disk 10/f.mp3"],
    ]);
    expect(plan.audiobooks).toHaveLength(3);
    const byTitle = new Map(plan.audiobooks.map((b) => [b.title, b]));
    expect(byTitle.get("Book")?.files).toHaveLength(2);
    expect(byTitle.get("Other")?.files).toHaveLength(2);
    expect(byTitle.get("Z")?.files).toHaveLength(2);
  });

  it("mixed import: book folder + PDF + markdown", () => {
    const plan = folderPick([
      ["/b/Book/01.mp3", "Book/01.mp3"],
      ["/b/Book/02.mp3", "Book/02.mp3"],
      ["/b/paper.pdf", "paper.pdf"],
      ["/b/notes.md", "notes.md"],
    ]);
    expect(plan.audiobooks).toHaveLength(1);
    expect(plan.standalonePaths).toEqual(["/b/paper.pdf", "/b/notes.md"]);
  });

  it("standalone audio: single file in the picked root imports standalone", () => {
    const plan = folderPick([
      ["/b/interview.mp3", "interview.mp3"],
      ["/b/doc.pdf", "doc.pdf"],
    ]);
    expect(plan.audiobooks).toHaveLength(0);
    expect(plan.standalonePaths).toEqual(["/b/interview.mp3", "/b/doc.pdf"]);
  });

  it("a single-file book subfolder imports standalone (not a one-file book)", () => {
    const plan = folderPick([
      ["/b/BookA/01.mp3", "BookA/01.mp3"],
      ["/b/BookB/01.mp3", "BookB/01.mp3"],
      ["/b/BookB/02.mp3", "BookB/02.mp3"],
    ]);
    expect(plan.audiobooks).toHaveLength(1);
    expect(plan.audiobooks[0].title).toBe("BookB");
    expect(plan.standalonePaths).toEqual(["/b/BookA/01.mp3"]);
  });

  it("flat folder of unrelated audio becomes one book titled by the folder", () => {
    const plan = folderPick([
      ["/Downloads/podcast_ep1.mp3", "podcast_ep1.mp3"],
      ["/Downloads/song.mp3", "song.mp3"],
    ]);
    expect(plan.audiobooks).toHaveLength(1);
    expect(plan.audiobooks[0].title).toBe("Downloads");
  });

  it("uppercase extensions are still audio", () => {
    const plan = folderPick([
      ["/b/Book/01.MP3", "Book/01.MP3"],
      ["/b/Book/02.Mp3", "Book/02.Mp3"],
    ]);
    expect(plan.audiobooks).toHaveLength(1);
    expect(plan.audiobooks[0].files).toHaveLength(2);
  });

  it("directory name 'Author - Title' yields separate author and title", () => {
    const plan = folderPick([
      ["/x/Tolkien - The Hobbit/01.mp3", "Tolkien - The Hobbit/01.mp3"],
      ["/x/Tolkien - The Hobbit/02.mp3", "Tolkien - The Hobbit/02.mp3"],
    ]);
    expect(plan.audiobooks[0].title).toBe("The Hobbit");
    expect(plan.audiobooks[0].author).toBe("Tolkien");
  });

  it("non-audio junk siblings stay in the ordinary loop", () => {
    const plan = folderPick([
      ["/b/Book/01.mp3", "Book/01.mp3"],
      ["/b/Book/02.mp3", "Book/02.mp3"],
      ["/b/Book/Torrent downloaded from.txt", "Book/Torrent downloaded from.txt"],
    ]);
    expect(plan.audiobooks).toHaveLength(1);
    expect(plan.standalonePaths).toEqual(["/b/Book/Torrent downloaded from.txt"]);
  });

  it("empty and non-audio inputs pass through", () => {
    expect(planAudiobookImports([], { rootIsPickedFolder: true })).toEqual({
      audiobooks: [],
      standalonePaths: [],
    });
    const only = folderPick([["/b/a.pdf", "a.pdf"]]);
    expect(only.audiobooks).toHaveLength(0);
    expect(only.standalonePaths).toEqual(["/b/a.pdf"]);
  });

  it("unicode basenames group and sort without throwing", () => {
    const plan = folderPick([
      ["/b/書/第十章.mp3", "書/第十章.mp3"],
      ["/b/書/第二章.mp3", "書/第二章.mp3"],
    ]);
    expect(plan.audiobooks).toHaveLength(1);
    expect(plan.audiobooks[0].files).toHaveLength(2);
  });
});

describe("planAudiobookImports — loose multi-file picks", () => {
  it("groups on shared-base filename evidence", () => {
    const plan = loosePick([
      "/x/Book Title - 01.mp3",
      "/x/Book Title - 02.mp3",
      "/x/Book Title - 03.mp3",
    ]);
    expect(plan.audiobooks).toHaveLength(1);
    expect(plan.audiobooks[0].title).toBe("Book Title");
    expect(plan.audiobooks[0].files).toHaveLength(3);
  });

  it("unrelated files stay standalone even from the same physical directory", () => {
    const plan = loosePick(["/Downloads/a.mp3", "/Downloads/b.mp3"]);
    expect(plan.audiobooks).toHaveLength(0);
    expect(plan.standalonePaths.sort()).toEqual(["/Downloads/a.mp3", "/Downloads/b.mp3"]);
  });

  it("a single picked audio file is standalone", () => {
    const plan = loosePick(["/x/one.mp3"]);
    expect(plan.audiobooks).toHaveLength(0);
    expect(plan.standalonePaths).toEqual(["/x/one.mp3"]);
  });
});

describe("chapterTitleFromFileName", () => {
  it("strips obvious numbering", () => {
    expect(chapterTitleFromFileName("004 - The Troll.mp3")).toBe("The Troll");
    expect(chapterTitleFromFileName("01 An Unexpected Party.mp3")).toBe("An Unexpected Party");
    expect(chapterTitleFromFileName("Title - 03.mp3")).toBe("Title");
  });

  it("preserves titles whose trailing numbers are not separators", () => {
    expect(chapterTitleFromFileName("Catch 22.mp3")).toBe("Catch 22");
    expect(chapterTitleFromFileName("Chapter 5.mp3")).toBe("Chapter 5");
  });

  it("falls back to the whole stem when nothing remains", () => {
    expect(chapterTitleFromFileName("007.mp3")).toBe("007");
  });
});
