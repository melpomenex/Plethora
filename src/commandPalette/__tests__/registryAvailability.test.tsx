import { describe, expect, it, vi } from "vitest";

// Force every platform capability to be unavailable: the registry must omit
// gated commands and keep only ungated, exception-listed mechanics.
// (vi.mock is hoisted above the imports below, so the registry sees the mock.)
vi.mock("../../lib/platformCapabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/platformCapabilities")>();
  return {
    ...actual,
    isPlatformCapabilityAvailable: vi.fn(() => false),
  };
});

import { en } from "../../lib/i18n/locales/en";
import { buildCommandRegistry, type RegistryDeps } from "../registry";

function makeDeps(): RegistryDeps {
  return {
    translate: (key, vars) => {
      const template = en[key] ?? key;
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
    },
    theme: { id: "theme-dark", name: "Dark", variant: "dark" },
    themes: [{ id: "theme-dark", name: "Dark", variant: "dark" }],
    setTheme: vi.fn(),
    isWeb: false,
    selectedDocumentTitle: null,
    savedQueues: [],
  };
}

describe("registry platform restrictions", () => {
  it("omits platform-gated destinations and operations", () => {
    const commands = buildCommandRegistry(makeDeps());

    for (const id of [
      "go-rss",
      "go-podcasts",
      "go-audiobooks",
      "go-knowledge-sphere",
      "go-doc-qa",
      "refresh-rss-feeds",
      "settings-section-appearance",
      "new-flashcard",
      "new-document",
    ]) {
      expect(commands.find((cmd) => cmd.id === id), `${id} should be hidden`).toBeUndefined();
    }

    // Ungated, exception-listed mechanics stay available everywhere.
    expect(commands.find((cmd) => cmd.id === "keyboard-shortcuts")).toBeTruthy();
    expect(commands.find((cmd) => cmd.id === "go-web-browser")).toBeTruthy();
    expect(commands.find((cmd) => cmd.id === "theme-set-dark")).toBeTruthy();
  });

  it("omits precondition commands whose context is unavailable", () => {
    const commands = buildCommandRegistry(makeDeps());

    // No active selection in the test environment → Translate Selection hidden.
    expect(commands.find((cmd) => cmd.id === "translate-selection")).toBeUndefined();
    // Plethora Cloud is not publicly available in tests → Account section hidden.
    expect(commands.find((cmd) => cmd.id === "settings-section-account")).toBeUndefined();
  });
});
