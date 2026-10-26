/**
 * Mobile Assistant composer (update-mobile-assistant-composer): one chat-style
 * bar with a leading add menu that owns slash commands, registry commands and
 * attachment; the sheet keeps a single chrome row above the conversation.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantPanel } from "../AssistantPanel";
import { registerOverlayDismissal, requestOverlayBack, resetOverlayStackForTests } from "../../../lib/overlayStack";

vi.mock("../../../lib/tauri", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/tauri")>();
  return { ...actual, isTauri: () => false, isNativeMobile: () => false, invokeCommand: vi.fn().mockResolvedValue([]) };
});
vi.mock("../../../api/llm", () => ({ chatWithContext: vi.fn() }));
vi.mock("../../../api/mcp", () => ({ callAppMCPTool: vi.fn(), getAppMCPTools: vi.fn().mockResolvedValue([]) }));
vi.mock("../../../lib/ai/assistant/orchestrator", () => ({ runAssistantTurn: vi.fn() }));
vi.mock("../../../lib/privacy/cloudAiDisclosure", () => ({ ensureCloudAiDisclosure: vi.fn().mockResolvedValue(true) }));

const dictation = vi.hoisted(() => ({
  value: {
    phase: "idle" as "idle" | "starting" | "listening" | "stopping",
    error: null as string | null,
    needsConsent: false,
    disabled: false,
    capability: null,
    start: vi.fn(), stop: vi.fn(), cancel: vi.fn(), onEdit: vi.fn(),
  },
}));
vi.mock("../../../hooks/useComposerDictation", () => ({ useComposerDictation: () => dictation.value }));

vi.mock("../mobile/MobileAssistantCommands", () => ({
  useAssistantCommandMatches: (_sourceTitle: string | undefined, query: string) => query.trim() === "zzz" ? [] : [{
    id: "documents", label: "Open Documents", description: "Your reading library",
    category: "navigation", action: () => {},
  }],
  MobileAssistantCommands: ({ onExecuted }: { onExecuted: () => void }) => (
    <button type="button" onClick={onExecuted}>Run Open Documents</button>
  ),
}));

const mobileProps = {
  conversationKey: "mobile:global",
  mobilePresentation: { visible: true },
  fillContainer: true,
  appendContextMessages: false,
  context: { type: "general" as const },
};

beforeEach(() => {
  localStorage.clear();
  resetOverlayStackForTests();
  Element.prototype.scrollTo = vi.fn();
  dictation.value.phase = "idle"; dictation.value.error = null; dictation.value.needsConsent = false;
});
afterEach(() => { vi.useRealTimers(); });

describe("mobile composer bar", () => {
  it("renders one bar with no hint row, command chips, stacked attach, dictation row or tabs", () => {
    render(<AssistantPanel {...mobileProps} />);
    const composer = document.querySelector("[data-assistant-composer]")!;
    const column = composer.firstElementChild as HTMLElement;
    // Source choice, input bar, and hidden file input remain in the composer.
    expect(column.children).toHaveLength(3);
    expect(composer.querySelector("[data-assistant-answer-from]")).not.toBeNull();
    expect(composer.querySelector("[data-assistant-composer-input]")).not.toBeNull();
    expect(column.querySelector('[type="file"]')).not.toBeNull();
    expect(screen.queryByText(/Type \/tools to see available tools/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "/20rules" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach image" })).not.toBeInTheDocument();
    expect(document.querySelector("[data-assistant-dictation-status]")).toBeNull();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    const toolbar = document.querySelector("[data-assistant-toolbar]")!;
    expect(toolbar.className).toContain("flex-wrap");
    expect(toolbar.querySelector("[data-assistant-answer-from]")).toBeNull();
  });

  it("opens the menu from the add control without moving focus into search", () => {
    render(<AssistantPanel {...mobileProps} />);
    const add = screen.getByRole("button", { name: "Add to your message" });
    fireEvent.click(add);
    expect(add).toHaveAttribute("aria-expanded", "true");
    const search = screen.getByRole("searchbox", { name: "Search commands" });
    expect(search).not.toHaveFocus();
    const menu = document.querySelector("[data-assistant-composer-menu]")!;
    expect(menu.className).toContain("max-h-[60%]");
    expect(menu.querySelector(".overflow-y-auto")).not.toBeNull();
    // In-flow above the composer, never absolutely overlaid inside it.
    expect(menu.closest("[data-assistant-composer]")).toBeNull();
    expect(screen.getByRole("button", { name: "Attach image" })).toBeInTheDocument();
  });

  it("inserts a slash command into the draft without sending", () => {
    render(<AssistantPanel {...mobileProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to your message" }));
    fireEvent.click(screen.getByRole("button", { name: /\/tools/ }));
    expect(screen.getByRole("textbox")).toHaveValue("/tools");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("filters the sections and shows an honest no-results state", () => {
    render(<AssistantPanel {...mobileProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to your message" }));
    const search = screen.getByRole("searchbox", { name: "Search commands" });
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No matching commands.")).toBeInTheDocument();
    expect(screen.queryByText("Slash commands")).not.toBeInTheDocument();
    fireEvent.change(search, { target: { value: "open" } });
    expect(screen.queryByText("Slash commands")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run Open Documents" })).toBeInTheDocument();
  });

  it("executes a registry command through the shared list and dismisses", () => {
    render(<AssistantPanel {...mobileProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to your message" }));
    fireEvent.click(screen.getByRole("button", { name: "Run Open Documents" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps New conversation and Share reachable from the menu", () => {
    render(<AssistantPanel {...mobileProps} />);
    fireEvent.click(screen.getByRole("button", { name: "Add to your message" }));
    expect(screen.getByRole("button", { name: "New conversation" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share conversation" })).not.toBeInTheDocument();
  });

  it("closes the menu on Back before the sheet's own dismissal", () => {
    const sheetDismiss = vi.fn(); let cleanup: () => void;
    render(<AssistantPanel {...mobileProps} />);
    act(() => { cleanup = registerOverlayDismissal(sheetDismiss, { priority: 60 }); });
    fireEvent.click(screen.getByRole("button", { name: "Add to your message" }));
    act(() => { expect(requestOverlayBack()).toBe(true); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(sheetDismiss).not.toHaveBeenCalled();
    act(() => { expect(requestOverlayBack()).toBe(true); });
    expect(sheetDismiss).toHaveBeenCalledOnce();
    act(() => cleanup());
  });

  it("opens the hidden image picker from the attachment row", () => {
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    try {
      render(<AssistantPanel {...mobileProps} />);
      fireEvent.click(screen.getByRole("button", { name: "Add to your message" }));
      fireEvent.click(screen.getByRole("button", { name: "Attach image" }));
      expect(click).toHaveBeenCalledOnce();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    } finally { click.mockRestore(); }
  });
});

describe("mobile dictation feedback", () => {
  it("announces errors in the live region and shows them transiently", () => {
    vi.useFakeTimers();
    dictation.value.error = "Microphone permission denied.";
    render(<AssistantPanel {...mobileProps} />);
    const chip = document.querySelector("[data-assistant-dictation-status]")!;
    expect(chip).toHaveTextContent("Microphone permission denied.");
    expect(screen.getAllByRole("status").some((node) => node.textContent?.includes("Microphone permission denied."))).toBe(true);
    act(() => { vi.advanceTimersByTime(8000); });
    expect(document.querySelector("[data-assistant-dictation-status]")).toBeNull();
    expect(screen.getAllByRole("status").some((node) => node.textContent?.includes("Microphone permission denied."))).toBe(true);
  });
});

describe("desktop composer regression", () => {
  it("keeps the hint and attach button and moves utility commands into Actions", () => {
    render(<AssistantPanel context={{ type: "general" }} />);
    expect(screen.getByText(/Type \/tools to see available tools/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /More|Actions/ }));
    expect(screen.getByRole("button", { name: /\/20rules/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\/clear/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Attach image" })).toBeInTheDocument();
    const column = document.querySelector("[data-assistant-composer]")!.firstElementChild as HTMLElement;
    expect(column.children.length).toBeGreaterThan(2);
  });
});
