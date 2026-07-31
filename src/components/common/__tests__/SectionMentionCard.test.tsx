import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "../../../test/utils";

// Mock i18n: return the key (with vars interpolated minimally) so tests can
// assert on translated affordances by key, mirroring other component tests.
vi.mock("../../../lib/i18n", () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (vars && key.includes("{title}")) {
        return key.replace("{title}", String(vars.title));
      }
      return key;
    },
    locale: "en",
  }),
}));

import { SectionMentionCard } from "../SectionMentionCard";
import type { SectionNode } from "../../../utils/sectionIndex";

function makeNode(overrides: Partial<SectionNode> = {}): SectionNode {
  return {
    id: "sec-1",
    title: "Mitochondria",
    level: 2,
    breadcrumb: ["Chapter 1", "Cells"],
    preview: "The powerhouse of the cell.",
    content: "Mitochondria are the powerhouse of the cell. They generate ATP.",
    children: [],
    parentId: null,
    ...overrides,
  };
}

describe("SectionMentionCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is collapsed by default and hides the body content", () => {
    const node = makeNode();
    render(<SectionMentionCard node={node} />);
    // Header info visible
    expect(screen.getByText("Cells > Mitochondria")).toBeInTheDocument();
    // Token badge present
    expect(screen.getByText(/tokens/)).toBeInTheDocument();
    // Body content NOT rendered
    expect(screen.queryByText("Mitochondria are the powerhouse of the cell. They generate ATP.")).toBeNull();
  });

  it("expands on click to reveal the section content", () => {
    const node = makeNode();
    render(<SectionMentionCard node={node} />);
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    expect(screen.getByText("Mitochondria are the powerhouse of the cell. They generate ATP.")).toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses again on a second click", () => {
    const node = makeNode();
    render(<SectionMentionCard node={node} />);
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.queryByText("Mitochondria are the powerhouse of the cell. They generate ATP.")).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a no-preview message when content is empty", () => {
    const node = makeNode({ content: "" });
    render(<SectionMentionCard node={node} />);
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.click(toggle);
    expect(screen.getByText("sectionMention.noPreview")).toBeInTheDocument();
  });

  it("shows a no-preview message when content is whitespace-only", () => {
    const node = makeNode({ content: "   \n  " });
    render(<SectionMentionCard node={node} />);
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    expect(screen.getByText("sectionMention.noPreview")).toBeInTheDocument();
  });

  it("fires onRemove with the node id", () => {
    const node = makeNode();
    const onRemove = vi.fn();
    render(<SectionMentionCard node={node} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText("common.remove"));
    expect(onRemove).toHaveBeenCalledWith("sec-1");
  });

  it("does not render a remove control when onRemove is not provided", () => {
    const node = makeNode();
    render(<SectionMentionCard node={node} />);
    expect(screen.queryByLabelText("common.remove")).toBeNull();
  });

  it("shows the title only (no breadcrumb prefix) when breadcrumb is empty", () => {
    const node = makeNode({ breadcrumb: [] });
    render(<SectionMentionCard node={node} />);
    expect(screen.getByText("Mitochondria")).toBeInTheDocument();
  });

  it("supports keyboard toggle via Enter and Space", () => {
    const node = makeNode();
    render(<SectionMentionCard node={node} />);
    const toggle = screen.getByRole("button", { expanded: false });
    fireEvent.keyDown(toggle, { key: "Enter" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(toggle, { key: " " });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("honors defaultExpanded prop", () => {
    const node = makeNode();
    render(<SectionMentionCard node={node} defaultExpanded />);
    const toggle = screen.getByRole("button", { expanded: true });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Mitochondria are the powerhouse of the cell. They generate ATP.")).toBeInTheDocument();
  });
});
