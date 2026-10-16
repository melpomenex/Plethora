/**
 * Command palette for quick actions
 * Inspired by VS Code command palette
 */

import { executeCommand } from "../../commandPalette/executeCommand";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Command as CommandIcon,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import { useI18n, t } from "../../lib/i18n";
import { CommandCategory, type Command } from "../../commandPalette/commandModel";
import { buildDefaultCommands } from "../../commandPalette/registry";

/**
 * The command model lives in `commandPalette/commandModel` (leaf module) so the
 * unified registry can share it without importing this component. Re-exported
 * here to preserve existing imports.
 */
export type { Command } from "../../commandPalette/commandModel";
export {
  CommandCategory,
  createCommand,
  filterCommandsByPlatformAvailability,
} from "../../commandPalette/commandModel";

/**
 * Command palette props
 */
interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
}

/**
 * Hook to manage keyboard shortcut for opening command palette
 */
export function useCommandPaletteShortcut(): string {
  const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
  return isMac ? "⌘K" : "Ctrl+K";
}

export function CommandPalette({ isOpen, onClose, commands }: CommandPaletteProps) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectedCommandRef = useRef<HTMLButtonElement | null>(null);

  // Filter commands based on query
  const filteredCommands = useCallback(() => {
    if (!query.trim()) {
      return commands;
    }

    const lowerQuery = query.toLowerCase();
    return commands.filter((cmd) => {
      const labelMatch = cmd.label.toLowerCase().includes(lowerQuery);
      const descMatch = cmd.description?.toLowerCase().includes(lowerQuery) || false;
      const keywordMatch = cmd.keywords?.some((kw) => kw.toLowerCase().includes(lowerQuery)) || false;
      const categoryMatch = cmd.category.toLowerCase().includes(lowerQuery);

      return labelMatch || descMatch || keywordMatch || categoryMatch;
    });
  }, [commands, query]);

  // Reset selection when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    selectedCommandRef.current?.scrollIntoView?.({
      block: "nearest",
    });
  }, [selectedIndex, query]);

  useEffect(() => {
    const filtered = filteredCommands();
    if (filtered.length === 0) {
      setSelectedIndex(0);
      return;
    }

    setSelectedIndex((current) => Math.max(0, Math.min(current, filtered.length - 1)));
  }, [filteredCommands]);

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const filtered = filteredCommands();

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        if (filtered.length > 0) {
          setSelectedIndex((prev) => (prev + 1) % filtered.length);
        }
        break;
      case "ArrowUp":
        e.preventDefault();
        if (filtered.length > 0) {
          setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
        }
        break;
      case "Enter":
        e.preventDefault();
        if (filtered[selectedIndex]) {
          void executeCommand(filtered[selectedIndex], onClose);
        }
        break;
      case "Escape":
        e.preventDefault();
        onClose();
        break;
    }
  };

  // Group commands by category
  const groupedCommands = useCallback(() => {
    const filtered = filteredCommands();
    const groups: Record<CommandCategory, Command[]> = {
      [CommandCategory.General]: [],
      [CommandCategory.Documents]: [],
      [CommandCategory.Extracts]: [],
      [CommandCategory.Flashcards]: [],
      [CommandCategory.Review]: [],
      [CommandCategory.Gear]: [],
      [CommandCategory.Navigation]: [],
    };

    filtered.forEach((cmd) => {
      if (groups[cmd.category]) {
        groups[cmd.category].push(cmd);
      }
    });

    return groups;
  }, [filteredCommands]);

  const shortcut = useCommandPaletteShortcut();

  if (!isOpen) return null;

  const groups = groupedCommands();
  const filtered = filteredCommands();
  const filteredCommandIndexes = new Map(filtered.map((cmd, index) => [cmd.id, index]));
  const hasResults = Object.values(groups).some((cmds) => cmds.length > 0);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={onClose}
      />

      {/* Command Palette */}
      <div className="fixed inset-x-4 top-20 z-50 mx-auto max-w-2xl">
        <div
          className="bg-card border border-border rounded-lg shadow-2xl overflow-hidden"
          onKeyDown={handleKeyDown}
        >
          {/* Search Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
            <MagnifyingGlass className="w-5 h-5 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("commandPalette.placeholder")}
              className="flex-1 bg-transparent border-none outline-none text-foreground placeholder:text-muted-foreground"
            />
            <kbd className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded">
              {shortcut}
            </kbd>
            <kbd className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-80 overflow-y-auto">
            {!hasResults ? (
              <div className="p-8 text-center text-muted-foreground">
                <CommandIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>{t("commandPalette.noCommandsFound")}</p>
                <p className="text-xs mt-1">{t("commandPalette.tryDifferentSearch")}</p>
              </div>
            ) : (
              <div>
                {Object.entries(groups).map(([category, cmds]) => {
                  if (cmds.length === 0) return null;

                  return (
                    <div key={category}>
                      {/* Category Header */}
                      <div className="px-4 py-2 bg-muted/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        {category}
                      </div>

                      {/* Commands */}
                      {cmds.map((cmd) => {
                        const filteredIndex = filteredCommandIndexes.get(cmd.id);
                        const isSelected = filteredIndex === selectedIndex;

                        return (
                          <button
                            key={cmd.id}
                            ref={isSelected ? selectedCommandRef : undefined}
                            onClick={() => {
                              void executeCommand(cmd, onClose);
                            }}
                            className={`w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-muted transition-colors ${
                              isSelected ? "bg-muted" : ""
                            }`}
                          >
                            {/* Icon or Thumbnail */}
                            {cmd.thumbnailUrl ? (
                              <img
                                src={cmd.thumbnailUrl}
                                alt={cmd.label}
                                className="w-8 h-8 rounded object-cover border border-border flex-shrink-0"
                              />
                            ) : cmd.icon ? (
                              <div className="w-8 h-8 flex items-center justify-center text-muted-foreground flex-shrink-0">
                                {cmd.icon}
                              </div>
                            ) : null}

                            {/* Label and Description */}
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-foreground">
                                {cmd.label}
                              </div>
                              {cmd.description && (
                                <div className="text-xs text-muted-foreground truncate">
                                  {cmd.description}
                                </div>
                              )}
                            </div>

                            {/* Shortcut */}
                            {cmd.shortcut && (
                              <kbd className="px-2 py-1 bg-muted text-muted-foreground text-xs rounded">
                                {cmd.shortcut}
                              </kbd>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2 border-t border-border bg-muted/30">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-background border border-border rounded">↑↓</kbd>
                  {t("commandPalette.navigate")}
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 bg-background border border-border rounded">↵</kbd>
                  {t("commandPalette.select")}
                </span>
              </div>
              <span>{t("commandPalette.commandsCount", { count: filteredCommands().length })}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Provider for command palette
 */
export interface CommandPaletteProviderProps {
  children: React.ReactNode;
}

export function CommandPaletteProvider({ children }: CommandPaletteProviderProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [commands] = useState<Command[]>([]);

  return (
    <>
      {children}
      <CommandPalette
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        commands={commands}
      />
    </>
  );
}

/**
 * Hook to use command palette
 */
export function useCommandPalette() {
  // This would be used within the CommandPaletteProvider context
  // For now, return empty functions
  return {
    open: () => {},
    close: () => {},
    registerCommands: () => {},
    addCommand: () => {},
    removeCommand: () => {},
  };
}

/**
 * Default commands for Incrementum
 */
export function getDefaultCommands(): Command[] {
  return buildDefaultCommands({ translate: t });
}
