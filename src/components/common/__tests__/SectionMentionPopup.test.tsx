import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { SectionNode } from "../../../utils/sectionIndex";
import { flattenTree } from "../../../utils/sectionIndex";
import { SectionMentionPopup } from "../SectionMentionPopup";
import { buildOutlineRows, useSectionPicker } from "../sectionPickerModel";

vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({ t: (key: string) => key, locale: "en" }),
}));

const node = (
  id: string,
  title: string,
  options: Partial<SectionNode> & { children?: SectionNode[] } = {},
): SectionNode => ({
  id,
  documentId: "doc-1",
  title,
  level: options.level ?? 1,
  content: options.content ?? `content ${title}`,
  source: options.source ?? "text",
  preview: options.preview ?? `content ${title}`,
  parentId: options.parentId ?? null,
  breadcrumb: options.breadcrumb ?? [],
  children: options.children ?? [],
});

const child = node("chapter-1", "Chapter 1", {
  level: 2,
  parentId: "part-1",
  breadcrumb: ["Part One"],
  content: "The peacock's tail chapter body.",
  preview: "The peacock's tail chapter body.",
});
const part = node("part-1", "Part One", { children: [child], content: "Part body" });
const tree = [part, node("part-2", "Part Two")];

function anchorRef() {
  return { current: document.createElement("textarea") };
}

function Harness({
  query = "",
  onSelect = () => {},
}: {
  query?: string;
  onSelect?: (node: SectionNode) => void;
}) {
  const flat = flattenTree(tree);
  const picker = useSectionPicker({ tree, flat, query, open: true });
  return (
    <SectionMentionPopup
      rows={picker.rows}
      query={query}
      activeIndex={picker.activeIndex}
      onSelect={onSelect}
      onToggleExpand={picker.toggleExpanded}
      open
      anchorRef={anchorRef()}
      documentTitle="The Moral Animal"
      topLevelCount={tree.length}
      totalSectionCount={flat.length}
      maxHeight={260}
    />
  );
}

