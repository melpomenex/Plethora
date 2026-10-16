import { describe, expect, it, vi } from "vitest";
import {
  COMMAND_TIER_SCORES,
  REGISTRY_COMMAND_EXCEPTIONS,
  buildCommandRegistry,
  commandMatchesQuery,
  isRegistryCommandException,
  matchCommands,
  normalizeCommandQuery,
  scoreCommand,
  type RegistryDeps,
} from "../registry";
import { NAVIGATION_DESTINATIONS } from "../../navigation/tabDestinations";
import { en } from "../../lib/i18n/locales/en";
import {
  settleDestinationAction,
  useDestinationActionStore,
} from "../destinationActions";

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

function registry(overrides: Partial<RegistryDeps> = {}) {
  return buildCommandRegistry(makeDeps(overrides));
}

describe("normalizeCommandQuery", () => {
  it("trims, lowercases, and collapses whitespace", () => {
    expect(normalizeCommandQuery("  New   FlashCard  ")).toBe("new flashcard");
  });

  it("returns an empty string for blank input", () => {
    expect(normalizeCommandQuery("   ")).toBe("");
  });
});

describe("registry coverage", () => {
  it("exposes every canonical destination exactly once", () => {
    const commands = registry();
    for (const destination of NAVIGATION_DESTINATIONS) {
      const matches = commands.filter((cmd) => cmd.id === `go-${destination.id}`);
      expect(matches, `missing registry entry for destination "${destination.id}"`).toHaveLength(1);
      expect(matches[0].intentId).toBe(`destination:${destination.id}`);
    }
  });

  it("every entry has an executable action", () => {
    for (const cmd of registry()) {
      expect(typeof cmd.action, `command "${cmd.id}" has no action`).toBe("function");
    }
  });

  it("every entry is capability-gated or on the reviewed exception list", () => {
    for (const cmd of registry()) {
      const allowlisted = isRegistryCommandException(cmd.id);
      expect(
        Boolean(cmd.capabilityId) || allowlisted,
        `command "${cmd.id}" is neither gated nor exception-listed`
      ).toBe(true);
      if (!cmd.capabilityId) {
        expect(
          REGISTRY_COMMAND_EXCEPTIONS[cmd.id] ?? cmd.id.startsWith("theme-"),
          `exception rationale missing for "${cmd.id}"`
        ).toBeTruthy();
      }
    }
  });

  it("keeps ids, intent ids, and aliases unambiguous", () => {
    const commands = registry();
    const ids = commands.map((cmd) => cmd.id);
    expect(new Set(ids).size).toBe(ids.length);

    const intents = commands.map((cmd) => cmd.intentId).filter(Boolean);
    expect(new Set(intents).size).toBe(intents.length);

    const aliasOwners = new Map<string, string>();
    for (const cmd of commands) {
      for (const alias of cmd.aliases ?? []) {
        const key = alias.toLowerCase();
        const owner = aliasOwners.get(key);
        if (owner) {
          expect(
            owner,
            `alias "${alias}" declared by both "${owner}" and "${cmd.id}"`
          ).toBe(cmd.id);
        } else {
          aliasOwners.set(key, cmd.id);
        }
      }
    }
  });
});

