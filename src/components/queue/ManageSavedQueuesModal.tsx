import { useState } from "react";
import {
  Bookmarks,
  Check,
  PencilSimple,
  Star,
  Trash,
  X,
} from "@phosphor-icons/react";
import { useSavedQueueStore } from "../../stores/savedQueueStore";
import { useI18n } from "../../lib/i18n";
import type { SavedQueue } from "../../types/savedQueue";

interface ManageSavedQueuesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ManageSavedQueuesModal({
  isOpen,
  onClose,
}: ManageSavedQueuesModalProps) {
  const { t } = useI18n();
  const savedQueues = useSavedQueueStore((s) => s.savedQueues);
  const activeQueueId = useSavedQueueStore((s) => s.activeQueueId);
  const activateSavedQueue = useSavedQueueStore((s) => s.activateSavedQueue);
  const updateSavedQueue = useSavedQueueStore((s) => s.updateSavedQueue);
  const deleteSavedQueue = useSavedQueueStore((s) => s.deleteSavedQueue);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSelectQueue = async (queue: SavedQueue) => {
    await activateSavedQueue(queue.id);
    onClose();
  };

  const handleStartRename = (queue: SavedQueue) => {
    setEditingId(queue.id);
    setEditingName(queue.name);
    setDeleteConfirmId(null);
  };

  const handleSaveRename = async (id: string) => {
    if (!editingName.trim()) return;
    await updateSavedQueue(id, { name: editingName.trim() });
    setEditingId(null);
  };

  const handleSetDefault = async (queue: SavedQueue) => {
    await updateSavedQueue(queue.id, { isDefault: true });
  };

  const handleDelete = async (id: string) => {
    if (deleteConfirmId === id) {
      await deleteSavedQueue(id);
      setDeleteConfirmId(null);
    } else {
      setDeleteConfirmId(id);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-saved-queues-title"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4"
    >
      <button
        type="button"
        aria-label={t("common.close") || "Close"}
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-2xl flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <Bookmarks className="h-5 w-5 text-primary" />
            <h2 id="manage-saved-queues-title" className="text-base font-semibold text-foreground">
              {t("savedQueues.manageQueues") || "Manage Saved Queues"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={t("common.close") || "Close"}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-4 space-y-3">
          {savedQueues.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted-foreground">
              {t("savedQueues.noQueues") || "No saved queues yet."}
            </div>
          ) : (
            savedQueues.map((queue) => {
              const isEditing = editingId === queue.id;
              const isConfirmingDelete = deleteConfirmId === queue.id;
              const isActive = queue.id === activeQueueId;

              return (
                <div
                  key={queue.id}
                  className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                    isActive
                      ? "border-primary/50 bg-primary/5 hover:bg-primary/10"
                      : "border-border bg-muted/20 hover:bg-muted/40"
                  }`}
                >
                  <div
                    className={`flex-1 min-w-0 mr-3 ${!isEditing ? "cursor-pointer" : ""}`}
                    onClick={() => {
                      if (!isEditing) void handleSelectQueue(queue);
                    }}
                    role={!isEditing ? "button" : undefined}
                    tabIndex={!isEditing ? 0 : undefined}
                    onKeyDown={(e) => {
                      if (!isEditing && (e.key === "Enter" || e.key === " ")) {
                        e.preventDefault();
                        void handleSelectQueue(queue);
                      }
                    }}
                  >
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void handleSaveRename(queue.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          autoFocus
                          className="w-full px-2 py-1 text-sm rounded border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveRename(queue.id)}
                          className="p-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
                          title={t("common.save") || "Save"}
                        >
                          <Check className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm text-foreground truncate">
                            {queue.name}
                          </span>
                          {isActive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold">
                              {t("savedQueues.activeBadge") || "Active"}
                            </span>
                          )}
                          {queue.isDefault && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                              {t("savedQueues.defaultBadge") || "Default"}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground truncate mt-0.5">
                          {queue.itemTypes.documents && "Docs "}
                          {queue.itemTypes.extracts && "Extracts "}
                          {queue.itemTypes.learningItems && "Cards "}
                          {queue.filters.categories.length > 0 &&
                            `• ${queue.filters.categories.join(", ")}`}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {!queue.isDefault && (
                      <button
                        type="button"
                        onClick={() => void handleSetDefault(queue)}
                        className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title={t("savedQueues.setDefault") || "Set as Default"}
                      >
                        <Star className="w-4 h-4" />
                      </button>
                    )}

                    {!isEditing && (
                      <button
                        type="button"
                        onClick={() => handleStartRename(queue)}
                        className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        title={t("savedQueues.rename") || "Rename"}
                      >
                        <PencilSimple className="w-4 h-4" />
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => void handleDelete(queue.id)}
                      className={`p-1.5 rounded transition-colors ${
                        isConfirmingDelete
                          ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          : "text-muted-foreground hover:text-destructive hover:bg-muted"
                      }`}
                      title={
                        isConfirmingDelete
                          ? t("common.confirm") || "Click again to confirm delete"
                          : t("savedQueues.delete") || "Delete"
                      }
                    >
                      <Trash className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-5 py-3 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 text-xs md:text-sm font-medium rounded-md border border-border bg-background hover:bg-muted/70 text-foreground transition-colors"
          >
            {t("common.done") || "Done"}
          </button>
        </div>
      </div>
    </div>
  );
}
