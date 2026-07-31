/**
 * StudioContextChipBar — the Studio's mobile configuration row.
 *
 * Replaces four stacked control bands (document, deck + tags, image actions,
 * Context Control) with a single non-wrapping scrollable row of chips. Each
 * chip shows its control's current value so configuration stays readable at a
 * glance, and opens that control in a bottom sheet when tapped.
 */

import { FolderOpen, Images, Scissors, Sparkle, Tag, TextT } from "@phosphor-icons/react";
import { useI18n } from "../../../lib/i18n";
import { cn } from "../../../utils";
import {
  buildStudioChips,
  type StudioChip,
  type StudioChipIcon,
  type StudioChipState,
  type StudioSheet,
} from "./studioChips";

const ICONS: Record<StudioChipIcon, React.ComponentType<{ className?: string }>> = {
  document: TextT,
  deck: FolderOpen,
  tag: Tag,
  images: Images,
  context: Scissors,
  provider: Sparkle,
};

interface StudioContextChipBarProps {
  state: StudioChipState;
  onOpenSheet: (sheet: StudioSheet) => void;
}

export function StudioContextChipBar({ state, onOpenSheet }: StudioContextChipBarProps) {
  const { t } = useI18n();
  const chips = buildStudioChips(state);

  // Placeholder text for chips whose control has no value yet, plus the
  // accessible-name prefix that tells a screen reader which control a chip is.
  const chipCopy = (chip: StudioChip): { placeholder: string; describe: (value: string) => string } => {
    switch (chip.id) {
      case "document":
        return {
          placeholder: t("flashcardStudio.selectDocument"),
          describe: (value) => t("flashcardStudio.chipDocumentLabel", { value }),
        };
      case "deck":
        return {
          placeholder: t("flashcardStudio.selectDeck"),
          describe: (value) => t("flashcardStudio.chipDeckLabel", { value }),
        };
      case "tags":
        return {
          placeholder: "",
          describe: (value) => t("flashcardStudio.chipTagsLabel", { value }),
        };
      case "images":
        return {
          placeholder: "",
          describe: (value) => t("flashcardStudio.chipImagesLabel", { value }),
        };
      case "context":
        return {
          placeholder: "",
          describe: (value) => t("flashcardStudio.chipContextLabel", { value }),
        };
      case "provider":
        return {
          placeholder: t("flashcardStudio.noProvider"),
          describe: (value) => t("flashcardStudio.chipProviderLabel", { value }),
        };
    }
  };

  return (
    <div
      className="flex flex-nowrap items-center gap-2 overflow-x-auto border-b border-border bg-muted/20 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="group"
      aria-label={t("flashcardStudio.chipBarLabel")}
    >
      {chips.map((chip) => {
        const Icon = ICONS[chip.icon];
        const copy = chipCopy(chip);
        const hasValue = chip.fullLabel.length > 0;
        const display = hasValue ? chip.label : copy.placeholder;
        const interactive = chip.opens !== null;

        const className = cn(
          // min-h-[44px] keeps every chip at the platform minimum touch target
          // even though the row is visually compact.
          "flex min-h-[44px] flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs transition-colors",
          chip.active
            ? "border-primary/40 bg-primary/10 text-foreground"
            : hasValue
            ? "border-border bg-background text-muted-foreground"
            : "border-dashed border-border bg-background text-muted-foreground"
        );

        if (!interactive) {
          return (
            <span key={chip.id} className={className} title={chip.fullLabel}>
              <Icon className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
              {display}
            </span>
          );
        }

        return (
          <button
            key={chip.id}
            type="button"
            onClick={() => onOpenSheet(chip.opens as StudioSheet)}
            className={cn(className, "active:bg-muted")}
            title={chip.fullLabel || copy.placeholder}
            aria-label={copy.describe(chip.fullLabel || copy.placeholder)}
          >
            <Icon className="h-3.5 w-3.5 flex-shrink-0 opacity-70" />
            {display}
          </button>
        );
      })}
    </div>
  );
}
