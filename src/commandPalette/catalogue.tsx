import { startPaletteScrollSession } from "./destinationActions";
/**
 * One command/navigation catalogue for the palette (revamp-command-palette).
 *
 * Previously the available-commands list was built *inside* `CommandCenter`'s
 * term-dependent `handleSearch`, so an empty query could not reach it. This
 * module assembles the same set once — registry defaults (platform-gated),
 * navigation destinations, theme commands, and a few palette-owned commands —
 * with registry duplicates removed. The term search and the hub's
 * Actions/View all browsing both consume this single catalogue.
 */

import {
  Books,
  Brain,
  ChartBar,
  Clipboard,
  Compass,
  Gear,
  Images,
  ListChecks,
  Moon,
  Palette,
  Play,
  SquaresFour,
  Sun,
  XLogo,
} from "@phosphor-icons/react";
import {
  CommandCategory,
  filterCommandsByPlatformAvailability,
  getDefaultCommands,
  type Command,
} from "../components/common/CommandPalette";
import { useUIStore } from "../stores/uiStore";
import type { TranslateFn } from "./homeModel";

/**
 * Registry command ids intentionally replaced by richer navigation commands
 * below (same destinations, palette-owned icons/keywords). Keeping them here
 * documents *why* they are filtered, so extracting the catalogue does not
 * duplicate registry actions.
 */
export const REPLACED_REGISTRY_COMMAND_IDS = [
  "translate-selection",
  "go-documents",
  "go-queue",
  "go-analytics",
  "go-image-registry",
  "open-settings",
  "start-review",
  "start-optimal-session",
] as const;

export interface CatalogueDeps {
  translate: TranslateFn;
  theme: { id: string; name: string; variant: "light" | "dark" };
  themes: Array<{ id: string; name: string; variant: "light" | "dark" }>;
  setTheme: (id: string) => void;
  isWeb: boolean;
  /** Title of the document in the active viewer, for the Paste Extract copy. */
  selectedDocumentTitle: string | null;
}

export function navigateTo(path: string): void {
  window.dispatchEvent(new CustomEvent("navigate", { detail: path }));
}

/**
 * The palette's global command catalogue: every available command and
 * navigation destination, platform-gated, without duplicated registry actions.
 */
