import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { AssistantPanel } from "../AssistantPanel";
import * as documentsApi from "../../../api/documents";

vi.mock("../../../api/documents", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../api/documents")>();
  return {
    ...actual,
    getDocument: vi.fn().mockResolvedValue({ id: "doc-1", content: "# One\nbody" }),
    extractDocumentText: vi.fn().mockResolvedValue({ content: "" }),
  };
});

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return { ...actual, isTauri: () => false, isNativeMobile: () => false, invokeCommand: vi.fn().mockResolvedValue([]) };
});

describe("AssistantPanel # section index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollTo = vi.fn();
  });

  it("does not fetch full document text until the input is focused", async () => {
    const { container } = render(
      <AssistantPanel context={{ type: "document", documentId: "doc-1", content: "# One\nbody" }} />,
    );

    await new Promise((r) => setTimeout(r, 0));
    expect(documentsApi.getDocument).not.toHaveBeenCalled();

    const textarea = container.querySelector("textarea")!;
    textarea.focus();

    await waitFor(() => expect(documentsApi.getDocument).toHaveBeenCalledWith("doc-1"));
  });
});
