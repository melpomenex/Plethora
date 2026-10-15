/**
 * Six Quick Action tiles (reference row) with real availability states.
 *
 * Tiles are native buttons: focused controls own Enter/Space; grid arrow keys
 * move focus between tiles respecting the rendered column count. Unavailable
 * prerequisites keep the tile visible with an explanatory description and a
 * useful fallback action instead of a dead or misleading control.
 */

import {
  BookOpen,
  ClockCounterClockwise,
  Gear,
  PencilSimple,
  Sparkle,
  Stack,
} from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import type { PaletteActionId, PaletteHomeModel } from "../../../commandPalette/types";
import { PALETTE_QUICK_ACTION_ORDER } from "../../../commandPalette/quickActions";

export interface PaletteQuickActionsProps {
  home: PaletteHomeModel;
  /** Keyboard-highlighted tile index (0–5), or -1 when none. */
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onAction: (id: PaletteActionId) => void;
}

interface TileModel {
  id: PaletteActionId;
  label: string;
  description: string;
  icon: React.ReactNode;
  badge?: string;
  available: boolean;
}

export function PaletteQuickActions({
  home,
  selectedIndex,
  onSelectIndex,
  onAction,
}: PaletteQuickActionsProps) {
  const { t } = useI18n();

  const resumeItem = home.resume.status === "ready" ? home.resume.item : null;
  const resumeLoading = home.resume.status === "loading";
  const recentItem = home.recent.status === "ready" ? home.recent.item : null;
  const dueReady = home.due.status === "ready";
  const dueCount = home.due.dueCount;
  const caughtUp = dueReady && dueCount === 0;

  const tiles: TileModel[] = [
    {
      id: "palette.resume",
      label: t("palette.action.resume"),
      description: resumeLoading
        ? t("palette.action.resumeLoading")
        : resumeItem
          ? t("palette.action.resumeDesc")
          : t("palette.action.resumeUnavailable"),
      icon: <BookOpen className="ch-tile-glyph" aria-hidden="true" />,
      available: Boolean(resumeItem),
    },
    {
      id: "palette.openRecent",
      label: t("palette.action.recent"),
      description: home.recent.status === "loading"
        ? t("palette.action.recentLoading")
        : recentItem
          ? t("palette.action.recentDesc")
          : t("palette.action.recentUnavailable"),
      icon: <ClockCounterClockwise className="ch-tile-glyph" aria-hidden="true" />,
      available: Boolean(recentItem),
    },
    {
      id: "palette.reviewDue",
      label: t("palette.action.review"),
      description: caughtUp
        ? t("palette.action.reviewCaughtUp")
        : t("palette.action.reviewDesc"),
      icon: <Stack className="ch-tile-glyph" aria-hidden="true" />,
      badge: dueReady && dueCount > 0 ? t("palette.dueBadge", { count: dueCount }) : undefined,
      available: dueReady && dueCount > 0,
    },
    {
      id: "palette.askLibrary",
      label: t("palette.action.ask"),
      description: t("qaWorkspace.openDescription"),
      icon: <Sparkle className="ch-tile-glyph" aria-hidden="true" />,
      available: true,
    },
    {
      id: "palette.openSettings",
      label: t("palette.action.settings"),
      description: t("palette.action.settingsDesc"),
      icon: <Gear className="ch-tile-glyph" aria-hidden="true" />,
      available: true,
    },
    {
      id: "palette.createNote",
      label: t("palette.action.note"),
      description: t("palette.action.noteDesc"),
      icon: <PencilSimple className="ch-tile-glyph" aria-hidden="true" />,
      available: true,
    },
  ];

  const orderedTiles = PALETTE_QUICK_ACTION_ORDER.map(
    (id) => tiles.find((tile) => tile.id === id)
  ).filter((tile): tile is TileModel => Boolean(tile));

  const handleTileKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const grid = event.currentTarget.parentElement;
    if (!grid) return;
    const columns =
      getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length || 6;
    const count = orderedTiles.length;
    let next = index;
    if (event.key === "ArrowLeft") next = index - 1;
    else if (event.key === "ArrowRight") next = index + 1;
    else if (event.key === "ArrowUp") next = index - columns;
    else next = index + columns;
    next = Math.max(0, Math.min(count - 1, next));
    const buttons = grid.querySelectorAll<HTMLButtonElement>("[data-quick-tile]");
    buttons[next]?.focus();
    onSelectIndex(next);
  };

  return (
    <section className="ch-section" aria-label={t("palette.quickActions")}>
      <div className="ch-section-head">
        <h3 className="ch-section-title">
          <Sparkle className="ch-section-glyph" weight="fill" aria-hidden="true" />
          {t("palette.quickActions")}
        </h3>
        <button
          type="button"
          className="ch-link"
          onClick={() => onAction("palette.seeAllActions")}
        >
          {t("palette.seeAllActions")}
          <span aria-hidden="true">→</span>
        </button>
      </div>

      <div className="ch-tiles" role="group" aria-label={t("palette.quickActions")}>
        {orderedTiles.map((tile, index) => {
          const selected = index === selectedIndex;
          return (
            <button
              key={tile.id}
              type="button"
              data-quick-tile
              data-tile-index={index}
              data-selected={selected || undefined}
              data-unavailable={!tile.available || undefined}
              className={`ch-tile${selected ? " ch-tile--selected" : ""}${
                tile.available ? "" : " ch-tile--unavailable"
              }`}
              onClick={() => onAction(tile.id)}
              onFocus={() => onSelectIndex(index)}
              onKeyDown={(event) => handleTileKeyDown(event, index)}
            >
              <span className="ch-tile-icon">{tile.icon}</span>
              {tile.badge && <span className="ch-tile-badge">{tile.badge}</span>}
              <span className="ch-tile-title">{tile.label}</span>
              <span className="ch-tile-desc">{tile.description}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
