import { PaperMaterialPreview } from './PaperMaterialPreview';
/**
 * Theme Gallery Component
 * Shows visual previews of themes with mini UI mockups
 */

import React, { useMemo, useRef, useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { Theme, ThemeId } from "../../types/theme";
import {
  ArrowsOutSimple,
  Check,
  DeviceMobile,
  MagnifyingGlass,
  Sparkle,
  X,
} from "@phosphor-icons/react";
import { cn } from "../../utils";
import { builtInThemes as registeredBuiltInThemes } from "../../themes/builtin";
import { useI18n } from "../../lib/i18n";
import { ResponsiveDialogSheet } from "../adaptive/ResponsiveDialogSheet";
import { filterAndRankThemes } from "./themeSearch";

interface ThemeGalleryProps {
  onClose?: () => void;
  onThemeSelect?: (themeId: ThemeId) => void;
}

/**
 * Mini UI mockup showing theme in action
 */
function ThemePreview({ theme }: { theme: Theme }) {
  if(theme.material?.kind === "paper") return <PaperMaterialPreview theme={theme}/>;
  return (
    <div
      className="w-full h-32 rounded-lg overflow-hidden border relative"
      style={{
        backgroundColor: theme.colors.background,
        borderColor: theme.colors.outline,
      }}
    >
      {/* Mini mock header */}
      <div
        className="h-6 flex items-center px-2 gap-1"
        style={{ backgroundColor: theme.colors.surface }}
      >
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: theme.colors.error }}
        />
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: theme.colors.warning }}
        />
        <div
          className="w-2 h-2 rounded-full"
          style={{ backgroundColor: theme.colors.success }}
        />
      </div>

      {/* Mini mock content */}
      <div className="p-2 space-y-1.5">
        {/* Title bar */}
        <div
          className="h-2 rounded w-3/4"
          style={{ backgroundColor: theme.colors.onSurface }}
        />

        {/* Content blocks */}
        <div className="flex gap-1">
          <div
            className="h-8 w-8 rounded"
            style={{ backgroundColor: theme.colors.primaryContainer }}
          />
          <div className="flex-1 space-y-1">
            <div
              className="h-1.5 rounded w-full"
              style={{ backgroundColor: theme.colors.outline }}
            />
            <div
              className="h-1.5 rounded w-2/3"
              style={{ backgroundColor: theme.colors.outlineVariant }}
            />
            <div
              className="h-1.5 rounded w-1/2"
              style={{ backgroundColor: theme.colors.outlineVariant }}
            />
          </div>
        </div>

        {/* Action button */}
        <div
          className="h-4 rounded w-16 text-center text-xs"
          style={{
            backgroundColor: theme.colors.primary,
            color: theme.colors.onPrimary,
          }}
        >
          Action
        </div>
      </div>
    </div>
  );
}

/**
 * Color palette display
 */
function ColorPalette({ theme }: { theme: Theme }) {
  const colors = [
    theme.colors.primary,
    theme.colors.secondary,
    theme.colors.primaryContainer,
    theme.colors.error,
    theme.colors.warning,
    theme.colors.success,
    theme.colors.surface,
    theme.colors.background,
    theme.colors.onPrimary,
    theme.colors.onSurface,
  ];

  return (
    <div className="flex gap-0.5">
      {colors.map((color, i) => (
        <div
          key={i}
          className="flex-1 h-6 rounded-sm first:rounded-l-lg last:rounded-r-lg"
          style={{ backgroundColor: color }}
          title={color}
        />
      ))}
    </div>
  );
}

/**
 * Theme card in gallery
 */
