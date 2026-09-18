/**
 * Obsidian defaults rebrand (#7).
 *
 * New/unconfigured Obsidian + Anki defaults must present as Plethora, while
 * stored user configuration (localStorage["integration_settings"]) must be
 * left untouched. The intentional legacy copy (vault-id migration i18n,
 * legacy-archive import, `.incrementum` backup filter) is covered separately.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultSettings } from "../config/defaultSettings";
import { getIntegrationSettings, updateObsidianConfig, updateAnkiConfig } from "../api/integrations";

const root = join(__dirname, "..", "..");
const read = (rel: string): string => readFileSync(join(root, rel), "utf8");

describe("Obsidian defaults rebrand (#7)", () => {
  describe("dormant defaults", () => {
    it("default Obsidian template is Plethora-branded, not incrementum", () => {
      const template = defaultSettings.integrations.obsidian.template;
      expect(template).toContain("tags: [plethora]");
      expect(template).not.toContain("incrementum");
    });

    it("default Anki deck name is Plethora", () => {
      expect(defaultSettings.integrations.anki.deckName).toBe("Plethora");
      expect(defaultSettings.integrations.anki.deckName).not.toMatch(/incrementum/i);
    });
  });

  describe("frontend default surfaces", () => {
    it("IntegrationSettings defaults and placeholders are Plethora-branded", () => {
      const source = read("src/components/settings/IntegrationSettings.tsx");
      expect(source).toContain('useState("Plethora")');
      expect(source).toContain('useState("Plethora Assets")');
      expect(source).toContain('notesFolder: obsidianNotes || "Plethora"');
      expect(source).toContain('attachmentsFolder: obsidianAttachments || "Plethora Assets"');
      expect(source).toContain('placeholder="Plethora"');
      expect(source).toContain('placeholder="Plethora Assets"');
      expect(source).not.toMatch(/placeholder="Incrementum"/);
    });

    it("the dormant settings-validation schema defaults are Plethora-branded", () => {
      const source = read("src/utils/settingsValidation.ts");
      expect(source).toContain("tags: [plethora]");
      expect(source).toContain("deckName: z.string().default('Plethora')");
      expect(source).not.toContain("tags: [incrementum]");
    });

    it("Anki export defaults are Plethora-branded", () => {
      const source = read("src/utils/ankiExport.ts");
      expect(source).toContain('name: "Plethora Basic"');
      expect(source).toContain('"plethora-export"');
      expect(source).toContain("`plethora-id::${item.id}`");
    });

  });

  describe("existing user configuration is preserved", () => {
    beforeEach(() => {
      localStorage.clear();
    });

    it("returns a stored Incrementum folder config unchanged", () => {
      const stored = {
        obsidian: { vaultPath: "/vault", notesFolder: "Incrementum", attachmentsFolder: "Incrementum Assets" },
        anki: null,
        extensionPort: 8766,
        notebooklm: { enabled: false, provider: "mock", activeNotebookId: null, defaultDeckName: "NotebookLM Imports", dedupeOnImport: true },
      };
      localStorage.setItem("integration_settings", JSON.stringify(stored));

      const loaded = getIntegrationSettings();
      expect(loaded.obsidian?.notesFolder).toBe("Incrementum");
      expect(loaded.obsidian?.attachmentsFolder).toBe("Incrementum Assets");
    });

    it("updateObsidianConfig persists exactly what the user set", () => {
      updateObsidianConfig({ vaultPath: "/vault", notesFolder: "My Notes", attachmentsFolder: "Media" });
      const loaded = getIntegrationSettings();
      expect(loaded.obsidian?.notesFolder).toBe("My Notes");
      expect(loaded.obsidian?.attachmentsFolder).toBe("Media");
    });

    it("updateAnkiConfig persists the user's deck name", () => {
      updateAnkiConfig({ url: "http://localhost:8765", deckName: "My Deck", modelName: "Basic" });
      expect(getIntegrationSettings().anki?.deckName).toBe("My Deck");
    });
  });
});
