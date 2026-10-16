/**
 * Single source of truth for the Assistant's local slash commands.
 *
 * These commands are intercepted in `AssistantPanel`'s send path; the desktop
 * quick-action chips and the mobile add menu render them from this list so the
 * two surfaces cannot drift apart.
 */
export interface AssistantSlashCommand {
  /** Exact text inserted into the composer. */
  command: string;
  /** i18n key of the one-line description shown in menus and tooltips. */
  descriptionKey: string;
}

export const ASSISTANT_SLASH_COMMANDS: readonly AssistantSlashCommand[] = [
  { command: "/20rules", descriptionKey: "assistant.composer.slashTwentyRules" },
  { command: "/tools", descriptionKey: "assistant.composer.slashTools" },
  { command: "/help", descriptionKey: "assistant.composer.slashHelp" },
  { command: "/clear", descriptionKey: "assistant.composer.slashClear" },
];

/** Case-insensitive match over the command text and its localized description. */
export function matchAssistantSlashCommands(query: string, translate: (key: string) => string): AssistantSlashCommand[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...ASSISTANT_SLASH_COMMANDS];
  return ASSISTANT_SLASH_COMMANDS.filter((command) => {
    const haystack = `${command.command} ${translate(command.descriptionKey)}`.toLowerCase();
    return haystack.includes(needle);
  });
}
