import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractPdfData } from "../pdfTextExtractor";
import * as pdfjsLib from "pdfjs-dist";
import * as docApi from "../../api/documents";

vi.mock("pdfjs-dist", () => ({
  getDocument: vi.fn(),
}));

vi.mock("../../api/documents", () => ({
  readDocumentFile: vi.fn(),
}));

describe("pdfTextExtractor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty result if filePath is empty", async () => {
    const result = await extractPdfData("");
    expect(result).toEqual({
      outline: [],
      pageContents: [],
      fullText: "",
      totalPages: 0,
      totalChars: 0,
    });
  });

  it("returns empty result if readDocumentFile returns empty bytes", async () => {
    vi.mocked(docApi.readDocumentFile).mockResolvedValue(new Uint8Array(0));
    const result = await extractPdfData("/path/to/empty.pdf");
    expect(result).toEqual({
      outline: [],
      pageContents: [],
      fullText: "",
      totalPages: 0,
      totalChars: 0,
    });
  });

  it("extracts text, outline with resolved pages, and notifies progress", async () => {
    const mockBytes = new Uint8Array([1, 2, 3, 4]);
    vi.mocked(docApi.readDocumentFile).mockResolvedValue(mockBytes);

    const mockGetPage = vi.fn().mockImplementation((pageNum: number) => ({
      getTextContent: vi.fn().mockResolvedValue({
        items: [{ str: `Page ${pageNum} paragraph text.` }],
      }),
    }));

    const mockOutline = [
      {
        title: "Chapter 1",
        dest: [{ num: 1, gen: 0 }, { name: "FitH" }],
        items: [
          {
            title: "Section 1.1",
            dest: [{ num: 2, gen: 0 }, { name: "FitH" }],
          },
        ],
      },
    ];

    const mockDestroy = vi.fn().mockResolvedValue(undefined);
    const mockDoc = {
      numPages: 2,
      getOutline: vi.fn().mockResolvedValue(mockOutline),
      getPageIndex: vi.fn().mockImplementation((ref: any) => {
        if (ref?.num === 1) return Promise.resolve(0); // 0-indexed = page 1
        if (ref?.num === 2) return Promise.resolve(1); // 0-indexed = page 2
        return Promise.resolve(0);
      }),
      getDestination: vi.fn(),
      getPage: mockGetPage,
      destroy: mockDestroy,
    };

    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve(mockDoc),
    } as any);

    const progressReports: Array<{ current: number; total: number }> = [];
    const result = await extractPdfData("/books/sample.pdf", {
      onProgress: (current, total) => progressReports.push({ current, total }),
    });

    expect(result.totalPages).toBe(2);
    expect(result.pageContents.length).toBe(2);
    expect(result.pageContents[0]).toEqual({
      pageNumber: 1,
      text: "Page 1 paragraph text.",
    });
    expect(result.pageContents[1]).toEqual({
      pageNumber: 2,
      text: "Page 2 paragraph text.",
    });
    expect(result.fullText).toBe("Page 1 paragraph text.\n\nPage 2 paragraph text.");
    expect(result.totalChars).toBe(result.fullText.length);

    // Outline verification
    expect(result.outline.length).toBe(1);
    expect(result.outline[0].title).toBe("Chapter 1");
    expect(result.outline[0].pageNumber).toBe(1);
    expect(result.outline[0].items?.[0].title).toBe("Section 1.1");
    expect(result.outline[0].items?.[0].pageNumber).toBe(2);

    // Progress verification
    expect(progressReports).toEqual([
      { current: 1, total: 2 },
      { current: 2, total: 2 },
    ]);

    expect(mockDestroy).toHaveBeenCalled();
  });

  it("stops extracting early when isCancelled returns true", async () => {
    const mockBytes = new Uint8Array([1, 2, 3, 4]);
    vi.mocked(docApi.readDocumentFile).mockResolvedValue(mockBytes);

    let callCount = 0;
    const mockGetPage = vi.fn().mockImplementation((pageNum: number) => {
      callCount++;
      return {
        getTextContent: vi.fn().mockResolvedValue({
          items: [{ str: `Content ${pageNum}` }],
        }),
      };
    });

    const mockDestroy = vi.fn().mockResolvedValue(undefined);
    const mockDoc = {
      numPages: 5,
      getOutline: vi.fn().mockResolvedValue(null),
      getPage: mockGetPage,
      destroy: mockDestroy,
    };

    vi.mocked(pdfjsLib.getDocument).mockReturnValue({
      promise: Promise.resolve(mockDoc),
    } as any);

    let cancelled = false;
    const result = await extractPdfData("/books/large.pdf", {
      onProgress: (current) => {
        if (current >= 2) cancelled = true;
      },
      isCancelled: () => cancelled,
    });

    expect(result.totalPages).toBe(5);
    // Extracted page 1 and page 2, then broke out on page 3 check
    expect(result.pageContents.length).toBe(2);
    expect(mockDestroy).toHaveBeenCalled();
  });
});
