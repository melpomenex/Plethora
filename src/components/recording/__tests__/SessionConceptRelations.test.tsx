import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionConceptRelations } from "../SessionConceptRelations";
import * as conceptRelationsAdapter from "../../../services/recording/conceptRelationsAdapter";

vi.mock("../../../services/recording/conceptRelationsAdapter", () => ({
  querySessionConceptRelations: vi.fn(),
  linkSessionDocumentToConcept: vi.fn(),
}));

const concept = {
  name: "Quantum Entanglement",
  definition: "Non-local correlations between particles.",
};

describe("SessionConceptRelations (Task 5.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not claim concepts are new when the knowledge adapter is unavailable", async () => {
    vi.mocked(conceptRelationsAdapter.querySessionConceptRelations).mockResolvedValue({
      available: false,
      reason: "adapter missing",
      matches: [],
    });

    render(
      <SessionConceptRelations sessionDocumentId="doc-session-1" concepts={[concept]} />
    );

    await waitFor(() => {
      expect(screen.getByText("Cross-session relations unavailable")).toBeInTheDocument();
    });

    expect(screen.getByText("Quantum Entanglement")).toBeInTheDocument();
    expect(screen.queryByText("New to course")).not.toBeInTheDocument();
    expect(screen.queryByText("Known in course")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /link .* to this recording/i })).not.toBeInTheDocument();
  });

  it("shows grounded evidence coverage and links only after explicit user action", async () => {
    vi.mocked(conceptRelationsAdapter.querySessionConceptRelations).mockResolvedValue({
      available: true,
      matches: [
        {
          conceptName: concept.name,
          normalizedName: "quantum entanglement",
          existingConcept: {
            id: "concept-1",
            name: concept.name,
            normalizedName: "quantum entanglement",
            createdAt: "2026-10-15T10:00:00Z",
            updatedAt: "2026-10-15T10:00:00Z",
          },
          otherLinkedSources: [
            {
              sourceKind: "document",
              sourceId: "doc-recording-a",
              relationType: "supports",
            },
          ],
          isAlreadyLinkedToSession: false,
          evidenceCoverage: "partial",
        },
      ],
    });
    vi.mocked(conceptRelationsAdapter.linkSessionDocumentToConcept).mockResolvedValue(true);

    render(
      <SessionConceptRelations sessionDocumentId="doc-session-1" concepts={[concept]} />
    );

    await waitFor(() => {
      expect(screen.getByText("Known in course")).toBeInTheDocument();
    });
    expect(screen.getByText("Evidence: partial")).toBeInTheDocument();
    expect(screen.getByText("Linked in 1 other source(s)")).toBeInTheDocument();

    const linkButton = screen.getByRole("button", {
      name: /link quantum entanglement to this recording/i,
    });
    expect(conceptRelationsAdapter.linkSessionDocumentToConcept).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(linkButton);
    });

    await waitFor(() => {
      expect(conceptRelationsAdapter.linkSessionDocumentToConcept).toHaveBeenCalledWith(
        "doc-session-1",
        "concept-1"
      );
    });
    // A refresh after linking is read-only and keeps the explicit boundary.
    expect(conceptRelationsAdapter.querySessionConceptRelations).toHaveBeenCalledTimes(2);
  });
});
