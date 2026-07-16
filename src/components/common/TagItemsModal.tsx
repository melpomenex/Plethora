import { useEffect, useState } from "react";
import { CircleNotch, File, FileText, IdentificationCard } from "@phosphor-icons/react";
import { getItemsByTag, type TaggedItemSummary } from "../../api/tags";
import { useModalStore } from "./Modal";
import { useI18n } from "../../lib/i18n";
import { cn } from "../../utils";

interface TagItemsModalContentProps {
  tag: string;
  currentItemId?: string;
  onSelect: (item: TaggedItemSummary) => void;
}

const GROUP_ORDER: Array<{ type: TaggedItemSummary["itemType"]; labelKey: string; icon: typeof File }> = [
  { type: "document", labelKey: "itemDetails.tagGroupDocuments", icon: File },
  { type: "extract", labelKey: "itemDetails.tagGroupExtracts", icon: FileText },
  { type: "learning-item", labelKey: "itemDetails.tagGroupLearningItems", icon: IdentificationCard },
];

export function TagItemsModalContent({ tag, currentItemId, onSelect }: TagItemsModalContentProps) {
  const { t } = useI18n();
  const hideModal = useModalStore((s) => s.hideModal);
  const [items, setItems] = useState<TaggedItemSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setItems(null);
    setError(null);

    getItemsByTag(tag)
      .then((results) => {
        if (!active) return;
        setItems(results);
      })
      .catch((err) => {
        if (!active) return;
        console.error("Failed to load items by tag", err);
        setError(t("itemDetails.tagItemsLoadFailed"));
      });

    return () => {
      active = false;
    };
  }, [tag, t]);

  const handleSelect = (item: TaggedItemSummary) => {
    hideModal();
    onSelect(item);
  };

  if (error) {
    return <div className="text-sm text-destructive py-4">{error}</div>;
  }

  if (items === null) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <CircleNotch className="w-4 h-4 animate-spin" />
        {t("itemDetails.tagItemsLoading")}
      </div>
    );
  }

  const visibleItems = items.filter((item) => item.id !== currentItemId);

  if (visibleItems.length === 0) {
    return <div className="text-sm text-muted-foreground py-4">{t("itemDetails.tagItemsEmpty")}</div>;
  }

  return (
    <div className="space-y-4">
      {GROUP_ORDER.map(({ type, labelKey, icon: Icon }) => {
        const groupItems = visibleItems.filter((item) => item.itemType === type);
        if (groupItems.length === 0) return null;

        return (
          <div key={type}>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
              {t(labelKey)}
            </div>
            <div className="space-y-1">
              {groupItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  className={cn(
                    "w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm",
                    "bg-muted/40 hover:bg-muted transition-colors"
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
                  <span className="truncate text-foreground">{item.title}</span>
                  {item.category && (
                    <span className="ml-auto flex-shrink-0 text-xs text-muted-foreground">{item.category}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
