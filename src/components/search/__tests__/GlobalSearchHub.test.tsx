import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GlobalSearch,
  SearchResultType,
  type PaletteHubController,
  type SearchQuery,
  type SearchResult,
} from "../GlobalSearch";
import type { Command } from "../../common/CommandPalette";
import { CommandCategory } from "../../common/CommandPalette";
import { buildCommandRegistry, type RegistryDeps } from "../../../commandPalette/registry";
import { en } from "../../../lib/i18n/locales/en";
import { useUIStore } from "../../../stores/uiStore";
import { usePaletteNoteDraftStore } from "../../../commandPalette/noteDraft";
import type { PaletteHomeModel } from "../../../commandPalette/types";

function makeRegistryDeps(): RegistryDeps {
  return {
    translate: (key, vars) => {
      const template = en[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
    },
    theme: { id: "theme-dark", name: "Dark", variant: "dark" },
    themes: [
      { id: "theme-dark", name: "Dark", variant: "dark" },
      { id: "theme-light", name: "Light", variant: "light" },
    ],
    setTheme: vi.fn(),
    isWeb: false,
    selectedDocumentTitle: null,
    savedQueues: [],
  };
}

function openViewAll() {
  const event = new KeyboardEvent("keydown", {
    key: "/",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(event);
  });
}

function buildHome(overrides: Partial<PaletteHomeModel> = {}): PaletteHomeModel {
  return {
    collectionId: "col-1",
    firstUse: false,
    resume: {
      status: "ready",
      item: {
        documentId: "doc-1",
        title: "The-Doctrine-of-Fascism",
        fileType: "pdf",
        progressPercent: 40,
        coverUrl: null,
        pageCount: 342,
        formatLabel: "PDF Document",
        locationLabel: "Page 137",
        timestampLabel: "4 hours ago",
        timestampKind: "modified",
        passage: null,
        timestampLeadKey: "lastUpdated",
        sourceUrl: null,
      },
    },
    recent: {
      status: "ready",
      item: {
        documentId: "doc-2",
        title: "Recent Document",
        fileType: "epub",
        openedAt: 100,
        source: "opened",
      },
    },
    due: { status: "ready", dueCount: 3 },
    assistant: { available: true },
    suggestions: [
      {
        id: "suggestion.themes",
        role: "themes",
        label: "What are the main themes in my library?",
        icon: "sparkle",
        personalized: false,
      },
      {
        id: "suggestion.summary",
        role: "summary",
        label: "Summarize the key arguments in The-Doctrine-of-Fascism",
        icon: "fileText",
        documentId: "doc-1",
        personalized: true,
      },
      {
        id: "suggestion.related",
        role: "related",
        label: "Find related documents on totalitarianism",
        icon: "magnifyingGlass",
        query: "totalitarianism",
        personalized: true,
      },
      {
        id: "suggestion.review",
        role: "review",
        label: "What should I review today?",
        icon: "cards",
        personalized: false,
      },
    ],
    contextualActions: [],
    ...overrides,
  };
}

function makeCommand(id: string, label: string): Command {
  return {
    id,
    label,
    description: `${label} description`,
    icon: null,
    category: CommandCategory.Navigation,
    action: vi.fn(),
  } as unknown as Command;
}

function makeController(
  overrides: Partial<PaletteHubController> = {}
): PaletteHubController {
  return {
    home: buildHome(),
    commands: [makeCommand("nav-documents", "Go to Documents")],
    expandedExamples: [],
    dispatch: vi.fn(),
    onContextualAction: vi.fn(),
    saveNote: vi.fn(async () => null),
    ...overrides,
  };
}

function renderHub(controller: PaletteHubController) {
  return render(
    <GlobalSearch
      isOpen={true}
      onOpenChange={vi.fn()}
      hideTrigger={true}
      onSearch={vi.fn(async (_query: SearchQuery): Promise<SearchResult[]> => [])}
      onResultClick={vi.fn()}
      controller={controller}
    />
  );
}

describe("GlobalSearch hub mode", () => {
  beforeEach(() => {
    usePaletteNoteDraftStore.getState().clearDraft();
    useUIStore.getState().setCommandPaletteQuery("");
  });

  it("opens on All home with input focus and useful content without typing", async () => {
    renderHub(makeController());

    const input = screen.getByRole("combobox");
    await waitFor(() => expect(input).toHaveFocus());

    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Quick Actions")).toBeInTheDocument();
    // The Quick Action tile and the resume section heading share the label.
    expect(screen.getAllByText("Resume reading").length).toBeGreaterThan(0);
    expect(screen.getByText("The-Doctrine-of-Fascism")).toBeInTheDocument();
    expect(screen.getByText("Ask Plethora")).toBeInTheDocument();
    expect(screen.getByText("What should I review today?")).toBeInTheDocument();
    expect((input as HTMLInputElement).placeholder).toContain("Search, ask, or run a command");
  });

  it("preserves an explicit caller-provided query on open", async () => {
    act(() => {
      useUIStore.getState().setCommandPaletteQuery("fascism");
    });
    renderHub(makeController());

    const input = screen.getByRole("combobox") as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("fascism"));
    // Consumed exactly once: the store no longer holds the prefill.
    expect(useUIStore.getState().commandPaletteQuery).toBe("");
  });

  it("enforces scope on typed results without losing the query", async () => {
    const controller = makeController();
    const onSearch = vi.fn(async (_query: SearchQuery): Promise<SearchResult[]> => [
      {
        id: "doc-1",
        type: SearchResultType.Document,
        title: "Matched document",
        score: 0.9,
        metadata: { documentId: "doc-1" },
      },
      {
        id: "cmd-settings",
        type: SearchResultType.Command,
        title: "Matched command",
        score: 0.8,
        metadata: { resultKind: "command" },
      },
    ]);
    render(
      <GlobalSearch
        isOpen={true}
        onOpenChange={vi.fn()}
        hideTrigger={true}
        onSearch={onSearch}
        onResultClick={vi.fn()}
        controller={controller}
      />
    );

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "match" } });
    await waitFor(() => expect(screen.getByText("Matched document")).toBeInTheDocument(), {
      timeout: 3000,
    });
    expect(screen.getByText("Matched command")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /Documents/ }));
    expect(screen.getByText("Matched document")).toBeInTheDocument();
    expect(screen.queryByText("Matched command")).not.toBeInTheDocument();
    // Scope changes preserve the query.
    expect((screen.getByRole("combobox") as HTMLInputElement).value).toBe("match");

    fireEvent.click(screen.getByRole("tab", { name: /Actions/ }));
    expect(screen.getByText("Matched command")).toBeInTheDocument();
    expect(screen.queryByText("Matched document")).not.toBeInTheDocument();
  });

  it("executes the highlighted home action exactly once with Enter", async () => {
    const controller = makeController();
    renderHub(controller);

    const input = screen.getByRole("combobox");
    await waitFor(() => expect(input).toHaveFocus());

    fireEvent.keyDown(input, { key: "Enter" });
    expect(controller.dispatch).toHaveBeenCalledTimes(1);
    expect(controller.dispatch).toHaveBeenCalledWith({ id: "palette.resume", documentId: undefined });
  });

  it("keeps a note draft across composer exits and creates no document", async () => {
    const controller = makeController();
    renderHub(controller);

    fireEvent.click(screen.getByText("Create a note"));
    const body = await screen.findByLabelText("Note body");
    await waitFor(() => expect(body).toHaveFocus());
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "My idea" } });
    fireEvent.change(body, { target: { value: "Body text" } });

    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Note body")).not.toBeInTheDocument());

    expect(controller.saveNote).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Create a note"));
    const resumedBody = await screen.findByLabelText("Note body");
    expect((resumedBody as HTMLTextAreaElement).value).toBe("Body text");
    expect((screen.getByLabelText("Title") as HTMLInputElement).value).toBe("My idea");
  });

  it("saves through the controller only when Save is pressed", async () => {
    const saveNote = vi.fn(async () => null);
    const controller = makeController({ saveNote });
    renderHub(controller);

    fireEvent.click(screen.getByText("Create a note"));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Title" } });
    fireEvent.change(await screen.findByLabelText("Note body"), {
      target: { value: "Body" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(saveNote).toHaveBeenCalledWith({ title: "Title", body: "Body" })
    );
  });

  it("opens View all with the palette-local shortcut and preserves the input", async () => {
    const controller = makeController();
    renderHub(controller);

    const input = screen.getByRole("combobox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "doc" } });

    const event = new KeyboardEvent("keydown", {
      key: "/",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getByText("Go to Documents")).toBeInTheDocument());
    expect(input.value).toBe("doc");
  });

  it("does not intercept the View all shortcut while the palette is closed", () => {
    render(
      <GlobalSearch
        isOpen={false}
        onOpenChange={vi.fn()}
        hideTrigger={true}
        onSearch={vi.fn(async () => [])}
        onResultClick={vi.fn()}
        controller={makeController()}
      />
    );
    const event = new KeyboardEvent("keydown", {
      key: "/",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByText("Quick Actions")).not.toBeInTheDocument();
  });

  it("routes suggestions to their real outcomes", async () => {
    const controller = makeController();
    renderHub(controller);

    // Related documents → a real Documents-scope search carrying the topic.
    fireEvent.click(screen.getByText("Find related documents on totalitarianism"));
    const input = screen.getByRole("combobox") as HTMLInputElement;
    expect(input.value).toBe("totalitarianism");
    expect(screen.getByRole("tab", { name: /Documents/ })).toHaveAttribute(
      "aria-selected",
      "true"
    );

    // Review → the review/deck overview action through the shared executor.
    fireEvent.click(screen.getByRole("tab", { name: /All/ }));
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByText("What should I review today?"));
    expect(controller.dispatch).toHaveBeenCalledWith({ id: "palette.openReviewOverview" });

    // Document summary → the grounded library-assistant handoff (no request).
    fireEvent.click(screen.getByText(/Summarize the key arguments/));
    expect(controller.dispatch).toHaveBeenCalledWith({
      id: "palette.askLibrary",
      suggestion: expect.objectContaining({ role: "summary", documentId: "doc-1" }),
    });
  });

  it("ignores out-of-order provider responses", async () => {
    const resolvers = new Map<string, (results: SearchResult[]) => void>();
    const onSearch = vi.fn(
      (query: SearchQuery) =>
        new Promise<SearchResult[]>((resolve) => {
          resolvers.set(query.query, resolve);
        })
    );
    render(
      <GlobalSearch
        isOpen={true}
        onOpenChange={vi.fn()}
        hideTrigger={true}
        onSearch={onSearch}
        onResultClick={vi.fn()}
        controller={makeController()}
      />
    );

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "first" } });
    await waitFor(() => expect(resolvers.has("first")).toBe(true), { timeout: 3000 });
    fireEvent.change(input, { target: { value: "second" } });
    await waitFor(() => expect(resolvers.has("second")).toBe(true), { timeout: 3000 });

    // Resolve the newest request, then the stale one — only the newest may
    // control the visible results.
    act(() => {
      resolvers.get("second")?.([
        {
          id: "doc-second",
          type: SearchResultType.Document,
          title: "Second result",
          score: 0.9,
          metadata: { documentId: "doc-second" },
        },
      ]);
    });
    await waitFor(() => expect(screen.getByText("Second result")).toBeInTheDocument());
    act(() => {
      resolvers.get("first")?.([
        {
          id: "doc-first",
          type: SearchResultType.Document,
          title: "First result",
          score: 0.9,
          metadata: { documentId: "doc-first" },
        },
      ]);
    });
    expect(screen.queryByText("First result")).not.toBeInTheDocument();
    expect(screen.getByText("Second result")).toBeInTheDocument();
  });

  it("announces a settled result count politely", async () => {
    const controller = makeController();
    const onSearch = vi.fn(async (): Promise<SearchResult[]> => [
      {
        id: "doc-1",
        type: SearchResultType.Document,
        title: "Only result",
        score: 0.9,
        metadata: { documentId: "doc-1" },
      },
    ]);
    render(
      <GlobalSearch
        isOpen={true}
        onOpenChange={vi.fn()}
        hideTrigger={true}
        onSearch={onSearch}
        onResultClick={vi.fn()}
        controller={controller}
      />
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "only" } });
    await waitFor(() => {
      const status = document.querySelector('output[aria-live="polite"]');
      expect(status?.textContent).toContain("1 results");
    });
  });

  it("lists each registered destination exactly once in View all", async () => {
    const controller = makeController({ commands: buildCommandRegistry(makeRegistryDeps()) });
    renderHub(controller);
    openViewAll();

    await waitFor(() => expect(screen.getByText("RSS")).toBeInTheDocument());
    const titleCount = (label: string) =>
      Array.from(document.querySelectorAll(".ch-result-title-text")).filter(
        (node) => node.textContent === label
      ).length;
    expect(titleCount("RSS")).toBe(1);
    expect(titleCount("Podcasts")).toBe(1);
    expect(titleCount("Knowledge Sphere")).toBe(1);
    expect(titleCount("Document Q&A")).toBe(1);
    expect(titleCount("Settings")).toBe(1);
  });

  it("filters browse rows by alias and keyword through the shared matcher", async () => {
    const controller = makeController({ commands: buildCommandRegistry(makeRegistryDeps()) });
    renderHub(controller);
    openViewAll();
    await waitFor(() => expect(screen.getByText("RSS")).toBeInTheDocument());

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "feeds" } });
    expect(screen.getByText("RSS")).toBeInTheDocument();
    expect(screen.queryByText("Smart Tag Untagged Documents")).not.toBeInTheDocument();
    expect(screen.queryByText("Audiobooks")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "highlights" } });
    expect(screen.getByText("Extracts")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "zzzzz" } });
    expect(screen.getByText("No results found")).toBeInTheDocument();
  });

  it("executes the highlighted browse command exactly once per activation", async () => {
    const action = vi.fn();
    const controller = makeController({
      commands: [
        {
          id: "cmd-test",
          label: "Test Command",
          description: "Runs the test action",
          icon: null,
          category: CommandCategory.General,
          action,
        } as unknown as Command,
      ],
    });
    renderHub(controller);
    openViewAll();
    await waitFor(() => expect(screen.getByText("Test Command")).toBeInTheDocument());

    const input = screen.getByRole("combobox");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(action).toHaveBeenCalledTimes(1);

    // Let executeCommand's pending guard settle before the pointer activation.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.click(screen.getByText("Test Command"));
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("moves browse selection with arrow keys and closes on Escape", async () => {
    const onOpenChange = vi.fn();
    const controller = makeController({ commands: buildCommandRegistry(makeRegistryDeps()) });
    render(
      <GlobalSearch
        isOpen={true}
        onOpenChange={onOpenChange}
        hideTrigger={true}
        onSearch={vi.fn(async () => [])}
        onResultClick={vi.fn()}
        controller={controller}
      />
    );
    openViewAll();

    const input = screen.getByRole("combobox");
    const first = input.getAttribute("aria-activedescendant");
    expect(first).toBeTruthy();
    fireEvent.keyDown(input, { key: "ArrowDown" });
    await waitFor(() =>
      expect(input.getAttribute("aria-activedescendant")).not.toBe(first)
    );
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input.getAttribute("aria-activedescendant")).toBe(first);

    // Escape precedence: innermost surface first (exits View all), then the
    // palette itself closes on the next Escape.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
