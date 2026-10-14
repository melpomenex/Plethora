import { describe, expect, it } from "vitest";
import {
  classifyResultFacet,
  commandScopes,
  filterResultsByScope,
  resultMatchesScope,
} from "../facets";

const result = (
  type: string,
  metadata: Record<string, unknown> | null = null
): { type: string; metadata: Record<string, unknown> | null } => ({ type, metadata });

describe("palette facets", () => {
  it("classifies result kinds into the scope model", () => {
    expect(classifyResultFacet(result("command", { resultKind: "command" }))).toBe("actions");
    expect(
      classifyResultFacet(result("command", { resultKind: "contextual-action" }))
    ).toBe("actions");
    expect(
      classifyResultFacet(result("document", { resultKind: "rss-article" }))
    ).toBe("library");
    expect(
      classifyResultFacet(result("document", { resultKind: "podcast-episode" }))
    ).toBe("library");
    expect(classifyResultFacet(result("command", { resultKind: "help-article" }))).toBe("help");
    expect(classifyResultFacet(result("command", { resultKind: "ask-plethora" }))).toBe("help");
    expect(classifyResultFacet(result("flashcard"))).toBe("cards");
    expect(classifyResultFacet(result("document"))).toBe("documents");
    expect(classifyResultFacet(result("extract"))).toBe("documents");
    expect(classifyResultFacet(result("category"))).toBe("library");
    expect(classifyResultFacet(result("tag"))).toBe("library");
  });

  it("routes settings sections to the settings facet and others to library", () => {
    expect(
      classifyResultFacet(result("command", { resultKind: "section", targetPath: "/settings" }))
    ).toBe("settings");
    expect(
      classifyResultFacet(result("command", { resultKind: "section", targetPath: "/analytics" }))
    ).toBe("library");
  });

  it("honors explicit metadata scopes over structural classification", () => {
    expect(classifyResultFacet(result("document", { scopes: ["cards"] }))).toBe("cards");
  });

  it("keeps help results available under every scope", () => {
    const help = result("command", { resultKind: "help-article" });
    for (const scope of ["actions", "documents", "library", "cards", "settings"] as const) {
      expect(resultMatchesScope(help, scope)).toBe(true);
    }
  });

  it("honors explicit extra scopes for multi-facet results", () => {
    const multi = result("document", { scopes: ["documents", "cards"] });
    expect(resultMatchesScope(multi, "documents")).toBe(true);
    expect(resultMatchesScope(multi, "cards")).toBe(true);
    expect(resultMatchesScope(multi, "settings")).toBe(false);
  });

  it("All accepts everything without filtering", () => {
    const mixed = [
      result("document"),
      result("command", { resultKind: "command" }),
      result("flashcard"),
    ];
    expect(filterResultsByScope(mixed, "all")).toEqual(mixed);
    expect(filterResultsByScope(mixed, "documents")).toHaveLength(1);
    expect(filterResultsByScope(mixed, "actions")).toHaveLength(1);
    expect(filterResultsByScope(mixed, "cards")).toHaveLength(1);
  });

  it("filters a Settings scope away from feed/episode results", () => {
    const rss = result("document", { resultKind: "rss-article" });
    const settingsSection = result("command", {
      resultKind: "section",
      targetPath: "/settings",
    });
    const filtered = filterResultsByScope([rss, settingsSection], "settings");
    expect(filtered).toEqual([settingsSection]);
  });

  it("classifies command scopes by category, id, and destination", () => {
    expect(commandScopes("Settings", "anything")).toEqual(["settings"]);
    expect(commandScopes("General", "theme-switch-dark")).toEqual(["settings"]);
    expect(commandScopes("Navigation", "nav-documents")).toEqual(["library"]);
    expect(commandScopes("Documents", "paste-extract")).toEqual(["actions"]);
  });
});