export function buildCommandCatalogue(deps: CatalogueDeps): Command[] {
  const { translate: t, theme, themes, setTheme, isWeb, selectedDocumentTitle } = deps;

  const navigationCommands: Command[] = [
    {
      id: "nav-dashboard",
      label: t("palette.command.goDashboard"),
      description: t("palette.command.goDashboardDesc"),
      icon: <SquaresFour className="w-4 h-4" />,
      category: CommandCategory.Navigation,
      action: () => navigateTo("/dashboard"),
      keywords: ["home", "main"],
    },
    {
      id: "nav-documents",
      label: t("palette.command.goDocuments"),
      description: t("palette.command.goDocumentsDesc"),
      icon: <Books className="w-4 h-4" />,
      category: CommandCategory.Navigation,
      action: () => navigateTo("/documents"),
      keywords: ["library", "files"],
    },
    {
      id: "nav-queue",
      label: t("palette.command.goQueue"),
      description: t("palette.command.goQueueDesc"),
      icon: <ListChecks className="w-4 h-4" />,
      category: CommandCategory.Navigation,
      action: () => navigateTo("/queue"),
      keywords: ["list", "reading"],
    },
    {
      id: "nav-analytics",
      label: t("palette.command.goStatistics"),
      description: t("palette.command.goStatisticsDesc"),
      icon: <ChartBar className="w-4 h-4" />,
      category: CommandCategory.Navigation,
      action: () => navigateTo("/analytics"),
      keywords: ["stats", "progress"],
    },
    {
      id: "nav-settings",
      label: t("palette.command.goSettings"),
      description: t("palette.command.goSettingsDesc"),
      icon: <Gear className="w-4 h-4" />,
      category: CommandCategory.Navigation,
      action: () => navigateTo("/settings"),
      keywords: ["config", "preferences"],
    },
    {
      id: "nav-review",
      label: t("palette.command.startReview"),
      description: t("palette.command.startReviewDesc"),
      icon: <Brain className="w-4 h-4" />,
      category: CommandCategory.Navigation,
      action: () => navigateTo("/review"),
      keywords: ["review", "study"],
    },
    {
      id: "nav-image-registry",
      label: t("palette.command.imageRegistry"),
      description: t("palette.command.imageRegistryDesc"),
      icon: <Images className="w-4 h-4" />,
      category: CommandCategory.Navigation,
      action: () => navigateTo("/image-registry"),
      keywords: ["images", "screenshots", "registry", "library", "flashcards"],
    },
    {
      id: "nav-optimal-queue",
      label: t("commandPalette.startOptimalSession"),
      description: t("commandPalette.startOptimalSessionDesc"),
      icon: <Play className="w-4 h-4" />,
      category: CommandCategory.Navigation,
      action: startPaletteScrollSession,
      keywords: ["start", "session", "optimal", "queue", "scroll", "reading", "study", "learn", "tiktok"],
    },
  ];

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

  const themeCommands: Command[] = [
    {
      id: "theme-toggle-variant",
      label: t("palette.command.toggleThemeVariant"),
      description: t("palette.command.toggleThemeVariantDesc", { variant: theme.variant }),
      icon: <Palette className="w-4 h-4" />,
      category: CommandCategory.Gear,
      action: () => {
        const targetVariant = theme.variant === "dark" ? "light" : "dark";
        switchThemeVariant(targetVariant);
      },
      keywords: ["theme", "appearance", "dark", "light", "mode", "toggle"],
    },
    {
      id: "theme-set-light",
      label: t("palette.command.switchLight"),
      description: t("palette.command.switchLightDesc"),
      icon: <Sun className="w-4 h-4" />,
      category: CommandCategory.Gear,
      action: () => switchThemeVariant("light"),
      keywords: ["theme", "appearance", "light", "day"],
    },
    {
      id: "theme-set-dark",
      label: t("palette.command.switchDark"),
      description: t("palette.command.switchDarkDesc"),
      icon: <Moon className="w-4 h-4" />,
      category: CommandCategory.Gear,
      action: () => switchThemeVariant("dark"),
      keywords: ["theme", "appearance", "dark", "night"],
    },
    {
      id: "theme-next",
      label: t("palette.command.nextTheme"),
      description: t("palette.command.nextThemeDesc", { name: theme.name }),
      icon: <Palette className="w-4 h-4" />,
      category: CommandCategory.Gear,
      action: () => cycleTheme(1),
      keywords: ["theme", "appearance", "next", "cycle"],
    },
    {
      id: "theme-previous",
      label: t("palette.command.previousTheme"),
      description: t("palette.command.previousThemeDesc", { name: theme.name }),
      icon: <Palette className="w-4 h-4" />,
      category: CommandCategory.Gear,
      action: () => cycleTheme(-1),
      keywords: ["theme", "appearance", "previous", "cycle"],
    },
  ];

  const themeSwitchCommands: Command[] = themes.map((item) => ({
    id: `theme-switch-${item.id}`,
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
  }));

  return filterCommandsByPlatformAvailability([
    ...getDefaultCommands().filter(
      (cmd) => !(REPLACED_REGISTRY_COMMAND_IDS as readonly string[]).includes(cmd.id)
    ),
    {
      id: "paste-extract",
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
      shortcut: undefined,
    },
    ...(isWeb
      ? []
      : ([
          {
            id: "import-twitter-video",
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
            shortcut: undefined,
          } as Command,
        ] as Command[])),
    ...navigationCommands,
    ...themeCommands,
    ...themeSwitchCommands,
    {
      id: "start-guided-tour",
      label: t("onboarding.tour.command"),
      description: t("onboarding.tour.replayTour"),
      icon: <Compass className="w-4 h-4" />,
      category: CommandCategory.General,
      action: () => {
        useUIStore.getState().setCommandPaletteOpen(false);
        window.dispatchEvent(new CustomEvent("tour-replay"));
      },
      keywords: ["tour", "onboarding", "guide", "tutorial", "help", "replay"],
      shortcut: undefined,
    } as Command,
  ]);
}

/** Case-insensitive match of a typed query against a command. */
export function commandMatchesQuery(cmd: Command, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const label = cmd.label.toLowerCase();
  const description = cmd.description?.toLowerCase() ?? "";
  const keywords = cmd.keywords?.map((keyword) => keyword.toLowerCase()) ?? [];
  return (
    label.includes(q) ||
    description.includes(q) ||
    keywords.some((keyword) => keyword.includes(q))
  );
}
