import { describe, expect, it, vi } from "vitest";
import { buildCommandRegistry, matchCommands, type RegistryDeps } from "../registry";
import { NAVIGATION_DESTINATIONS } from "../../navigation/tabDestinations";
import { en } from "../../lib/i18n/locales/en";
import { settleDestinationAction, useDestinationActionStore } from "../destinationActions";

function makeDeps(overrides: Partial<RegistryDeps> = {}): RegistryDeps {
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
    ...overrides,
  };
}

function matchFirst(commands: ReturnType<typeof buildCommandRegistry>, query: string) {
  const matches = matchCommands(commands, query);
  expect(matches.length, `no match for "${query}"`).toBeGreaterThan(0);
  return matches[0];
}

function settlePending() {
  const pending = useDestinationActionStore.getState().pending;
  if (pending) settleDestinationAction(pending.id);
}

describe("destination acceptance: every registered destination is reachable by name", () => {
  for (const destination of NAVIGATION_DESTINATIONS) {
    it(`offers ${destination.id} for "${en[destination.labelKey]}" and navigates on activation`, async () => {
      const commands = buildCommandRegistry(makeDeps());
      const match = matchFirst(commands, en[destination.labelKey]);
      expect(match.command.id).toBe(`go-${destination.id}`);

      const dispatchSpy = vi.spyOn(window, "dispatchEvent");
      await match.command.action();
      expect(dispatchSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "navigate",
          detail: destination.path,
        })
      );
      dispatchSpy.mockRestore();
    });
  }

  for (const [query, expectedId] of [
    ["feeds", "go-rss"],
    ["stats", "go-analytics"],
    ["flashcards", "go-review"],
    ["prefs", "go-settings"],
    ["home", "go-dashboard"],
    ["scroll", "go-scroll-mode"],
    ["qa", "go-doc-qa"],
    ["images", "go-images"],
    ["browser", "go-web-browser"],
  ] as const) {
    it(`offers ${expectedId} for the alias "${query}"`, () => {
      const commands = buildCommandRegistry(makeDeps());
      const match = matchFirst(commands, query);
      expect(match.command.id).toBe(expectedId);
    });
  }
});

describe("action acceptance: representative operations execute their real workflows", () => {
  it("'new queue' opens the queue customization destination", () => {
    const commands = buildCommandRegistry(makeDeps());
    const match = matchFirst(commands, "new queue");
    expect(match.command.id).toBe("new-saved-queue");
    void match.command.action();
    expect(useDestinationActionStore.getState().pending).toMatchObject({
      destination: "queue",
      action: "new",
    });
    settlePending();
  });

  it("'new flashcard' delivers the review create-card destination action", () => {
    const commands = buildCommandRegistry(makeDeps());
    const match = matchFirst(commands, "new flashcard");
    expect(match.command.id).toBe("new-flashcard");
    void match.command.action();
    expect(useDestinationActionStore.getState().pending).toMatchObject({
      destination: "review",
      action: "create-card",
    });
    settlePending();
  });

  it("'import document' delivers the documents import destination action", () => {
    const commands = buildCommandRegistry(makeDeps());
    const match = matchFirst(commands, "import document");
    expect(match.command.id).toBe("new-document");
    void match.command.action();
    expect(useDestinationActionStore.getState().pending).toMatchObject({
      destination: "documents",
      action: "import",
    });
    settlePending();
  });

  it("'refresh feeds' delivers the RSS refresh destination action", () => {
    const commands = buildCommandRegistry(makeDeps());
    const match = matchFirst(commands, "refresh feeds");
    expect(match.command.id).toBe("refresh-rss-feeds");
    void match.command.action();
    expect(useDestinationActionStore.getState().pending).toMatchObject({
      destination: "rss",
      action: "refresh",
    });
    settlePending();
  });

  it("'dark mode' switches to the dark theme", async () => {
    const setTheme = vi.fn();
    const commands = buildCommandRegistry(makeDeps({ setTheme }));
    const match = matchFirst(commands, "dark mode");
    expect(match.command.id).toBe("theme-set-dark");
    await match.command.action();
    expect(setTheme).toHaveBeenCalledWith("theme-dark");
  });

  it("'keyboard shortcuts' opens the shortcuts help surface", async () => {
    const handler = vi.fn();
    window.addEventListener("show-shortcuts-help", handler);
    const commands = buildCommandRegistry(makeDeps());
    const match = matchFirst(commands, "keyboard shortcuts");
    expect(match.command.id).toBe("keyboard-shortcuts");
    await match.command.action();
    window.removeEventListener("show-shortcuts-help", handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("a saved-queue command switches to that queue", () => {
    const commands = buildCommandRegistry(
      makeDeps({ savedQueues: [{ id: "q1", name: "Morning" }] })
    );
    const match = matchFirst(commands, "morning");
    expect(match.command.id).toBe("switch-queue-q1");
    void match.command.action();
    expect(useDestinationActionStore.getState().pending).toMatchObject({
      destination: "queue",
      action: "select",
      queueId: "q1",
    });
    settlePending();
  });
});
