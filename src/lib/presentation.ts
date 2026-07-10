export const PRESENTATION_THRESHOLDS = {
  phoneMax: 599,
  desktopMin: 1024,
  compactDesktopMinWidth: 760,
  compactDesktopMinHeight: 560,
} as const;

export type PresentationMode =
  | "phone"
  | "tablet"
  | "compact-desktop"
  | "desktop";

export type PointerType = "coarse" | "fine";

export interface PresentationEnvironment {
  viewportWidth: number;
  viewportHeight: number;
  isTauri: boolean;
  isNativeMobile: boolean;
  isNativePhone: boolean;
}

/**
 * Classify presentation independently from React so shell and native-window
 * tests can exercise the exact same contract.
 */
export function classifyPresentation({
  viewportWidth,
  viewportHeight,
  isTauri,
  isNativeMobile,
  isNativePhone,
}: PresentationEnvironment): PresentationMode {
  if (isNativePhone) return "phone";

  if (isNativeMobile) {
    return viewportWidth >= PRESENTATION_THRESHOLDS.desktopMin
      ? "desktop"
      : "tablet";
  }

  if (isTauri) {
    return viewportWidth < PRESENTATION_THRESHOLDS.desktopMin
      ? "compact-desktop"
      : "desktop";
  }

  const shortViewportEdge = Math.min(viewportWidth, viewportHeight);
  if (shortViewportEdge <= PRESENTATION_THRESHOLDS.phoneMax) return "phone";
  if (viewportWidth < PRESENTATION_THRESHOLDS.desktopMin) return "tablet";
  return "desktop";
}

export function presentationUsesMobileShell(mode: PresentationMode): boolean {
  return mode === "phone" || mode === "tablet";
}

