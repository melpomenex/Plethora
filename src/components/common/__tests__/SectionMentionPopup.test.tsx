import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { SectionNode } from "../../../utils/sectionIndex";
import { SectionMentionPopup } from "../SectionMentionPopup";

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

const node = (id: string, title: string): SectionNode => ({
  id,
  documentId: "doc-1",
  title,
  level: 1,
  content: `content ${title}`,
  source: "text",
  preview: `content ${title}`,
  parentId: null,
  breadcrumb: [],
  children: [],
});

describe("SectionMentionPopup availability states", () => {
  it("shows a loading state instead of a false 'No sections available' while sections load", () => {
    render(
      <SectionMentionPopup
        tree={[]}
        flat={[]}
        query=""
        selectedIndex={0}
        onSelect={() => {}}
        open
        isLoading
        loadingLabel="Loading sections…"
      />
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getAllByText("Loading sections…").length).toBeGreaterThan(0);
    // The bare dead-end copy must not appear while loading.
    expect(screen.queryByText("sectionMention.noSectionsAvailable")).not.toBeInTheDocument();
    expect(screen.queryByText("sectionMention.noSectionsAvailableBody")).not.toBeInTheDocument();
  });

  it("explains the limitation when no document is targeted instead of a bare empty list", () => {
    render(
      <SectionMentionPopup
        tree={[]}
        flat={[]}
        query=""
        selectedIndex={0}
        onSelect={() => {}}
        open
        unavailableReason="# references sections of an open document — mention a document with @ first."
      />
    );
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(
      screen.getByText("# references sections of an open document — mention a document with @ first.")
    ).toBeInTheDocument();
    expect(screen.queryByText("sectionMention.noSectionsAvailable")).not.toBeInTheDocument();
  });

  it("lists sections when a catalog is available", () => {
    render(
      <SectionMentionPopup
        tree={[]}
        flat={[node("s1", "Intro"), node("s2", "Results")]}
        query=""
        selectedIndex={0}
        onSelect={() => {}}
        open
      />
    );
    expect(screen.getByText("sectionMention.sectionsInDocument")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Intro/ })).toBeInTheDocument();
  });
});
