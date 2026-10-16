import { useMemo } from "react";
import { buildCommandRegistry, matchCommands } from "../../../commandPalette/registry";
import { executeCommand } from "../../../commandPalette/executeCommand";
import type { Command } from "../../../commandPalette/commandModel";
import { useTheme } from "../../../contexts/ThemeContext";
import { useI18n } from "../../../lib/i18n";
import { isTauri } from "../../../lib/tauri";
import { useSavedQueueStore } from "../../../stores/savedQueueStore";

/**
 * Same catalogue, availability, matching and executor as the keyboard palette.
 * The composer menu owns the single search field and calls this with its query.
 */
export function useAssistantCommandMatches(sourceTitle: string | undefined, query: string): Command[] {
  const { t } = useI18n();
  const { theme, themes, setTheme } = useTheme();
  const savedQueues = useSavedQueueStore(state => state.savedQueues);
  const commands = useMemo(() => buildCommandRegistry({ translate: t, theme, themes, setTheme, isWeb: !isTauri(), selectedDocumentTitle: sourceTitle ?? null, savedQueues }), [t, theme, themes, setTheme, sourceTitle, savedQueues]);
  return useMemo(() => query.trim() ? matchCommands(commands, query).map(match => match.command) : commands, [commands, query]);
}

/** Filtered registry list rendered inside the composer menu. */
export function MobileAssistantCommands({ commands, onExecuted, labelledBy }: { commands: Command[]; onExecuted: () => void; labelledBy?: string }) {
  if (commands.length === 0) return null;
  return <ul aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : "Commands"}>
    {commands.map(command => <li key={command.id}>
      <button type="button" className="md-state flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-start focus-visible:outline focus-visible:outline-2"
        onClick={() => { void executeCommand(command, onExecuted); }}>
        <span aria-hidden="true">{command.icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{command.label}</span>{command.description && <span className="block text-xs text-muted-foreground">{command.description}</span>}</span>
      </button>
    </li>)}
  </ul>;
}
