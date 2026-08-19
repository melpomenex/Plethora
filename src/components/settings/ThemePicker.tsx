/**
 * Theme Picker Component
 * Compact, searchable/filterable theme selector with near-instant live preview.
 *
 * The full catalog (172 built-in + custom themes) lives behind a single
 * combobox-style control so the Appearance section stays compact. The active
 * theme is always shown (name + swatch), themes are findable by search and
 * filter (light/dark, animated), and hovering/keyboard-focusing an option
 * live-applies it as a preview that is only committed on an explicit click or
 * Enter.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from '../../contexts/ThemeContext';
import { Theme, ThemeId } from '../../types/theme';
import {
  CaretDown,
  Check,
  Download,
  Eye,
  MagnifyingGlass,
  Palette,
  Sparkle,
  Trash,
  Upload,
  X,
} from "@phosphor-icons/react";
import { invokeCommand } from '../../lib/tauri';
import { ThemeGallery } from './ThemeGallery';
import { builtInThemes as registeredBuiltInThemes } from '../../themes/builtin';
import { useI18n } from '../../lib/i18n';
import { cn } from '../../utils';

type VariantFilter = "all" | "light" | "dark";
type AnimatedFilter = "all" | "animated" | "static";

interface ThemePickerProps {
  onClose?: () => void;
}

/** A compact swatch strip built from a theme's key palette colors. */
function ThemeSwatch({ theme, className }: { theme: Theme; className?: string }) {
  const colors = [
    theme.colors.primary,
    theme.colors.secondary || theme.colors.primary,
    theme.colors.primaryContainer || theme.colors.surfaceVariant || theme.colors.surface,
    theme.colors.background,
    theme.colors.surface,
  ];
  return (
    <div
      className={cn("flex h-6 w-14 shrink-0 overflow-hidden rounded-md border border-border", className)}
      aria-hidden="true"
    >
      {colors.map((color, i) => (
        <div key={i} className="flex-1" style={{ backgroundColor: color }} />
      ))}
    </div>
  );
}

