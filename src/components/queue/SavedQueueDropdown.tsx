import { useState, useRef, useEffect } from "react";
import {
  Bookmarks,
  CaretDown,
  Check,
  Gear,
  Lightning,
  Plus,
  Stack,
  Target,
} from "@phosphor-icons/react";
import { useSavedQueueStore } from "../../stores/savedQueueStore";
import { useI18n } from "../../lib/i18n";
import type { SavedQueue } from "../../types/savedQueue";

interface SavedQueueDropdownProps {
  onOpenNewQueue: () => void;
  onOpenManageQueues: () => void;
  onQueueSelect?: (queue: SavedQueue) => void;
  className?: string;
}

export function SavedQueueDropdown({
  onOpenNewQueue,
  onOpenManageQueues,
  onQueueSelect,
  className = "",
}: SavedQueueDropdownProps) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const savedQueues = useSavedQueueStore((s) => s.savedQueues);
  const activeQueueId = useSavedQueueStore((s) => s.activeQueueId);
  const activateSavedQueue = useSavedQueueStore((s) => s.activateSavedQueue);

  const activeQueue = savedQueues.find((q) => q.id === activeQueueId) ?? null;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const handleSelect = async (queue: SavedQueue) => {
    await activateSavedQueue(queue.id);
    onQueueSelect?.(queue);
    setIsOpen(false);
  };

  const getIcon = (iconName?: string) => {
    switch (iconName) {
      case "Lightning":
        return <Lightning className="w-4 h-4 text-amber-500" />;
      case "Target":
        return <Target className="w-4 h-4 text-emerald-500" />;
      case "Stack":
      default:
        return <Bookmarks className="w-4 h-4 text-primary" />;
    }
  };

  return (
    <div className={`relative inline-block text-left ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="true"
        aria-expanded={isOpen}
        className="inline-flex items-center gap-2 px-3 py-1.5 text-xs md:text-sm font-medium rounded-md border border-border bg-background hover:bg-muted/70 text-foreground transition-colors shadow-sm"
        title={t("savedQueues.selectorTitle") || "Saved Queues"}
      >
        {activeQueue ? getIcon(activeQueue.icon) : <Bookmarks className="w-4 h-4 text-muted-foreground" />}
        <span className="truncate max-w-[140px] md:max-w-[180px]">
          {activeQueue ? activeQueue.name : t("savedQueues.allQueues") || "Saved Queues"}
        </span>
        <CaretDown className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-1 w-64 rounded-md border border-border bg-popover text-popover-foreground shadow-lg ring-1 ring-black/5 z-50 py-1 focus:outline-none">
          <div className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {t("savedQueues.title") || "Saved Queues"}
          </div>

          <div className="max-h-60 overflow-y-auto py-1">
            {savedQueues.map((queue) => {
              const isSelected = queue.id === activeQueueId;
              return (
                <button
                  key={queue.id}
                  onClick={() => handleSelect(queue)}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-muted/80 transition-colors ${
                    isSelected ? "bg-primary/10 text-primary font-medium" : "text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {getIcon(queue.icon)}
                    <div className="truncate">
                      <div className="truncate font-medium">{queue.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate">
                        {queue.itemTypes.documents && "Docs "}
                        {queue.itemTypes.extracts && "Extracts "}
                        {queue.itemTypes.learningItems && "Cards "}
                        {queue.filters.categories.length > 0 && `• ${queue.filters.categories.join(", ")}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {queue.isDefault && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {t("savedQueues.defaultBadge") || "Default"}
                      </span>
                    )}
                    {isSelected && <Check className="w-3.5 h-3.5 text-primary" />}
                  </div>
                </button>
              );
            })}
          </div>

          <div className="h-px bg-border my-1" />

          <button
            onClick={() => {
              setIsOpen(false);
              onOpenNewQueue();
            }}
            className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-muted/80 text-foreground transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-primary" />
            <span>{t("savedQueues.newQueue") || "New Queue..."}</span>
          </button>

          <button
            onClick={() => {
              setIsOpen(false);
              onOpenManageQueues();
            }}
            className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 hover:bg-muted/80 text-foreground transition-colors"
          >
            <Gear className="w-3.5 h-3.5 text-muted-foreground" />
            <span>{t("savedQueues.manageQueues") || "Manage Queues..."}</span>
          </button>
        </div>
      )}
    </div>
  );
}
