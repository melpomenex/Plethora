/**
 * One authoritative command registry for the command palette (Ctrl/Cmd+K).
 *
 * Every searchable navigation destination and action is declared exactly once
 * here: stable id, localized label/description, icon, category, aliases,
 * keywords, availability gates, and the executable action. Typed search,
 * hub browse (View all), scope filters, and help-intent navigation all derive
 * from this module — no palette surface keeps an independent copy of a
 * destination.
 *
 * Matching is pure, local, synchronous (`matchCommands`), tiered by match
 * quality, and deduplicated by intent (`intentId`). See the change design
 * (`openspec/changes/unify-command-palette-registry/design.md`) for the tier
 * table and rationale.
 */

import {
  Books,
  Bookmarks,
  Brain,
  Broom,
  Camera,
  ChartBar,
  ChatCircleDots,
  Clipboard,
  ClockCounterClockwise,
  Command as CommandIcon,
  Compass,
  Gear,
  Globe,
  Graph,
  Headphones,
  Images,
  ListChecks,
  MagnifyingGlass,
  Microphone,
  Moon,
  Newspaper,
  Notebook,
  Palette,
  Play,
  Plus,
  Rss,
  Scissors,
  ShareNetwork,
  Sparkle,
  SquaresFour,
  Sun,
  Tag,
  TextT,
  XLogo,
} from "@phosphor-icons/react";
import {
  CommandCategory,
  createCommand,
  filterCommandsByPlatformAvailability,
  type Command,
} from "./commandModel";
import { NAVIGATION_DESTINATIONS, type NavigationDestination } from "../navigation/tabDestinations";
import { requestDestinationAction, startPaletteScrollSession } from "./destinationActions";
import { getPaletteSelection } from "./selectionTranslation";
import { useSavedQueueStore } from "../stores/savedQueueStore";
import { useSettingsStore } from "../stores/settingsStore";
import { useUIStore } from "../stores/uiStore";
import { isNativeAndroid, isTauri, isMac, nativePlatform } from "../lib/tauri";
import { fuzzyMatch } from "../utils/fuzzy";
import { useLibraryAskHandoffStore } from "./libraryAskHandoff";
import { translatePaletteSelection } from "./selectionTranslation";
import type { TranslateFn } from "./homeModel";
import {
  SETTINGS_SECTION_METADATA,
  SettingsTab,
} from "../components/settings/settingsSections";
import { isPlethoraCloudAvailable } from "../config/product";
import type { ReactNode } from "react";

/* ------------------------------------------------------------------------- */
/* Match tiers                                                               */
/* ------------------------------------------------------------------------- */

export type CommandMatchTier =
  | "exact-label"
  | "exact-alias"
  | "prefix-label"
  | "prefix-alias"
  | "keyword"
  | "fuzzy"
  | "description";

/**
 * Relevance hierarchy, highest first. Scores are also the palette result
 * scores (tier × 100 in `CommandCenter.handleSearch`), so exact destinations
 * rank above content (≤ 1.0) while weak command matches interleave with it.
 */
export const COMMAND_TIER_SCORES: Record<CommandMatchTier, number> = {
  "exact-label": 1.3,
  "exact-alias": 1.25,
  "prefix-label": 1.12,
  "prefix-alias": 1.1,
  keyword: 0.94,
  fuzzy: 0.9,
  description: 0.85,
};

export interface CommandMatch {
  command: Command;
  tier: CommandMatchTier;
  score: number;
}

