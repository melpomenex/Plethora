import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ExtractReaderView } from "../ExtractReaderView";
import type { Extract } from "../../../api/extracts";

const sampleExtract: Extract = {
  id: "ext-1",
  document_id: "doc-1",
  content: "This is sample extract text content.",
  progressive_disclosure_level: 0,
  max_disclosure_level: 0,
  date_created: new Date().toISOString(),
  date_modified: new Date().toISOString(),
  tags: [],
  review_count: 0,
  reps: 0,
};

describe("ExtractReaderView", () => {
  it("renders extract content and default Return to Source button", () => {
    const onReturn = vi.fn();
    render(
      <ExtractReaderView
        extract={sampleExtract}
        documentId="doc-1"
        documentTitle="My Document"
        onReturnToSource={onReturn}
      />
    );

    expect(screen.getByText("This is sample extract text content.")).toBeInTheDocument();
    expect(screen.getByText("My Document")).toBeInTheDocument();
    const returnBtn = screen.getByTestId("return-to-source-btn");
    expect(returnBtn).toBeInTheDocument();
    expect(returnBtn).toHaveTextContent("Back to source");

    fireEvent.click(returnBtn);
    expect(onReturn).toHaveBeenCalledTimes(1);
  });

  it("shows 'Back to book' when sourceKind is book", () => {
    const onReturn = vi.fn();
    render(
      <ExtractReaderView
        extract={sampleExtract}
        documentId="doc-1"
        documentTitle="Clean Code"
        sourceKind="book"
        onReturnToSource={onReturn}
      />
    );

    const returnBtn = screen.getByTestId("return-to-source-btn");
    expect(returnBtn).toHaveTextContent("Back to book");
  });

  it("shows 'Back to article' when sourceContext has sourceKind: article", () => {
    const onReturn = vi.fn();
    render(
      <ExtractReaderView
        extract={sampleExtract}
        sourceContext={{
          documentId: "doc-1",
          sourceTitle: "Deep Learning Research",
          sourceKind: "article",
        }}
        onReturnToSource={onReturn}
      />
    );

    const returnBtn = screen.getByTestId("return-to-source-btn");
    expect(returnBtn).toHaveTextContent("Back to article");
  });

  it("renders 'Resume queue' button and calls onResumeQueue", () => {
    const onResume = vi.fn();
    render(
      <ExtractReaderView
        extract={sampleExtract}
        documentId="doc-1"
        onResumeQueue={onResume}
      />
    );

    const resumeBtn = screen.getByTestId("resume-queue-btn");
    expect(resumeBtn).toBeInTheDocument();
    expect(resumeBtn).toHaveTextContent("Resume queue");

    fireEvent.click(resumeBtn);
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("disables return button when sourceAvailable is false", () => {
    const onReturn = vi.fn();
    render(
      <ExtractReaderView
        extract={sampleExtract}
        documentId="doc-1"
        sourceAvailable={false}
        onReturnToSource={onReturn}
      />
    );

    const returnBtn = screen.getByTestId("return-to-source-btn");
    expect(returnBtn).toBeDisabled();
    expect(screen.getByText(/the source document could not be loaded/i)).toBeInTheDocument();
  });
});
