import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MobileAssistantCommands } from "../MobileAssistantCommands";
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
describe("Assistant shared command palette mode", () => {
  it("uses the registry's current theme, availability and source-title context", () => {
    render(<MobileAssistantCommands sourceTitle="Current book" onClose={() => {}} />);
    expect(fixture.registry).toHaveBeenCalledWith(expect.objectContaining({ theme: fixture.theme, selectedDocumentTitle: "Current book" }));
    expect(screen.getByRole("button", { name: /Open Documents/ })).toBeInTheDocument();
    expect(document.activeElement).not.toBe(screen.getByRole("searchbox"));
  });
  it("searches using shared aliases and executes through the shared executor", () => {
    const close = vi.fn(); render(<MobileAssistantCommands onClose={close} />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "library" } });
    expect(screen.queryByRole("button", { name: "Open Settings" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Open Documents/ }));
    expect(fixture.execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "documents" }), close);
    expect(fixture.action).not.toHaveBeenCalled();
  });
  it("supports keyboard execution and an honest no-results state", () => {
    render(<MobileAssistantCommands onClose={() => {}} />); const search = screen.getByRole("searchbox");
    fireEvent.change(search, { target: { value: "settings" } }); fireEvent.keyDown(search, { key: "Enter" }); expect(fixture.execute).toHaveBeenCalledOnce();
    fireEvent.change(search, { target: { value: "zzzz-unavailable" } }); expect(screen.getByRole("status")).toHaveTextContent("No matching commands");
  });
});