/** Normalize a palette query for matching (trim, lowercase, collapse spaces). */
export function normalizeCommandQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Best tier for one query token against one command, or null when no match. */
function tokenTier(command: Command, token: string): CommandMatchTier | null {
  const label = command.label.toLowerCase();
  const aliases = (command.aliases ?? []).map((alias) => alias.toLowerCase());
  const keywords = (command.keywords ?? []).map((keyword) => keyword.toLowerCase());
  const description = (command.description ?? "").toLowerCase();

  if (token === label) return "exact-label";
  if (aliases.includes(token)) return "exact-alias";
  if (label.startsWith(token)) return "prefix-label";
  if (aliases.some((alias) => alias.startsWith(token))) return "prefix-alias";
  if (keywords.some((keyword) => keyword.includes(token))) return "keyword";
  if (token.length >= 3) {
    const fuzzyCandidates = [label, ...aliases];
    const fuzzyHit = fuzzyCandidates.some((candidate) => {
      if (candidate.includes(" ")) return false;
      const result = fuzzyMatch(candidate, token, 2);
      return result.match && result.score >= 0.6;
    });
    if (fuzzyHit) return "fuzzy";
  }
  if (description.includes(token)) return "description";
  return null;
}

/**
 * Score one command against a query.
 *
 * Exact whole-query matches (label, then alias) win immediately. Otherwise
 * every query token must match at least one field (multiword AND semantics)
 * and the entry is scored by its weakest token tier.
 */
export function scoreCommand(command: Command, query: string): CommandMatch | null {
  const normalized = normalizeCommandQuery(query);
  if (!normalized) return null;

  const label = command.label.toLowerCase();
  if (normalized === label) {
    return { command, tier: "exact-label", score: COMMAND_TIER_SCORES["exact-label"] };
  }
  const aliases = (command.aliases ?? []).map((alias) => alias.toLowerCase());
  if (aliases.includes(normalized)) {
    return { command, tier: "exact-alias", score: COMMAND_TIER_SCORES["exact-alias"] };
  }

  const tokens = normalized.split(" ");
  let weakest: CommandMatchTier | null = null;
  for (const token of tokens) {
    const tier = tokenTier(command, token);
    if (!tier) return null;
    if (weakest === null || COMMAND_TIER_SCORES[tier] < COMMAND_TIER_SCORES[weakest]) {
      weakest = tier;
    }
  }
  if (!weakest) return null;
  return { command, tier: weakest, score: COMMAND_TIER_SCORES[weakest] };
}

/**
 * Match and rank commands. Deterministic: score descending, then registry
 * order for ties.
 */
