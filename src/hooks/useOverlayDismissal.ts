import { useEffect, useRef } from "react";
import { registerOverlayDismissal } from "../lib/overlayStack";

export function useOverlayDismissal(
  open: boolean,
  onDismiss: () => void,
  priority = 0,
) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    return registerOverlayDismissal(() => dismissRef.current(), priority);
  }, [open, priority]);

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