describe("matchCommands", () => {
  it("returns no matches for an empty query", () => {
    expect(matchCommands(registry(), "")).toEqual([]);
    expect(matchCommands(registry(), "   ")).toEqual([]);
  });

  it("ranks exact destination labels first", () => {
    for (const [query, expectedId] of [
      ["settings", "go-settings"],
      ["analytics", "go-analytics"],
      ["podcasts", "go-podcasts"],
      ["audiobooks", "go-audiobooks"],
      ["rss", "go-rss"],
      ["review", "go-review"],
      ["documents", "go-documents"],
      ["queue", "go-queue"],
    ] as const) {
      const matches = matchCommands(registry(), query);
      expect(matches[0]?.command.id, `query "${query}"`).toBe(expectedId);
      expect(matches[0]?.tier).toBe("exact-label");
      expect(matches[0]?.score).toBe(COMMAND_TIER_SCORES["exact-label"]);
    }
  });

  it("matches primary aliases at the exact-alias tier", () => {
    for (const [query, expectedId] of [
      ["feeds", "go-rss"],
      ["stats", "go-analytics"],
      ["flashcards", "go-review"],
      ["prefs", "go-settings"],
      ["docs", "go-documents"],
    ] as const) {
      const matches = matchCommands(registry(), query);
      expect(matches[0]?.command.id, `query "${query}"`).toBe(expectedId);
      expect(matches[0]?.tier).toBe("exact-alias");
    }
  });

  it("is case-insensitive and order-stable", () => {
    const lower = matchCommands(registry(), "rss").map((m) => m.command.id);
    const upper = matchCommands(registry(), "RSS").map((m) => m.command.id);
    expect(upper).toEqual(lower);
    const first = matchCommands(registry(), "settings").map((m) => `${m.command.id}:${m.tier}`);
    const second = matchCommands(registry(), "settings").map((m) => `${m.command.id}:${m.tier}`);
    expect(second).toEqual(first);
  });

  it("supports multiword queries with AND semantics", () => {
    const matches = matchCommands(registry(), "new flashcard");
    expect(matches.map((m) => m.command.id)).toContain("new-flashcard");
    // A query with an unmatched token matches nothing.
    expect(matchCommands(registry(), "new flashcard zzzz")).toEqual([]);
  });

  it("tolerates small typos via fuzzy matching", () => {
    const matches = matchCommands(registry(), "podcasst");
    expect(matches[0]?.command.id).toBe("go-podcasts");
    expect(matches[0]?.tier).toBe("fuzzy");
  });

  it("orders tiers deterministically: exact > alias > prefix > keyword > fuzzy > description", () => {
    expect(COMMAND_TIER_SCORES["exact-label"]).toBeGreaterThan(COMMAND_TIER_SCORES["exact-alias"]);
    expect(COMMAND_TIER_SCORES["exact-alias"]).toBeGreaterThan(COMMAND_TIER_SCORES["prefix-label"]);
    expect(COMMAND_TIER_SCORES["prefix-label"]).toBeGreaterThan(COMMAND_TIER_SCORES["prefix-alias"]);
    expect(COMMAND_TIER_SCORES["prefix-alias"]).toBeGreaterThan(COMMAND_TIER_SCORES["keyword"]);
    expect(COMMAND_TIER_SCORES.keyword).toBeGreaterThan(COMMAND_TIER_SCORES.fuzzy);
    expect(COMMAND_TIER_SCORES.fuzzy).toBeGreaterThan(COMMAND_TIER_SCORES.description);
  });

  it("breaks ties by registry order", () => {
    const commands = registry();
    const matches = matchCommands(commands, "settings");
    for (let i = 1; i < matches.length; i++) {
      if (matches[i - 1].score === matches[i].score) {
        const before = commands.findIndex((c) => c.id === matches[i - 1].command.id);
        const after = commands.findIndex((c) => c.id === matches[i].command.id);
        expect(before).toBeLessThan(after);
      }
    }
  });

  it("matches theme commands by their user-facing aliases", () => {
    const matches = matchCommands(registry(), "dark mode");
    expect(matches[0]?.command.id).toBe("theme-set-dark");
    expect(matches[0]?.tier).toBe("exact-alias");
  });
});

describe("scoreCommand compatibility", () => {
  it("commandMatchesQuery mirrors scoreCommand", () => {
    const commands = registry();
    const settings = commands.find((c) => c.id === "go-settings")!;
    expect(commandMatchesQuery(settings, "settings")).toBe(true);
    expect(commandMatchesQuery(settings, "zzzz")).toBe(false);
    expect(scoreCommand(settings, "")).toBeNull();
  });
});

describe("settings sections", () => {
  it("registers one command per visible section and excludes account without cloud", () => {
    const commands = registry();
    expect(commands.find((cmd) => cmd.id === "settings-section-appearance")).toBeTruthy();
    expect(commands.find((cmd) => cmd.id === "settings-section-help")).toBeTruthy();
    // Plethora Cloud is not publicly available in tests → Account is omitted.
    expect(commands.find((cmd) => cmd.id === "settings-section-account")).toBeUndefined();
  });

  it("matches a multiword section query ahead of weaker matches", () => {
    const matches = matchCommands(registry(), "appearance settings");
    expect(matches[0]?.command.id).toBe("settings-section-appearance");
    expect(matches[0]?.score).toBeGreaterThanOrEqual(COMMAND_TIER_SCORES["prefix-label"]);
  });

  it("delivers a section activation through the destination-action handoff", () => {
    const cmd = registry().find((c) => c.id === "settings-section-appearance")!;
    void cmd.action();
    const pending = useDestinationActionStore.getState().pending;
    expect(pending).toMatchObject({
      destination: "settings",
      action: "section",
      section: "appearance",
    });
    if (pending) settleDestinationAction(pending.id);
  });
});
