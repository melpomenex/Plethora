import { useMemo, useRef, useState } from "react";
import { MagnifyingGlass } from "@phosphor-icons/react";
import { buildCommandRegistry, matchCommands } from "../../../commandPalette/registry";
import { executeCommand } from "../../../commandPalette/executeCommand";
import { useTheme } from "../../../contexts/ThemeContext";
import { useI18n } from "../../../lib/i18n";
import { isTauri } from "../../../lib/tauri";
import { useSavedQueueStore } from "../../../stores/savedQueueStore";

/** Same catalogue, availability, matching and executor as the keyboard palette. */
export function MobileAssistantCommands({ sourceTitle, onClose }: { sourceTitle?: string; onClose: () => void }) {
  const { t } = useI18n();
  const { theme, themes, setTheme } = useTheme();
  const savedQueues = useSavedQueueStore(state => state.savedQueues);
  const [query, setQuery] = useState("");
  const firstResult = useRef<HTMLButtonElement>(null);
  const commands = useMemo(() => buildCommandRegistry({ translate: t, theme, themes, setTheme, isWeb: !isTauri(), selectedDocumentTitle: sourceTitle ?? null, savedQueues }), [t, theme, themes, setTheme, sourceTitle, savedQueues]);
  const results = useMemo(() => query.trim() ? matchCommands(commands, query).map(match => match.command) : commands, [commands, query]);
  return <div className="flex h-full min-h-0 flex-col">
    <label className="m-3 flex min-h-12 items-center gap-2 rounded-lg bg-surface-container-highest px-3">
      <MagnifyingGlass size={20} aria-hidden="true" />
      <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search commands" aria-label="Search commands" className="min-w-0 flex-1 bg-transparent text-on-surface outline-none"
        onKeyDown={event => { if (event.key === "ArrowDown") { event.preventDefault(); firstResult.current?.focus(); } if (event.key === "Enter" && results[0]) { event.preventDefault(); void executeCommand(results[0], onClose); } }} />
    </label>
    <ul className="min-h-0 flex-1 overflow-y-auto px-3 pb-3" aria-label="Commands">
      {results.map((command, index) => <li key={command.id}>
        <button ref={index === 0 ? firstResult : undefined} type="button" className="md-state flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-start focus-visible:outline focus-visible:outline-2"
          onClick={() => { void executeCommand(command, onClose); }}>
          <span aria-hidden="true">{command.icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{command.label}</span>{command.description && <span className="block text-xs text-muted-foreground">{command.description}</span>}</span>
        </button>
      </li>)}
    </ul>
    {results.length === 0 && <p className="px-4 pb-4 text-sm text-muted-foreground" role="status">No matching commands.</p>}
  </div>;
}