function ThemeGalleryCard({
  theme,
  isSelected,
  onClick,
}: {
  theme: Theme;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative p-3 rounded-lg border-2 transition-all hover:scale-[1.02] hover:shadow-lg",
        isSelected ? "border-primary shadow-lg" : "border-transparent hover:border-outline"
      )}
      style={{
        backgroundColor: theme.colors.surface,
        borderColor: isSelected ? theme.colors.primary : theme.colors.outline,
      }}
    >
      {isSelected && (
        <div
          className="absolute top-2 right-2 p-1 rounded-full shadow-sm"
          style={{ backgroundColor: theme.colors.primary }}
        >
          <Check className="w-3 h-3" style={{ color: theme.colors.onPrimary }} />
        </div>
      )}

      {/* Theme Preview */}
      <ThemePreview theme={theme} />

      {/* Color Palette */}
      <div className="mt-2 rounded-full overflow-hidden">
        <ColorPalette theme={theme} />
      </div>

      {/* Theme Info */}
      <div className="mt-2 text-left">
        <h3
          className="font-semibold text-sm truncate"
          style={{ color: theme.colors.onSurface }}
        >
          {theme.name}
        </h3>
        <div className="flex items-center justify-between mt-0.5">
          <div className="flex items-center gap-1.5">
            <span
              className="text-xs"
              style={{ color: theme.colors.textSecondary }}
            >
              {theme.variant}
            </span>
            {theme.effects?.backgroundAnimation && (
              <span
                className="flex items-center gap-0.5 text-[9px] font-medium px-1 py-px rounded-full"
                style={{
                  background: `${theme.colors.primary}22`,
                  color: theme.colors.primary,
                  border: `1px solid ${theme.colors.primary}33`,
                }}
              >
                <Sparkle className="w-2 h-2" />
                animated
              </span>
            )}
          </div>
          <DeviceMobile
            className="w-3 h-3"
            style={{ color: theme.colors.textSecondary }}
          />
        </div>
      </div>
    </button>
  );
}

/**
 * Full screen gallery modal
 */
