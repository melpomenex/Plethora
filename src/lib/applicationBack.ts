import { useTabsStore } from "../stores/tabsStore";
import { requestContextualBack } from "./contextualBack";
import { requestOverlayBack } from "./overlayStack";

/**
 * Dispatch application back in visual-layer order. Each layer reports whether
 * it consumed the request so a gesture or native event causes one transition.
 */
export function requestApplicationBack(): boolean {
  if (requestOverlayBack()) return true;
  if (requestContextualBack()) return true;
  return useTabsStore.getState().goToPreviousTab();
}
