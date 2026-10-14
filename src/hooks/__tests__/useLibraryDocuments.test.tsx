import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const getDocuments = vi.hoisted(() => vi.fn());
vi.mock("../../api/documents", () => ({ getDocuments }));
import { useLibraryDocuments } from "../useLibraryDocuments";
import type { Document } from "../../types/document";

beforeEach(() => getDocuments.mockReset());
describe("tab-local all-library documents", () => {
  it("requests durable source filtering across collections and reloads when the source is cleared", async () => {
    getDocuments.mockResolvedValue([{ id: "outside-cache", title: "A browser save" } as Document]);
    const { result, rerender } = renderHook(({ source }) => useLibraryDocuments(true, source, true), { initialProps: { source: "browser-extension" as "browser-extension" | undefined } });
    await waitFor(() => expect(result.current.documents).toHaveLength(1));
    expect(getDocuments).toHaveBeenCalledWith(undefined, "browser-extension");
    act(() => result.current.patch("outside-cache", { title: "Updated title" }));
    expect(result.current.documents[0].title).toBe("Updated title");
    rerender({ source: undefined });
    await waitFor(() => expect(getDocuments).toHaveBeenLastCalledWith(undefined, undefined));
  });
  it("leaves ordinary collection list fetching alone", () => {
    renderHook(() => useLibraryDocuments(false, undefined, true));
    expect(getDocuments).not.toHaveBeenCalled();
  });
});