export function ThemeGallery({ onClose, onThemeSelect }: ThemeGalleryProps) {
  const { t } = useI18n();
  const { theme, themes, setTheme } = useTheme();
  const [search, setSearch] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleSelectTheme = (themeId: ThemeId) => {
    setTheme(themeId);
    onThemeSelect?.(themeId);
  };

  const orderedThemes = useMemo(() => {
    const allThemeIds: ThemeId[] = registeredBuiltInThemes.map((builtinTheme) => builtinTheme.id);
    const builtinOrder = new Map(allThemeIds.map((id, index) => [id, index]));
    const themeSort = (a: Theme, b: Theme) => {
      const aIndex = builtinOrder.get(a.id as ThemeId);
      const bIndex = builtinOrder.get(b.id as ThemeId);
      const aRank = aIndex ?? Number.MAX_SAFE_INTEGER;
      const bRank = bIndex ?? Number.MAX_SAFE_INTEGER;
      if (aRank !== bRank) return aRank - bRank;
      return a.name.localeCompare(b.name);
    };
    return [...themes].sort(themeSort);
  }, [themes]);

  const isSearching = search.trim().length > 0;
  const matchedThemes = useMemo(
    () => (isSearching ? filterAndRankThemes(orderedThemes, search) : orderedThemes),
    [isSearching, orderedThemes, search],
  );

  // Group themes by variant when browsing without a search query
  const jellyfishThemes = orderedThemes.filter((th) =>
    th.effects?.backgroundAnimation === 'jellyfish' &&
    (th.id === 'deep-ocean-glow' ||
      th.id === 'bioluminescent-flow' ||
      th.id === 'deep-sea-neon' ||
      th.id === 'abyssal-dream'),
  );
  const darkThemes = orderedThemes.filter((th) => th.variant === "dark");
  const lightThemes = orderedThemes.filter((th) => th.variant === "light");

  const visibleCount = isSearching ? matchedThemes.length : themes.length;

  return (
    <ResponsiveDialogSheet
      open
      onClose={() => onClose?.()}
      title={t("settings.themeGalleryTitle")}
      description={t("settings.themeGalleryDesc")}
      initialFocusRef={searchInputRef}
      desktopMaxWidth="72rem"
      subHeader={
        <div
          className="shrink-0 px-6 py-3 border-b"
          style={{ borderColor: theme.colors.outlineVariant ?? theme.colors.outline }}
        >
          <div className="relative">
            <MagnifyingGlass
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
              style={{ color: theme.colors.textSecondary }}
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && search) {
                  e.stopPropagation();
                  setSearch("");
                }
              }}
              placeholder={t("theme.searchThemes")}
              aria-label={t("theme.searchThemes")}
              className="w-full rounded-lg border py-2 pl-9 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              style={{
                backgroundColor: theme.colors.background,
                borderColor: theme.colors.outline,
                color: theme.colors.onSurface,
              }}
            />
            {search && (
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  searchInputRef.current?.focus();
                }}
                aria-label={t("common.clear")}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 transition-colors hover:opacity-80"
                style={{ color: theme.colors.textSecondary }}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      }
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <div className="text-sm" style={{ color: theme.colors.textSecondary }}>
            {t("settings.themeCount", { count: visibleCount })}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg font-medium transition-colors"
            style={{
              backgroundColor: theme.colors.primary,
              color: theme.colors.onPrimary,
            }}
          >
            {t("common.done")}
          </button>
        </div>
      }
    >
      {isSearching ? (
        matchedThemes.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {matchedThemes.map((th) => (
              <ThemeGalleryCard
                key={th.id}
                theme={th}
                isSelected={theme.id === th.id}
                onClick={() => handleSelectTheme(th.id)}
              />
            ))}
          </div>
        ) : (
          <div className="py-12 text-center space-y-3">
            <MagnifyingGlass
              className="w-8 h-8 mx-auto opacity-50"
              style={{ color: theme.colors.textSecondary }}
              aria-hidden="true"
            />
            <p className="text-sm" style={{ color: theme.colors.textSecondary }}>
              {t("theme.filterResults", { count: 0 })}
            </p>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                searchInputRef.current?.focus();
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors"
              style={{
                borderColor: theme.colors.outline,
                color: theme.colors.onSurface,
              }}
            >
              {t("common.clear")}
            </button>
          </div>
        )
      ) : (
        <div className="space-y-6">
          {/* Jellyfish animated family */}
          {jellyfishThemes.length > 0 && (
            <section>
              <h3
                className="text-sm font-semibold mb-3 uppercase tracking-wide flex items-center gap-1.5"
                style={{ color: theme.colors.textSecondary }}
              >
                <Sparkle className="w-3.5 h-3.5" />
                Jellyfish
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {jellyfishThemes.map((t) => (
                  <ThemeGalleryCard
                    key={t.id}
                    theme={t}
                    isSelected={theme.id === t.id}
                    onClick={() => handleSelectTheme(t.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Light Themes */}
          {lightThemes.length > 0 && (
            <section>
              <h3
                className="text-sm font-semibold mb-3 uppercase tracking-wide"
                style={{ color: theme.colors.textSecondary }}
              >
                {t("settings.themeLightThemes")}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {lightThemes.map((t) => (
                  <ThemeGalleryCard
                    key={t.id}
                    theme={t}
                    isSelected={theme.id === t.id}
                    onClick={() => handleSelectTheme(t.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* Dark Themes */}
          {darkThemes.length > 0 && (
            <section>
              <h3
                className="text-sm font-semibold mb-3 uppercase tracking-wide"
                style={{ color: theme.colors.textSecondary }}
              >
                {t("settings.themeDarkThemes")}
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {darkThemes.map((t) => (
                  <ThemeGalleryCard
                    key={t.id}
                    theme={t}
                    isSelected={theme.id === t.id}
                    onClick={() => handleSelectTheme(t.id)}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </ResponsiveDialogSheet>
  );
}

/**
 * Button to open the gallery
 */
export function ThemeGalleryButton({ onSelect }: { onSelect?: (themeId: ThemeId) => void }) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = React.useState(false);
  const { theme } = useTheme();

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors"
        style={{
          color: theme.colors.textSecondary,
          backgroundColor: 'transparent'
        }}
        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.variant === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.05)'}
        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
      >
        <ArrowsOutSimple className="w-4 h-4" />
        <span className="text-sm">{t("settings.themeOpenGallery")}</span>
      </button>

      {isOpen && (
        <ThemeGallery
          onClose={() => setIsOpen(false)}
          onThemeSelect={(themeId) => {
            onSelect?.(themeId);
            setIsOpen(false);
          }}
        />
      )}
    </>
  );
}
