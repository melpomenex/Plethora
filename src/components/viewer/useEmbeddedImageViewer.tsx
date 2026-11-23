import { useEffect, useState, type RefObject } from "react";
import { useI18n } from "../../lib/i18n";
import { EmbeddedImageViewer, type EmbeddedImageRequest } from "./EmbeddedImageViewer";
import { attachEmbeddedImageViewer } from "./embeddedImageDom";

/**
 * Attaches the delegated embedded image viewer to a rendered content root
 * and returns the lightbox portal element when an image is open.
 */
export function useEmbeddedImageViewer(
  root: HTMLElement | null,
  fallbackFocusRef?: RefObject<HTMLElement | null>,
) {
  const { t } = useI18n();
  const [embeddedImage, setEmbeddedImage] = useState<EmbeddedImageRequest | null>(null);
  const genericImageDescription = t("viewer.genericImageDescription");

  useEffect(() => {
    if (!root) return;
    return attachEmbeddedImageViewer({
      root,
      genericLabel: genericImageDescription,
      open: setEmbeddedImage,
    });
  }, [genericImageDescription, root]);

  const viewerOverlay = embeddedImage ? (
    <EmbeddedImageViewer
      image={embeddedImage}
      onClose={() => setEmbeddedImage(null)}
      fallbackFocusRef={fallbackFocusRef}
    />
  ) : null;

  return {
    viewerOverlay,
    openEmbeddedImage: setEmbeddedImage,
    closeEmbeddedImage: () => setEmbeddedImage(null),
  };
}
