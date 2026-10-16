import { describe, expect, it } from "vitest";
import { en } from "../../../lib/i18n/locales/en";
import { ASSISTANT_SLASH_COMMANDS, matchAssistantSlashCommands } from "../assistantSlashCommands";

describe("assistant slash command catalogue", () => {
  it("exposes exactly the commands the mobile menu and desktop chips share", () => {
    expect(ASSISTANT_SLASH_COMMANDS.map((command) => command.command)).toEqual([
      "/20rules",
      "/tools",
      "/help",
      "/clear",
    ]);
  });

  it("every description key resolves to a non-empty English string", () => {
    for (const command of ASSISTANT_SLASH_COMMANDS) {
      expect(command.descriptionKey).toMatch(/^assistant\./);
      expect(en[command.descriptionKey]?.trim(), command.descriptionKey).toBeTruthy();
    }
  });

  it("matches on command text and localized description", () => {
    const translate = (key: string) => en[key] ?? key;
    expect(matchAssistantSlashCommands("", translate)).toHaveLength(4);
    expect(matchAssistantSlashCommands("/too", translate).map((c) => c.command)).toEqual(["/tools"]);
    expect(matchAssistantSlashCommands("flashcard", translate).map((c) => c.command)).toEqual(["/20rules"]);
    expect(matchAssistantSlashCommands("zzz", translate)).toEqual([]);
  });
});
