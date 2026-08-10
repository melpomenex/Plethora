import { useState } from "react";
import { FrameCorners } from "@phosphor-icons/react";
import type { ImageOcclusionRegion } from "../../../types/learningItemInteractions";
import { useI18n } from "../../../lib/i18n";
import { ImageOcclusionComposer } from "../../occlusion/ImageOcclusionComposer";

/**
 * Launcher used by the Flashcard Studio's `image-occlusion` draft edit forms.
 *
 * Opens the Image Occlusion Composer for the draft's image and regions; saving
 * writes the regions back to the draft card (via `onRegionsChange`) rather
 * than creating cards. This is the draft-edit contract: the composer's
 * `onSave` returns both the card drafts and the usable regions, and this
 * launcher only consumes the regions.
 */
export interface StudioOcclusionComposerLauncherProps {
  assetId?: string;
  regions: ImageOcclusionRegion[];
  onRegionsChange: (regions: ImageOcclusionRegion[]) => void;
  documentId?: string;
  deckId?: string;
}

export function StudioOcclusionComposerLauncher({
  assetId,
  regions,
  onRegionsChange,
  documentId,
  deckId,
}: StudioOcclusionComposerLauncherProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);

  if (!assetId) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
        {t("flashcardStudio.selectImageForOcclusion")}
      </p>
    );
  }

  return (
    <>
      <button
        type="button"
        data-testid="open-occlusion-composer"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted"
      >
        <FrameCorners className="h-4 w-4" />
        {t("flashcardStudio.openOcclusionEditor")}
      </button>
      {open && (
        <ImageOcclusionComposer
          assetId={assetId}
          initialRegions={regions}
          documentId={documentId}
          deckId={deckId}
          onSave={(result) => {
            onRegionsChange(result.regions);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </>
  );
}
