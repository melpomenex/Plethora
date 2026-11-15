import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import React from "react";
import { SubwayMinimap, classifyNodeMastery } from "../SubwayMinimap";

describe("UX02-T04 SubwayMinimap", () => {
  it("classifies mastery states accurately (Mastered, In Queue, Unread)", () => {
    expect(classifyNodeMastery({ stability: 30, reps: 4 })).toBe("mastered");
    expect(classifyNodeMastery({ stability: 5, reps: 2 })).toBe("in_queue");
    expect(classifyNodeMastery({ reps: 0 })).toBe("unread");
  });

  it("renders Document -> Child Extracts -> Grandchild Flashcards with mastery states and click callbacks", () => {
    const onSelectExtract = vi.fn();
    const onOpenSideBySide = vi.fn();

    render(
      <SubwayMinimap
        documentTitle="Distributed Systems"
        extracts={[
          {
            id: "ext-a",
            title: "Raft Leader Election",
            reps: 3,
            stability: 12,
            cards: [
              {
                id: "card-1",
                label: "What triggers an election?",
                itemType: "Qa",
                stability: 30,
                reps: 5,
              },
            ],
          },
          {
            id: "ext-b",
            title: "Log Compaction",
            reps: 0,
            cards: [],
          },
        ]}
        onSelectExtract={onSelectExtract}
        onOpenSideBySide={onOpenSideBySide}
      />
    );

    const nav = document.querySelector("[data-subway-minimap='true']");
    expect(nav).toBeInTheDocument();
    expect(nav).toHaveTextContent("Distributed Systems");

    const extA = document.querySelector("[data-subway-extract-id='ext-a']");
    const card1 = document.querySelector("[data-subway-card-id='card-1']");
    const extB = document.querySelector("[data-subway-extract-id='ext-b']");

    expect(extA).toHaveTextContent("In Queue");
    expect(card1).toHaveTextContent("Mastered");
    expect(extB).toHaveTextContent("Unread");

    fireEvent.click(extA!.querySelector("button")!);
    expect(onSelectExtract).toHaveBeenCalledWith("ext-a");
    expect(onOpenSideBySide).toHaveBeenCalledWith({ kind: "extract", id: "ext-a" });

    fireEvent.click(card1!.querySelector("button")!);
    expect(onOpenSideBySide).toHaveBeenCalledWith({
      kind: "card",
      id: "card-1",
      extractId: "ext-a",
    });
  });
});
