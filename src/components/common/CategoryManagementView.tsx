/**
 * CategoryManagementView
 *
 * Create / rename / delete categories (name-identity model) with the same
 * affordances as tag management (`TagManagementView`): search, inline rename,
 * inline delete confirmation. Rendered as a self-contained overlay so it works
 * on mobile and desktop and uses theme tokens throughout.
 */

import { useEffect, useState } from "react";
import {
  CircleNotch,
  FolderOpen,
  MagnifyingGlass,
  Pencil,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { useCategoriesStore } from "../../stores/categoriesStore";

interface CategoryManagementViewProps {
  open: boolean;
  onClose: () => void;
}

export function CategoryManagementView({ open, onClose }: CategoryManagementViewProps) {
  const { t } = useI18n();
  const { categories, isLoading, error, loadCategories, create, rename, remove } =
    useCategoriesStore();
  const [searchQuery, setSearchQuery] = useState("");
  const [createValue, setCreateValue] = useState("");
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      void loadCategories();
      setSearchQuery("");
      setCreateValue("");
      setRenamingName(null);
      setConfirmDelete(null);
      setLocalError(null);
    }
  }, [open, loadCategories]);

  if (!open) return null;

  const filtered = searchQuery
    ? categories.filter((c) => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : categories;

  const handleCreate = async () => {
    const name = createValue.trim();
    if (!name) {
      setLocalError(t("categoryManagement.emptyName"));
      return;
    }
    setLocalError(null);
    setCreateValue("");
    await create(name);
  };

  const handleRename = async (category: { name: string }) => {
    const next = renameValue.trim();
    if (!next) {
      setLocalError(t("categoryManagement.emptyName"));
      return;
    }
    if (next === category.name) {
      setRenamingName(null);
      return;
    }
    setLocalError(null);
    await rename(category.name, next);
    setRenamingName(null);
  };

  const handleDelete = async (name: string) => {
    setLocalError(null);
    await remove(name);
    setConfirmDelete(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("categoryManagement.title")}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-card border border-border rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">{t("categoryManagement.title")}</h2>
            <span className="text-xs text-muted-foreground">
              {t("categoryManagement.count", { count: categories.length })}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-muted-foreground hover:text-foreground rounded"
            aria-label={t("categoryManagement.close")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Create row */}
        <div className="px-4 py-3 border-b border-border space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={createValue}
              onChange={(e) => setCreateValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreate();
                }
                if (e.key === "Escape") setCreateValue("");
              }}
              placeholder={t("categoryManagement.createPlaceholder")}
              aria-label={t("categoryManagement.createPlaceholder")}
              className="flex-1 px-3 py-2 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
            />
            <button
              onClick={() => void handleCreate()}
              disabled={isLoading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-primary text-primary-foreground rounded-md hover:opacity-90 disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              {t("categoryManagement.create")}
            </button>
          </div>
          <div className="relative">
            <MagnifyingGlass className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("categoryManagement.searchPlaceholder")}
              aria-label={t("categoryManagement.searchPlaceholder")}
              className="w-full pl-7 pr-2 py-1.5 text-sm bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary text-foreground placeholder:text-muted-foreground"
            />
          </div>
          {(localError || error) && (
            <p className="text-xs text-destructive">{localError ?? error}</p>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-auto p-2 space-y-1">
          {isLoading && categories.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <CircleNotch className="w-5 h-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center py-8 text-sm text-muted-foreground">
              {t("categoryManagement.noCategories")}
            </p>
          ) : (
            filtered.map((category) => (
              <div
                key={category.name}
                className="flex items-center gap-2 px-3 py-2 rounded hover:bg-muted/40"
              >
                {renamingName === category.name ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRename(category);
                      if (e.key === "Escape") setRenamingName(null);
                    }}
                    aria-label={t("categoryManagement.renameInput")}
                    className="flex-1 px-2 py-1 text-sm bg-background border border-border rounded focus:outline-none focus:ring-1 focus:ring-primary text-foreground"
                  />
                ) : (
                  <>
                    <span className="text-sm flex-1 text-left truncate text-foreground">
                      {category.name}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {t("categoryManagement.itemsCount", { count: category.itemCount })}
                    </span>
                  </>
                )}

                <div className="flex gap-0.5 shrink-0">
                  {renamingName === category.name ? (
                    <>
                      <button
                        onClick={() => void handleRename(category)}
                        className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded text-xs"
                      >
                        {t("categoryManagement.save")}
                      </button>
                      <button
                        onClick={() => setRenamingName(null)}
                        className="p-1 text-muted-foreground hover:bg-muted/60 rounded text-xs"
                      >
                        {t("categoryManagement.cancel")}
                      </button>
                    </>
                  ) : confirmDelete === category.name ? (
                    <>
                      <button
                        onClick={() => void handleDelete(category.name)}
                        className="p-1 text-red-500 hover:bg-red-500/10 rounded text-xs"
                      >
                        {t("categoryManagement.confirm")}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="p-1 text-muted-foreground hover:bg-muted/60 rounded text-xs"
                      >
                        {t("categoryManagement.cancel")}
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          setRenamingName(category.name);
                          setRenameValue(category.name);
                        }}
                        className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded"
                        aria-label={t("categoryManagement.renameAction", { name: category.name })}
                        title={t("categoryManagement.renameAction", { name: category.name })}
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(category.name)}
                        className="p-1 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded"
                        aria-label={t("categoryManagement.deleteAction", { name: category.name })}
                        title={t("categoryManagement.deleteAction", { name: category.name })}
                      >
                        <Trash className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