describe("SectionMentionPopup availability states", () => {
  it("shows a loading state instead of a false 'No sections available' while sections load", () => {
    render(
      <SectionMentionPopup
        rows={[]}
        query=""
        activeIndex={0}
        onSelect={() => {}}
        open
        anchorRef={anchorRef()}
        isLoading
        loadingLabel="Loading sections…"
      />,
    );
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getAllByText("Loading sections…").length).toBeGreaterThan(0);
    expect(screen.queryByText("sectionMention.noSectionsAvailable")).not.toBeInTheDocument();
    expect(screen.queryByText("sectionMention.noSectionsAvailableBody")).not.toBeInTheDocument();
  });

  it("explains the limitation when no document is targeted instead of a bare empty list", () => {
    render(
      <SectionMentionPopup
        rows={[]}
        query=""
        activeIndex={0}
        onSelect={() => {}}
        open
        anchorRef={anchorRef()}
        unavailableReason="# references sections of an open document — mention a document with @ first."
      />,
    );
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(
      screen.getByText(
        "# references sections of an open document — mention a document with @ first.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("sectionMention.noSectionsAvailable")).not.toBeInTheDocument();
  });

  it("explains an extract-only context", () => {
    render(
      <SectionMentionPopup
        rows={[]}
        query=""
        activeIndex={0}
        onSelect={() => {}}
        open
        anchorRef={anchorRef()}
        unavailableReason="sectionMention.extractUnavailable"
      />,
    );
    expect(screen.getByText("sectionMention.extractUnavailable")).toBeInTheDocument();
  });

  it("shows the no-extractable-text empty state", () => {
    render(
      <SectionMentionPopup
        rows={[]}
        query=""
        activeIndex={0}
        onSelect={() => {}}
        open
        anchorRef={anchorRef()}
        totalSectionCount={0}
      />,
    );
    expect(screen.getByText("sectionMention.noSectionsAvailable")).toBeInTheDocument();
    expect(screen.getByText("sectionMention.noSectionsAvailableBody")).toBeInTheDocument();
  });

  it("lists the bare-hash outline with document identity and counts", () => {
    render(<Harness />);
    expect(screen.getByText("The Moral Animal")).toBeInTheDocument();
    expect(screen.getByText("sectionMention.outlineCounts")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Part One/ })).toBeInTheDocument();
    // Collapsed by default: the nested chapter is not listed yet.
    expect(screen.queryByText("Chapter 1")).not.toBeInTheDocument();
  });

  it("expands a branch to reveal and then hide its descendants", () => {
    render(<Harness />);

    fireEvent.click(
      screen.getByRole("button", { name: "sectionMention.expandSection" }),
    );
    expect(screen.getByText("Chapter 1")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "sectionMention.collapseSection" }),
    );
    expect(screen.queryByText("Chapter 1")).not.toBeInTheDocument();
  });

  it("does not select a section when the disclosure is activated", () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);

    fireEvent.click(
      screen.getByRole("button", { name: "sectionMention.expandSection" }),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows nested matches with breadcrumbs when filtering", () => {
    render(<Harness query="peacock" />);
    expect(screen.getByText("Chapter 1")).toBeInTheDocument();
    expect(screen.getByText("Part One")).toBeInTheDocument();
    expect(screen.getByText("sectionMention.matchingSections")).toBeInTheDocument();
  });

  it("renders the no-results state with a clear action", () => {
    function EmptyQueryHarness() {
      return (
        <SectionMentionPopup
          rows={[]}
          query="zzz"
          activeIndex={0}
          onSelect={() => {}}
          onClearQuery={() => {}}
          open
          anchorRef={anchorRef()}
        />
      );
    }
    render(<EmptyQueryHarness />);
    expect(screen.getByText("sectionMention.noResults")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "sectionMention.clearQuery" }),
    ).toBeInTheDocument();
  });

  it("links the listbox to the active option", () => {
    render(<Harness />);
    const listbox = screen.getByRole("listbox");
    expect(listbox.getAttribute("aria-activedescendant")).toBe(
      "section-picker-option-part-1",
    );
  });

  it("shows token badges and marks unresolved content", () => {
    const unresolved = node("unresolved", "Unresolved section", { content: "" });
    render(
      <SectionMentionPopup
        rows={buildOutlineRows([node("known", "Known section", { content: "12345678" }), unresolved], new Set())}
        query=""
        activeIndex={0}
        onSelect={() => {}}
        open
        anchorRef={anchorRef()}
      />,
    );
    expect(screen.getByText("2 tokens")).toBeInTheDocument();
    expect(screen.getByText("-- tokens")).toBeInTheDocument();
  });

  it("scrolls the active row into view when it changes", () => {
    const scrollSpy = vi.spyOn(Element.prototype, "scrollIntoView");
    const rows = buildOutlineRows(tree, new Set(["part-1"]));
    render(
      <SectionMentionPopup
        rows={rows}
        query=""
        activeIndex={1}
        onSelect={() => {}}
        open
        anchorRef={anchorRef()}
      />,
    );
    expect(scrollSpy).toHaveBeenCalled();
    scrollSpy.mockRestore();
  });

  it("virtualizes large outlines instead of rendering every row", () => {
    const roots = Array.from({ length: 250 }, (_, index) =>
      node(`section-${index}`, `Section ${index}`),
    );
    const { container } = render(
      <SectionMentionPopup
        rows={buildOutlineRows(roots, new Set())}
        query=""
        activeIndex={0}
        onSelect={() => {}}
        open
        anchorRef={anchorRef()}
      />,
    );
    const renderedOptions = container.ownerDocument.querySelectorAll(
      "[data-section-picker-option]",
    );
    expect(renderedOptions.length).toBeLessThan(250);
  });
});
