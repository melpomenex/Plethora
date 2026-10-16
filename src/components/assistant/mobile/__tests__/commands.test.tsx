import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileAssistantCommands, useAssistantCommandMatches } from "../MobileAssistantCommands";
import { CommandCategory } from "../../../../commandPalette/commandModel";
const fixture = vi.hoisted(() => ({ registry: vi.fn(), execute: vi.fn(), theme: { id: "test", name: "Test", variant: "dark" }, action: vi.fn() }));
vi.mock("../../../../contexts/ThemeContext", () => ({ useTheme: () => ({ theme: fixture.theme, themes: [], setTheme: vi.fn() }) }));
vi.mock("../../../../commandPalette/registry", async original => ({ ...await original<typeof import("../../../../commandPalette/registry")>(), buildCommandRegistry: fixture.registry }));
vi.mock("../../../../commandPalette/executeCommand", () => ({ executeCommand: fixture.execute }));
beforeEach(() => {
  vi.clearAllMocks(); fixture.registry.mockReturnValue([
    { id: "documents", label: "Open Documents", description: "Your reading library", aliases: ["library"], category: CommandCategory.Navigation, action: fixture.action },
    { id: "settings", label: "Open Settings", aliases: ["settings"], category: CommandCategory.Navigation, action: fixture.action },
  ]);
});

function MatchesHarness({ query, sourceTitle }: { query: string; sourceTitle?: string }) {
  const commands = useAssistantCommandMatches(sourceTitle, query);
  return <ul aria-label="matches">{commands.map(command => <li key={command.id}>{command.label}</li>)}</ul>;
}

describe("Assistant composer command list", () => {
  it("uses the registry's current theme, availability and source-title context", () => {
    const { rerender } = render(<MatchesHarness query="" sourceTitle="Current book" />);
    expect(fixture.registry).toHaveBeenCalledWith(expect.objectContaining({ theme: fixture.theme, selectedDocumentTitle: "Current book" }));
    expect(screen.getByRole("list", { name: "matches" }).children).toHaveLength(2);
    rerender(<MatchesHarness query="" />);
    expect(fixture.registry).toHaveBeenLastCalledWith(expect.objectContaining({ selectedDocumentTitle: null }));
  });
  it("filters with the shared matcher's aliases", () => {
    render(<MatchesHarness query="library" />);
    expect(screen.getByText("Open Documents")).toBeInTheDocument();
    expect(screen.queryByText("Open Settings")).not.toBeInTheDocument();
  });
  it("executes through the shared executor and reports back to the menu", () => {
    const close = vi.fn(); render(<MobileAssistantCommands commands={[
      { id: "documents", label: "Open Documents", category: CommandCategory.Navigation, action: fixture.action },
    ]} onExecuted={close} />);
    fireEvent.click(screen.getByRole("button", { name: /Open Documents/ }));
    expect(fixture.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "documents" }), close);
    expect(fixture.action).not.toHaveBeenCalled();
  });
  it("renders nothing when the filter is empty (the menu owns the no-results state)", () => {
    const { container } = render(<MobileAssistantCommands commands={[]} onExecuted={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
