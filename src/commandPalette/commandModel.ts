import type React from "react";
import {
  isPlatformCapabilityAvailable,
  type PlatformCapabilityId,
} from "../lib/platformCapabilities";
import type { ViewActionId } from "./contextualActions";
import type { PaletteScope } from "./types";

/**
 * Command model shared by the command palette, the unified registry, and the
 * global search hub.
 *
 * Lives in a leaf module (no component imports) so `commandPalette/registry`
 * can build and match commands without importing `components/common/CommandPalette`.
 */

/**
 * Command definition.
 */
export interface Command {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  category: CommandCategory;
  action: () => void | Promise<void>;
  keywords?: string[];
  shortcut?: string;
  /** Optional visual thumbnail for figures/diagrams/media. */
  thumbnailUrl?: string;
  /**
   * §3.3: platform capability governing this command. Commands whose
   * capability is unavailable on the current platform are filtered out of
   * the palette. Undefined ⇒ ungated (available everywhere).
   */
  capabilityId?: PlatformCapabilityId;
  /**
   * Additional match aliases (never duplicated across destinations). Matched
   * case-insensitively by the shared command matcher.
   */
  aliases?: string[];
  /**
   * Stable identity of the user intent this command serves. One registry
   * entry per intent; used for dedupe assertions and diagnostics.
   */
  intentId?: string;
  /**
   * Contextual action ids that supersede this command while their target view
   * is active (for example `rss.refreshFeed` suppresses the global
   * Refresh RSS Feeds command).
   */
  suppressedByContextual?: ViewActionId[];
  /**
   * Palette scopes this command belongs to. Undefined keeps the legacy
   * category-based classification (`commandScopes` in `facets.ts`).
   */
  scopes?: PaletteScope[];
}

/**
 * Command categories.
 */
export enum CommandCategory {
  General = "General",
  Documents = "Documents",
  Extracts = "Extracts",
  Flashcards = "Flashcards",
  Review = "Review",
  Gear = "Settings",
  Navigation = "Navigation",
}

/**
 * §3.3: drop commands whose platform capability is unavailable on the
 * current platform. Ungated commands pass through unchanged.
 */
export function filterCommandsByPlatformAvailability<T extends Command>(
  commands: T[]
): T[] {
  return commands.filter(
    (cmd) => !cmd.capabilityId || isPlatformCapabilityAvailable(cmd.capabilityId)
  );
}

/**
 * Helper to create standard commands.
 */
export function createCommand(config: {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
  category: CommandCategory;
  action: () => void | Promise<void>;
  keywords?: string[];
  shortcut?: string;
  thumbnailUrl?: string;
  capabilityId?: PlatformCapabilityId;
  aliases?: string[];
  intentId?: string;
  suppressedByContextual?: ViewActionId[];
  scopes?: PaletteScope[];
}): Command {
  return {
    id: config.id,
    label: config.label,
    description: config.description,
    icon: config.icon,
    category: config.category,
    action: config.action,
    keywords: config.keywords,
    shortcut: config.shortcut,
    thumbnailUrl: config.thumbnailUrl,
    capabilityId: config.capabilityId,
    aliases: config.aliases,
    intentId: config.intentId,
    suppressedByContextual: config.suppressedByContextual,
    scopes: config.scopes,
  };
}