export function matchCommands(commands: Command[], query: string): CommandMatch[] {
  const scored: Array<CommandMatch & { order: number }> = [];
  commands.forEach((command, order) => {
    const match = scoreCommand(command, query);
    if (match) scored.push({ ...match, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map(({ order: _order, ...match }) => match);
}

/** Compatibility adapter: whether the command matches the query at all. */
export function commandMatchesQuery(command: Command, query: string): boolean {
  return scoreCommand(command, query) !== null;
}

/* ------------------------------------------------------------------------- */
/* Navigation destinations                                                   */
/* ------------------------------------------------------------------------- */

/** Palette navigation entry for a canonical destination. */
export function buildDestinationCommand(
  destination: NavigationDestination,
  translate: TranslateFn
): Command {
  return createCommand({
    id: `go-${destination.id}`,
    label: translate(destination.labelKey),
    description: translate(destination.descriptionKey),
    icon: DESTINATION_ICONS[destination.id],
    category: CommandCategory.Navigation,
    action: () => navigateTo(destination.path),
    keywords: destination.keywords,
    aliases: destination.aliases,
    intentId: `destination:${destination.id}`,
    capabilityId: destination.capabilityId,
    // The Settings destination is reachable from both the Settings and
    // Library scopes (like the previous section row); other destinations are
    // library-sized surfaces.
    scopes: destination.id === "settings" ? ["settings", "library"] : ["library"],
  });
}

export function buildDestinationCommands(translate: TranslateFn): Command[] {
  return NAVIGATION_DESTINATIONS.map((destination) =>
    buildDestinationCommand(destination, translate)
  );
}

const DESTINATION_ICONS: Record<string, ReactNode> = {
  dashboard: <SquaresFour className="w-4 h-4" />,
  "continue-reading": <ClockCounterClockwise className="w-4 h-4" />,
  documents: <Books className="w-4 h-4" />,
  queue: <ListChecks className="w-4 h-4" />,
  "scroll-mode": <Play className="w-4 h-4" />,
  review: <Brain className="w-4 h-4" />,
  analytics: <ChartBar className="w-4 h-4" />,
  settings: <Gear className="w-4 h-4" />,
  rss: <Rss className="w-4 h-4" />,
  podcasts: <Microphone className="w-4 h-4" />,
  audiobooks: <Headphones className="w-4 h-4" />,
  newsletters: <Newspaper className="w-4 h-4" />,
  images: <Images className="w-4 h-4" />,
  "knowledge-sphere": <Graph className="w-4 h-4" />,
  "knowledge-network": <ShareNetwork className="w-4 h-4" />,
  "doc-qa": <ChatCircleDots className="w-4 h-4" />,
  notebooklm: <Notebook className="w-4 h-4" />,
  extracts: <Scissors className="w-4 h-4" />,
  "import-needs-review": <Tag className="w-4 h-4" />,
  "web-browser": <Globe className="w-4 h-4" />,
};

/** Dispatch the app's canonical navigate event (resolved by MainLayout). */
export function navigateTo(path: string): void {
  window.dispatchEvent(new CustomEvent("navigate", { detail: path }));
}

/* ------------------------------------------------------------------------- */
/* Registry assembly                                                         */
/* ------------------------------------------------------------------------- */

export interface RegistryDeps {
  translate: TranslateFn;
  theme: { id: string; name: string; variant: "light" | "dark" };
  themes: Array<{ id: string; name: string; variant: "light" | "dark" }>;
  setTheme: (id: string) => void;
  isWeb: boolean;
  /** Title of the document in the active viewer, for the Paste Extract copy. */
  selectedDocumentTitle: string | null;
  /** Override for tests; defaults to the saved-queue store. */
  savedQueues?: Array<{ id: string; name: string }>;
}

export function buildCommandRegistry(deps: RegistryDeps): Command[] {
  return filterCommandsByPlatformAvailability([
    ...buildDestinationCommands(deps.translate),
    ...buildDefaultCommands(deps),
    ...buildThemeCommands(deps),
    ...buildPaletteOwnedCommands(deps),
    ...buildSettingsSectionCommands(deps),
  ]);
}

/**
 * One command per Settings section, delivered through the existing
 * destination-action handoff (opens Settings and selects the section).
 * `account` only exists when Plethora Cloud is publicly available.
 */
function buildSettingsSectionCommands(deps: RegistryDeps): Command[] {
  const { translate: t } = deps;
  const sections = isPlethoraCloudAvailable()
    ? SETTINGS_SECTION_METADATA
    : SETTINGS_SECTION_METADATA.filter((section) => section.id !== SettingsTab.Account);
  return sections.map((section) =>
    createCommand({
      id: `settings-section-${section.id}`,
      intentId: `settings-section:${section.id}`,
      capabilityId: "tab_settings",
      label: t("palette.command.settingsSection", { name: t(section.labelKey) }),
      description: t("palette.command.settingsSectionDesc", { name: t(section.labelKey) }),
      icon: <Gear className="w-4 h-4" />,
      category: CommandCategory.Gear,
      action: () =>
        requestDestinationAction({
          destination: "settings",
          action: "section",
          section: section.id,
        }),
      keywords: ["settings", ...section.keywords],
      aliases: [section.id],
      scopes: ["settings"],
    })
  );
}

/**
 * Default operation commands (ported from the legacy `getDefaultCommands`),
 * preserving today's capability gates and contextual preconditions.
 */
export function buildDefaultCommands(
  deps: Pick<RegistryDeps, "translate" | "savedQueues">
): Command[] {
  const { translate: t, savedQueues } = deps;
  const queues = savedQueues ?? useSavedQueueStore.getState().savedQueues;
  const commands: Command[] = [
    createCommand({
      id: "new-document",
      intentId: "action:import-document",
      capabilityId: "core_import",
      label: t("commandPalette.importDocument"),
      description: t("commandPalette.importDocumentDesc"),
      icon: <Plus className="w-4 h-4" />,
      category: CommandCategory.Documents,
      action: () => requestDestinationAction({ destination: "documents", action: "import" }),
      keywords: ["create", "add", "import", "file", "pdf", "epub"],
      aliases: ["import document", "add document", "upload"],
      shortcut: "⌘N",
    }),
    createCommand({
      id: "scan-document",
      intentId: "action:scan-document",
      capabilityId: "import_document_scan",
      label: t("commandPalette.scanDocument"),
      description: t("commandPalette.scanDocumentDesc"),
      icon: <Camera className="w-4 h-4" />,
      category: CommandCategory.Documents,
      action: async () => {
        if (isNativeAndroid()) {
          const { scanDocumentIntoLibrary } = await import("../lib/ai/android/visionProvider");
          await scanDocumentIntoLibrary();
        } else {
          const { importAppleDocumentScan } = await import("../lib/ai/apple/importVisionDocument");
          await importAppleDocumentScan();
        }
      },
      keywords: ["scan", "camera", "ocr", "document"],
    }),
    createCommand({
      id: "ask-my-library",
      intentId: "action:ask-library",
      label: t("aiLibrary.askLibrary"),
      description: t("commandPalette.askLibraryDesc"),
      icon: <MagnifyingGlass className="w-4 h-4" />,
      category: CommandCategory.Documents,
      action: () => {
        useLibraryAskHandoffStore.getState().requestOpen();
        navigateTo("/doc-qa");
      },
      keywords: ["ask", "library", "rag", "search"],
      aliases: ["ask my library", "chat with library"],
    }),
    createCommand({
      id: "record-lecture",
      intentId: "action:record-lecture",
      label: t("commandPalette.recordLecture"),
      description: t("commandPalette.recordLectureDesc"),
      icon: <Microphone className="w-4 h-4" />,
      category: CommandCategory.Documents,
      action: () => {
        if (isTauri() && (isMac() || nativePlatform() === "ios")) {
          window.dispatchEvent(new CustomEvent("record-lecture"));
        } else {
          useUIStore.getState().setLectureCaptureRequested(true);
        }
      },
      keywords: ["record", "lecture", "speech", "transcribe"],
      aliases: ["lecture capture", "record audio"],
    }),
    createCommand({
      id: "translate-selection",
      intentId: "action:translate-selection",
      label: t("commandPalette.translateSelection"),
      description: t("commandPalette.translateSelectionDesc"),
      icon: <TextT className="w-4 h-4" />,
      category: CommandCategory.Documents,
      action: () => translatePaletteSelection(),
      keywords: ["translate", "language", "mlkit"],
    }),
    createCommand({
      id: "tag-untagged-documents",
      intentId: "action:smart-tag-untagged",
      label: "Smart Tag Untagged Documents",
      description: "Run Smart Tagging on library documents with no tags",
      icon: <Sparkle className="w-4 h-4" />,
      category: CommandCategory.Documents,
      action: async () => {
        const { useDocumentStore } = await import("../stores/documentStore");
        const { useSmartTaggingQueueStore } = await import("../stores/smartTaggingQueueStore");
        const { useToastStore, ToastType } = await import("../components/common/Toast");

        const allDocs = useDocumentStore.getState().documents;
        const untagged = allDocs.filter((d) => !d.tags || d.tags.length === 0);
        if (untagged.length === 0) {
          useToastStore.getState().addToast({
            type: ToastType.Info,
            title: "Smart Tagging",
            message: "All library documents already have tags",
          });
          return;
        }

        useSmartTaggingQueueStore.getState().enqueueBatch(untagged.map((d) => d.id), { forceRetag: true });
        useToastStore.getState().addToast({
          type: ToastType.Success,
          title: "Smart Tagging",
          message: `Enqueued ${untagged.length} untagged document${untagged.length !== 1 ? "s" : ""} for tagging`,
        });
      },
      keywords: ["smart", "tag", "untagged", "auto", "batch", "classify"],
    }),
    createCommand({
      id: "cleanup-legacy-auto-tags",
      intentId: "action:cleanup-legacy-tags",
      label: "Clean Up Legacy Auto-Tags",
      description: "Remove legacy 'auto-tagged' marker and faulty static substring tags",
      icon: <Broom className="w-4 h-4" />,
      category: CommandCategory.Documents,
      action: async () => {
        const { useDocumentStore } = await import("../stores/documentStore");
        const { updateDocument } = await import("../api/documents");
        const { publishItemTagsUpdated } = await import("../lib/tagEditing/itemTagEvents");
        const { useToastStore, ToastType } = await import("../components/common/Toast");

        const allDocs = useDocumentStore.getState().documents;
        const legacyStaticTags = new Set([
          "auto-tagged",
          "programming",
          "research",
          "notes",
          "science",
          "history",
          "language",
          "math",
          "economics",
          "biology",
          "physics",
          "philosophy",
        ]);

        let cleanedDocsCount = 0;
        let removedTagsCount = 0;
        let failedDocsCount = 0;

        for (const doc of allDocs) {
          if (!doc.tags || doc.tags.length === 0) continue;
          const details = doc.metadata?.smartTagDetails || [];
          let removedForDoc = 0;
          // Keep tags that have explicit smart or manual provenance
          const filteredTags = doc.tags.filter((tag) => {
            if (tag === "auto-tagged") {
              removedForDoc++;
              return false;
            }
            const hasProvenance = details.some((d) => d.tag.toLowerCase() === tag.toLowerCase());
            if (!hasProvenance && legacyStaticTags.has(tag.toLowerCase())) {
              // Legacy tag with no provenance attached
              removedForDoc++;
              return false;
            }
            return true;
          });

          if (filteredTags.length !== doc.tags.length) {
            const updatedDoc = { ...doc, tags: filteredTags };
            try {
              await updateDocument(doc.id, updatedDoc);
              cleanedDocsCount++;
              removedTagsCount += removedForDoc;
              publishItemTagsUpdated({ itemType: "document", id: doc.id, tags: filteredTags });
            } catch (e) {
              failedDocsCount++;
              console.warn(`[CleanupLegacyTags] Failed to update doc ${doc.id}:`, e);
            }
          }
        }

        await useDocumentStore.getState().loadDocuments();
        if (failedDocsCount) throw new Error(t("commandPalette.cleanupFailed", { count: failedDocsCount }));

        useToastStore.getState().addToast({
          type: ToastType.Success,
          title: "Tag Cleanup Complete",
          message: `Removed ${removedTagsCount} legacy tag${removedTagsCount !== 1 ? "s" : ""} across ${cleanedDocsCount} document${cleanedDocsCount !== 1 ? "s" : ""}`,
        });
      },
      keywords: ["cleanup", "clean", "legacy", "auto-tagged", "tags", "fix"],
    }),
    createCommand({
      id: "new-flashcard",
      intentId: "action:new-flashcard",
      capabilityId: "core_remember",
      label: t("commandPalette.createFlashcard"),
      description: t("commandPalette.createFlashcardDesc"),
      icon: <Plus className="w-4 h-4" />,
      category: CommandCategory.Flashcards,
      action: () => requestDestinationAction({ destination: "review", action: "create-card" }),
      keywords: ["create", "add", "new", "flashcard", "card", "studio"],
      aliases: ["flashcard", "new flashcard", "create flashcard", "add card"],
      shortcut: typeof window !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0 ? "⌘⌥F" : "Ctrl+Alt+F",
    }),
    createCommand({
      id: "manage-saved-queues",
      intentId: "action:manage-queues",
      capabilityId: "tab_queue",
      label: t("savedQueues.manageQueues") || "Manage Queues...",
      description: "Manage, rename, or delete saved queues",
      icon: <Bookmarks className="w-4 h-4 text-primary" />,
      category: CommandCategory.Review,
      action: () => requestDestinationAction({ destination: "queue", action: "manage" }),
      keywords: ["saved", "queue", "manage", "filter"],
    }),
    createCommand({
      id: "new-saved-queue",
      intentId: "action:new-queue",
      capabilityId: "tab_queue",
      label: t("savedQueues.newQueue") || "New Queue...",
      description: "Create a new saved queue with custom filters",
      icon: <Plus className="w-4 h-4" />,
      category: CommandCategory.Review,
      action: () => requestDestinationAction({ destination: "queue", action: "new" }),
      keywords: ["saved", "queue", "new", "create"],
    }),
    ...queues.map((sq) =>
      createCommand({
        id: `switch-queue-${sq.id}`,
        intentId: `action:switch-queue:${sq.id}`,
        capabilityId: "tab_queue",
        label: `${t("savedQueues.title") || "Saved Queue"}: ${sq.name}`,
        description: `Switch active queue to "${sq.name}"`,
        icon: <Bookmarks className="w-4 h-4 text-primary" />,
        category: CommandCategory.Review,
        action: async () => {
          await requestDestinationAction({ destination: "queue", action: "select", queueId: sq.id });
        },
        keywords: ["queue", "saved", sq.name.toLowerCase()],
        aliases: [sq.name.toLowerCase()],
      })
    ),
    createCommand({
      id: "start-scroll-session",
      intentId: "action:start-scroll-session",
      capabilityId: "core_read",
      label: t("commandPalette.startOptimalSession"),
      description: t("commandPalette.startOptimalSessionDesc"),
      icon: <Play className="w-4 h-4" />,
      category: CommandCategory.Review,
      action: startPaletteScrollSession,
      keywords: ["start", "session", "optimal", "queue", "scroll", "reading", "study", "learn", "tiktok"],
      aliases: ["optimal session", "scroll session", "study session"],
    }),
    createCommand({
      id: "keyboard-shortcuts",
      intentId: "action:keyboard-shortcuts",
      label: t("commandPalette.keyboardShortcuts"),
      description: t("commandPalette.viewAllShortcuts"),
      icon: <CommandIcon className="w-4 h-4" />,
      category: CommandCategory.General,
      action: () => {
        window.dispatchEvent(new CustomEvent("show-shortcuts-help"));
      },
      keywords: ["keyboard", "shortcuts", "hotkeys", "help"],
      shortcut: "?",
    }),
  ];

  const libraryRag = useSettingsStore.getState().settings.features.aiLibraryRag;
  return commands
    .filter((cmd) => libraryRag || cmd.id !== "ask-my-library")
    .filter((cmd) => cmd.id !== "translate-selection" || Boolean(getPaletteSelection()))
    .filter((cmd) => cmd.id !== "record-lecture" || typeof MediaRecorder !== "undefined" || (isTauri() && (isMac() || nativePlatform() === "ios")))
    .filter((cmd) => cmd.id !== "scan-document" || isNativeAndroid() || (isTauri() && (isMac() || nativePlatform() === "ios")));
}

/** Theme commands derived from the active theme state. */
function buildThemeCommands(deps: RegistryDeps): Command[] {
  const { translate: t, theme, themes, setTheme } = deps;

  const cycleTheme = (direction: 1 | -1) => {
    if (!themes.length) return;
    const currentIndex = themes.findIndex((item) => item.id === theme.id);
    const startIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (startIndex + direction + themes.length) % themes.length;
    setTheme(themes[nextIndex].id);
  };

  const switchThemeVariant = (variant: "light" | "dark") => {
    if (!themes.length) return;
    const variantThemes = themes.filter((item) => item.variant === variant);
    if (variantThemes.length === 0) return;
    const activeVariantIndex = variantThemes.findIndex((item) => item.id === theme.id);
    const next =
      variantThemes[(activeVariantIndex + 1 + variantThemes.length) % variantThemes.length];
    setTheme(next.id);
  };

  return [
    createCommand({
      id: "theme-toggle-variant",
      intentId: "theme:toggle-variant",
      label: t("palette.command.toggleThemeVariant"),
      description: t("palette.command.toggleThemeVariantDesc", { variant: theme.variant }),
      icon: <Palette className="w-4 h-4" />,
      category: CommandCategory.Gear,
      action: () => {
        const targetVariant = theme.variant === "dark" ? "light" : "dark";
        switchThemeVariant(targetVariant);
      },
      keywords: ["theme", "appearance", "dark", "light", "mode", "toggle"],
      aliases: ["toggle theme", "toggle dark mode", "dark mode toggle"],
      scopes: ["settings"],
    }),
    createCommand({
      id: "theme-set-light",
      intentId: "theme:set-light",
      label: t("palette.command.switchLight"),
      description: t("palette.command.switchLightDesc"),
      icon: <Sun className="w-4 h-4" />,
      category: CommandCategory.Gear,
      action: () => switchThemeVariant("light"),
      keywords: ["theme", "appearance", "light", "day", "mode"],
      aliases: ["light mode", "day mode"],
      scopes: ["settings"],
    }),
    createCommand({
      id: "theme-set-dark",
      intentId: "theme:set-dark",
      label: t("palette.command.switchDark"),
      description: t("palette.command.switchDarkDesc"),
      icon: <Moon className="w-4 h-4" />,
      category: CommandCategory.Gear,
      action: () => switchThemeVariant("dark"),
      keywords: ["theme", "appearance", "dark", "night", "mode"],
      aliases: ["dark mode", "night mode"],
      scopes: ["settings"],
    }),
    createCommand({
      id: "theme-next",
      intentId: "theme:next",
      label: t("palette.command.nextTheme"),
      description: t("palette.command.nextThemeDesc", { name: theme.name }),
      icon: <Palette className="w-4 h-4" />,
      category: CommandCategory.Gear,
      action: () => cycleTheme(1),
      keywords: ["theme", "appearance", "next", "cycle"],
      scopes: ["settings"],
    }),
    createCommand({
      id: "theme-previous",
      intentId: "theme:previous",
      label: t("palette.command.previousTheme"),
      description: t("palette.command.previousThemeDesc", { name: theme.name }),
      icon: <Palette className="w-4 h-4" />,
      category: CommandCategory.Gear,
      action: () => cycleTheme(-1),
      keywords: ["theme", "appearance", "previous", "cycle"],
      scopes: ["settings"],
    }),
    ...themes.map((item) =>
      createCommand({
        id: `theme-switch-${item.id}`,
        intentId: `theme:switch:${item.id}`,
        label: t("palette.command.switchTheme", { name: item.name }),
        description: t("palette.command.switchThemeDesc", { variant: item.variant, name: item.name }),
        icon: <Palette className="w-4 h-4" />,
        category: CommandCategory.Gear,
        action: () => setTheme(item.id),
        keywords: [
          "theme",
          "appearance",
          "switch",
          "set",
          item.name.toLowerCase(),
          item.id.toLowerCase(),
          item.variant.toLowerCase(),
        ],
        aliases: [item.name.toLowerCase(), item.id.toLowerCase()],
        scopes: ["settings"],
      })
    ),
  ];
}

/** Palette-owned commands that are neither registry defaults nor navigation. */
function buildPaletteOwnedCommands(deps: RegistryDeps): Command[] {
  const { translate: t, isWeb, selectedDocumentTitle } = deps;
  return [
    createCommand({
      id: "paste-extract",
      intentId: "action:paste-extract",
      capabilityId: "core_extract",
      label: t("palette.command.pasteExtract"),
      description: selectedDocumentTitle
        ? t("palette.command.pasteExtractDocDesc", { title: selectedDocumentTitle })
        : t("palette.command.pasteExtractDesc"),
      icon: <Clipboard className="w-4 h-4" />,
      category: CommandCategory.Extracts,
      action: () => {
        const ui = useUIStore.getState();
        ui.setCommandPaletteOpen(false);
        ui.setPasteExtractDialogOpen(true);
      },
      keywords: ["clipboard", "paste", "save", "new", "extract", "import"],
      aliases: ["new extract", "create extract", "save selection"],
    }),
    ...(isWeb
      ? []
      : [
          createCommand({
            id: "import-twitter-video",
            intentId: "action:import-twitter-video",
            label: t("commandPalette.importTwitterVideo"),
            description: t("palette.command.importTwitterDesc"),
            icon: <XLogo className="w-4 h-4" />,
            category: CommandCategory.Documents,
            action: () => {
              const ui = useUIStore.getState();
              ui.setCommandPaletteOpen(false);
              ui.setTwitterImportDialogOpen(true);
            },
            keywords: ["twitter", "x.com", "tweet", "video", "import", "download"],
            aliases: ["import tweet", "x thread"],
          }),
        ]),
    createCommand({
      id: "start-guided-tour",
      intentId: "action:start-guided-tour",
      label: t("onboarding.tour.command"),
      description: t("onboarding.tour.replayTour"),
      icon: <Compass className="w-4 h-4" />,
      category: CommandCategory.General,
      action: () => {
        useUIStore.getState().setCommandPaletteOpen(false);
        window.dispatchEvent(new CustomEvent("tour-replay"));
      },
      keywords: ["tour", "onboarding", "guide", "tutorial", "help", "replay"],
      aliases: ["onboarding", "walkthrough"],
    }),
    createCommand({
      id: "refresh-rss-feeds",
      intentId: "action:refresh-rss-feeds",
      capabilityId: "tab_rss",
      label: t("palette.command.refreshRssFeeds"),
      description: t("palette.command.refreshRssFeedsDesc"),
      icon: <Rss className="w-4 h-4" />,
      category: CommandCategory.Documents,
      action: () => requestDestinationAction({ destination: "rss", action: "refresh" }),
      keywords: ["rss", "feeds", "refresh", "sync", "update", "news"],
      aliases: ["refresh feeds", "sync feeds", "update feeds"],
      suppressedByContextual: ["rss.refreshFeed"],
    }),
  ];
}

/* ------------------------------------------------------------------------- */
/* Capability lint allowlist                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Registry entries that are platform-neutral mechanics (no native bridge) and
 * therefore intentionally ungated. Reviewed rationale required for each id;
 * `REGISTRY_COMMAND_EXCEPTION_PREFIXES` covers generated families.
 */
export const REGISTRY_COMMAND_EXCEPTIONS: Record<string, string> = {
  "tag-untagged-documents": "Local smart-tagging; works on every platform.",
  "cleanup-legacy-auto-tags": "Local tag cleanup; works on every platform.",
  "keyboard-shortcuts": "Help overlay; platform-neutral.",
  "start-guided-tour": "Onboarding tour; platform-neutral.",
  "paste-extract": "Gated via capabilityId core_extract.",
  "ask-my-library": "Feature-flag gated (settings.features.aiLibraryRag); dispatches to the platform-neutral Document Q&A surface.",
  "translate-selection": "Ungated-with-rationale: the palette action only dispatches a DOM event; no native bridge is called from the command itself.",
  "record-lecture": "Ungated-with-rationale: dispatches a DOM event consumed by LectureCaptureHost (MainLayout), which uses standard web media APIs; the Android speech provider degrades to the configured transcription provider off-Android.",
  "import-twitter-video": "Ungated-with-rationale: uses the Rust backend, which ships on iOS too (audit §Command palette).",
  "go-import-needs-review": "Needs-review queue surface; reachable on every platform.",
  "go-web-browser": "In-app webview surface; platform-neutral.",
};

/**
 * Generated command families that are platform-neutral by construction.
 * Theme switching is pure UI state and never touches a native bridge.
 */
export const REGISTRY_COMMAND_EXCEPTION_PREFIXES = ["theme-", "switch-queue-"];

export function isRegistryCommandException(id: string): boolean {
  if (REGISTRY_COMMAND_EXCEPTIONS[id]) return true;
  return REGISTRY_COMMAND_EXCEPTION_PREFIXES.some((prefix) => id.startsWith(prefix));
}
