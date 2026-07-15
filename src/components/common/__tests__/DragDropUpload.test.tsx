import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { DragDropUpload } from "../DragDropUpload";

vi.mock("../../../lib/tauri", () => ({
  isTauri: () => false,
}));

vi.mock("../../../lib/browser-file-store", () => ({
  storeBrowserFile: vi.fn(() => "browser://notes.md"),
}));

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

describe("DragDropUpload", () => {
  it("imports ordinary browser files when filesystem entries are unavailable", async () => {
    const onFilesImported = vi.fn();
    const file = new File(["# Notes"], "notes.md", { type: "text/markdown" });
    const item = {
      getAsFile: () => file,
      webkitGetAsEntry: undefined,
    } as unknown as DataTransferItem;

    render(<DragDropUpload onFilesImported={onFilesImported} />);

    fireEvent.drop(window, {
      dataTransfer: {
        types: ["Files"],
        items: [item],
        files: [file],
      },
    });

    await waitFor(() => {
      expect(onFilesImported).toHaveBeenCalledWith(["browser://notes.md"]);
    });
  });
});
