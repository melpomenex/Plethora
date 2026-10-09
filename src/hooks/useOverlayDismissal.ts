import { useEffect, useRef } from "react";
import { registerOverlayDismissal, resolveOverlayOwner } from "../lib/overlayStack";
import { usePaneId, useTabId } from "../components/common/Tabs/TabContent";

export function useOverlayDismissal(
  open: boolean,
  onDismiss: () => void,
  priority = 0,
) {
  const paneId = usePaneId();
  const tabId = useTabId();
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    return registerOverlayDismissal(() => dismissRef.current(), {
      priority,
      owner: resolveOverlayOwner(paneId, tabId),
    });
  }, [open, paneId, priority, tabId]);

  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      dismissRef.current();
    };
    window.addEventListener("keydown", handleEscape, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleEscape, { capture: true });
  }, [open]);
}