export function ThemePicker({ onClose }: ThemePickerProps) {
  const { t } = useI18n();
  const {
    theme,
    themes,
    setTheme,
    exportTheme,
    importTheme,
    removeCustomTheme,
    previewTheme,
    previewThemeId,
    commitPreview,
  } = useTheme();

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [variantFilter, setVariantFilter] = useState<VariantFilter>("all");
  const [animatedFilter, setAnimatedFilter] = useState<AnimatedFilter>("all");
  const [activeIndex, setActiveIndex] = useState(0);
  const [showGallery, setShowGallery] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const builtinThemeIds = useMemo(
    () => new Set<ThemeId>(registeredBuiltInThemes.map((b) => b.id)),
    []
  );

  // Built-ins first (catalog order), then custom themes, so the library order
  // is preserved and custom themes stay reachable at the end.
  const orderedThemes = useMemo(() => {
    const builtin = themes.filter((th) => builtinThemeIds.has(th.id));
    const custom = themes.filter((th) => !builtinThemeIds.has(th.id));
    return [...builtin, ...custom];
  }, [themes, builtinThemeIds]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orderedThemes.filter((th) => {
      if (variantFilter !== "all" && th.variant !== variantFilter) return false;
      if (animatedFilter === "animated" && !th.effects?.backgroundAnimation) return false;
      if (animatedFilter === "static" && th.effects?.backgroundAnimation) return false;
      if (q && !(th.name.toLowerCase().includes(q) || th.id.toLowerCase().includes(q))) {
        return false;
      }
      return true;
    });
  }, [orderedThemes, search, variantFilter, animatedFilter]);

  const isPreviewing = previewThemeId !== null && previewThemeId !== theme.id;

  const closePanel = () => {
    setOpen(false);
    setSearch("");
    if (previewThemeId !== null) previewTheme(null);
  };

  // Close on outside pointer-down and Escape while the panel is open.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        closePanel();
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Reset keyboard position whenever the list changes or the panel opens.
  useEffect(() => {
    setActiveIndex(0);
  }, [search, variantFilter, animatedFilter, open]);

  // Keep the focused/previewed row in view when navigating by keyboard.
  useEffect(() => {
    if (!open) return;
    const el = rowRefs.current[activeIndex];
    if (el) {
      el.scrollIntoView({ block: "nearest" });
      el.focus({ preventScroll: true });
    }
  }, [activeIndex, open]);

  const commitTheme = (themeId: ThemeId) => {
    setTheme(themeId);
    setOpen(false);
    setSearch("");
  };

  const handleSelectTheme = (themeId: ThemeId) => {
    commitTheme(themeId);
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const target = filtered[activeIndex];
      if (target) commitTheme(target.id);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
    }
  };

  const handleExportTheme = async (themeId: ThemeId) => {
    try {
      const json = exportTheme(themeId);
      const target = themes.find((th) => th.id === themeId);

      const filePath = await invokeCommand<string>('dialog_save_file', {
        defaultPath: `${target?.name || 'theme'}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (filePath) {
        await invokeCommand('write_file', { path: filePath, contents: json });
      }
    } catch (error) {
      console.error('Failed to export theme:', error);
    }
  };

  const handleImportTheme = async () => {
    try {
      const filePath = await invokeCommand<string>('dialog_open_file', {
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });

      if (filePath) {
        const contents = await invokeCommand<string>('read_file', { path: filePath });
        const importedTheme = importTheme(contents);
        setTheme(importedTheme.id);
      }
    } catch (error) {
      console.error('Failed to import theme:', error);
    }
  };

  const handleDeleteCustomTheme = (themeId: ThemeId) => {
    if (confirm(t('theme.deleteCustomConfirm'))) {
      removeCustomTheme(themeId);
    }
  };

  return (
    <div className="theme-picker space-y-4">
      {/* Active theme summary + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ThemeSwatch theme={theme} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{theme.name}</p>
            <p className="text-xs text-muted-foreground">
              {theme.variant}
              {theme.effects?.backgroundAnimation ? ` · ${t('settings.themeAnimated')}` : ""} · {themes.length} {t('theme.themeCount')}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setShowGallery(true)}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-foreground transition-colors hover:bg-muted"
            title={t("theme.viewGallery")}
          >
            <Eye className="h-4 w-4" />
            <span className="text-sm">{t("theme.gallery")}</span>
          </button>
          <button
            onClick={handleImportTheme}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-foreground transition-colors hover:bg-muted"
            title="Import theme"
          >
            <Upload className="h-4 w-4" />
            <span className="text-sm">{t("common.import")}</span>
          </button>
          <button
            onClick={() => handleExportTheme(theme.id)}
            className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-foreground transition-colors hover:bg-muted"
            title="Export current theme"
          >
            <Download className="h-4 w-4" />
            <span className="text-sm">{t("common.export")}</span>
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="rounded-lg bg-primary px-3 py-2 text-primary-foreground transition-opacity hover:opacity-90"
            >
              {t("common.done")}
            </button>
          )}
        </div>
      </div>

      {/* Combobox-style selector */}
      <div ref={rootRef} className="relative w-full">
        <button
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => {
            if (open) {
              closePanel();
            } else {
              setOpen(true);
              requestAnimationFrame(() => searchRef.current?.focus());
            }
          }}
          className={cn(
            "flex w-full min-h-[44px] items-center gap-3 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors",
            open ? "ring-2 ring-primary" : "hover:bg-muted",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          )}
        >
          <ThemeSwatch theme={theme} />
          <span className="truncate text-sm font-medium text-foreground">{theme.name}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
            {t('theme.filterResults', { count: filtered.length })}
          </span>
          <CaretDown
            className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>

        {open && (
          <div className="absolute left-0 right-0 z-30 mt-2 max-h-[min(70vh,420px)] overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            <div className="flex flex-col gap-2 border-b border-border p-3">
              {/* Search */}
              <div className="relative">
                <MagnifyingGlass
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t("theme.searchThemes")}
                  aria-label={t("theme.searchThemes")}
                  className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-8 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="flex overflow-hidden rounded-lg border border-border">
                  {(["all", "light", "dark"] as const).map((variant) => (
                    <button
                      key={variant}
                      type="button"
                      onClick={() => setVariantFilter(variant)}
                      className={cn(
                        "px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                        variantFilter === variant
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-foreground hover:bg-muted"
                      )}
                    >
                      {t(`theme.filter${variant === "all" ? "All" : variant === "light" ? "Light" : "Dark"}`)}
                    </button>
                  ))}
                </div>
                <div className="flex overflow-hidden rounded-lg border border-border">
                  {(["all", "animated", "static"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setAnimatedFilter(mode)}
                      className={cn(
                        "flex items-center gap-1 px-3 py-1.5 text-xs font-medium capitalize transition-colors",
                        animatedFilter === mode
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-foreground hover:bg-muted"
                      )}
                    >
                      {mode === "animated" && <Sparkle className="h-3 w-3" />}
                      {t(`theme.filter${mode === "all" ? "All" : mode === "animated" ? "Animated" : "Static"}`)}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Preview notice */}
            {isPreviewing && (
              <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-sm">
                <Eye className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 truncate">
                  {t("theme.previewing", { name: themes.find((th) => th.id === previewThemeId)?.name ?? "" })}
                </span>
                <button
                  type="button"
                  onClick={commitPreview}
                  className="ml-auto shrink-0 rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
                >
                  {t("theme.clickToApply")}
                </button>
                <button
                  type="button"
                  onClick={() => previewTheme(null)}
                  className="shrink-0 rounded px-2 py-1 text-xs text-muted-foreground underline hover:text-foreground"
                >
                  {t("theme.cancelPreview")}
                </button>
              </div>
            )}

            {/* Theme list */}
            <ul
              ref={listRef}
              role="listbox"
              aria-label={t("theme.builtInThemes")}
              onKeyDown={handleKeyDown}
              className="max-h-[min(52vh,320px)] overflow-y-auto overscroll-contain"
              onMouseLeave={() => previewTheme(null)}
            >
              {filtered.length === 0 ? (
                <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {t("theme.noMatches")}
                </li>
              ) : (
                filtered.map((th, index) => {
                  const isSelected = theme.id === th.id;
                  const isCustom = !builtinThemeIds.has(th.id);
                  return (
                    <li key={th.id} role="option" aria-selected={isSelected}>
                      <button
                        ref={(el) => {
                          rowRefs.current[index] = el;
                        }}
                        type="button"
                        onClick={() => handleSelectTheme(th.id)}
                        onMouseEnter={() => previewTheme(th.id)}
                        onFocus={() => {
                          previewTheme(th.id);
                          setActiveIndex(index);
                        }}
                        onMouseLeave={() => {
                          if (previewThemeId === th.id) previewTheme(null);
                        }}
                        className={cn(
                          "flex w-full min-h-[44px] items-center gap-3 px-3 py-2 text-left transition-colors",
                          "focus:outline-none focus-visible:bg-muted",
                          isSelected ? "bg-primary/10" : "hover:bg-muted"
                        )}
                      >
                        <ThemeSwatch theme={th} className="h-5 w-11" />
                        <span className="min-w-0 truncate text-sm text-foreground">{th.name}</span>
                        <span className="shrink-0 text-xs capitalize text-muted-foreground">{th.variant}</span>
                        {th.effects?.backgroundAnimation && (
                          <span
                            className="flex shrink-0 items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                          >
                            <Sparkle className="h-2.5 w-2.5" />
                            {t('settings.themeAnimated')}
                          </span>
                        )}
                        {isSelected && (
                          <Check className="ml-auto h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        )}
                        {isCustom && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteCustomTheme(th.id);
                            }}
                            title="Delete custom theme"
                            aria-label={`Delete custom theme ${th.name}`}
                            className="ml-auto shrink-0 rounded p-1.5 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                          >
                            <Trash className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
              <span className="text-xs text-muted-foreground">
                {t('theme.filterResults', { count: filtered.length })}
              </span>
              <button
                type="button"
                onClick={() => setShowGallery(true)}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
              >
                <Palette className="h-3.5 w-3.5" />
                {t("theme.browseAll")}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Theme Gallery Modal (secondary "browse all") */}
      {showGallery && (
        <ThemeGallery
          onClose={() => setShowGallery(false)}
          onThemeSelect={(themeId) => {
            setTheme(themeId);
            setShowGallery(false);
          }}
        />
      )}
    </div>
  );
}
