import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createExtract: vi.fn(),
  getExtracts: vi.fn(),
  updateExtract: vi.fn(),
  deleteExtract: vi.fn(),
}));

vi.mock("../../../api/extracts", () => ({
  createExtract: mocks.createExtract,
  getExtracts: mocks.getExtracts,
  updateExtract: mocks.updateExtract,
  deleteExtract: mocks.deleteExtract,
}));
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));
vi.mock("../../common/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));
vi.mock("../../../lib/ai/tagExtractor", () => ({
  generateTagsForExtract: vi.fn(async () => []),
}));
vi.mock("../../../lib/ai/learningEngine", () => ({
  generateCardsForExtract: vi.fn(async () => []),
}));

import { useToastExtract } from "../../../hooks/useToastExtract";
import { useExtractStore } from "../../../stores/extractStore";

describe("Reader View and Extract State (Tasks 2.1, 2.4, 3.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useExtractStore.setState({ extracts: [], revision: 0, loadedDocumentId: null });
  });

  it("deduplicates simultaneous in-flight extract creations for the same selection", async () => {
    let resolveCreation: ((val: unknown) => void) | undefined;
    mocks.createExtract.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreation = resolve;
        })
    );
    mocks.getExtracts.mockResolvedValue([]);

    const { result } = renderHook(() => useToastExtract());

    // Fire two identical extract creations simultaneously
    const promise1 = result.current.createInstantExtract({
      documentId: "doc-1",
      text: "Duplicate selection text",
      pageNumber: 1,
    });
    const promise2 = result.current.createInstantExtract({
      documentId: "doc-1",
      text: "Duplicate selection text",
      pageNumber: 1,
    });

    // Only 1 backend call is initiated
    expect(mocks.createExtract).toHaveBeenCalledTimes(1);

    const mockCreated = { id: "ext-100", document_id: "doc-1", content: "Duplicate selection text" };
    resolveCreation?.(mockCreated);

    const [res1, res2] = await Promise.all([promise1, promise2]);
    expect(res1).toEqual(mockCreated);
    expect(res2).toBeNull(); // Second deduplicated in-flight call returns null without duplicating
  });

  it("reloads extracts into store on createExtract and increments revision", async () => {
    const mockExtract = { id: "ext-200", document_id: "doc-1", content: "Store reload extract" };
    mocks.createExtract.mockResolvedValue(mockExtract);
    mocks.getExtracts.mockResolvedValue([mockExtract]);

    const initialRevision = useExtractStore.getState().revision;

    await act(async () => {
      await useExtractStore.getState().createExtract({
        document_id: "doc-1",
        content: "Store reload extract",
      });
    });

    expect(mocks.getExtracts).toHaveBeenCalledWith("doc-1");
    expect(useExtractStore.getState().extracts).toEqual([mockExtract]);
    expect(useExtractStore.getState().revision).toBeGreaterThan(initialRevision);
  });

  it("invalidates document extracts and triggers reactive listeners", async () => {
    mocks.getExtracts.mockResolvedValue([
      { id: "ext-300", document_id: "doc-2", content: "Invalidated extract" },
    ]);

    let listenerCallCount = 0;
    const unsubscribe = useExtractStore.subscribe(() => {
      listenerCallCount++;
    });

    await act(async () => {
      await useExtractStore.getState().invalidateExtracts("doc-2");
    });

    expect(mocks.getExtracts).toHaveBeenCalledWith("doc-2");
    expect(listenerCallCount).toBeGreaterThan(0);
    unsubscribe();
  });
});
