import { useEffect, useId, useRef, type RefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { registerOverlayDismissal } from "../../lib/overlayStack";
import { cn } from "../../utils/cn";

const FOCUSABLE =
  'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Material 3 dialog surface contract. Shared by this Dialog component and by
 * the legacy Modal/ConfirmDialog/ResponsiveDialogSheet restyle so all dialog
 * chrome in the app is defined once: surface-container-high tonal elevation,
 * extra-large radius, scrim backdrop, md-z-dialog layer.
 */
export const dialogSurface = cn(
  "md-dialog-surface",
  "relative flex w-full flex-col rounded-[var(--md-shape-extra-large)] bg-surface-container-high text-on-surface shadow-2xl",
);

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  closeLabel?: string;
  /** alertdialog semantics for confirmations/destructive decisions. */
  alert?: boolean;
  /** Hide the header close button (Escape/scrim still close). */
  hideCloseButton?: boolean;
  className?: string;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  closeLabel = "Close",
  alert = false,
  hideCloseButton,
  className,
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useDialogFocus(open, onClose);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[var(--md-z-dialog)] flex items-center justify-center p-4">
      <div className="md-dialog-scrim absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={cn(dialogSurface, "max-h-[85vh] max-w-md", className)}
        role={alert ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="flex items-start gap-3 px-6 pt-6">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="md-headline-small text-on-surface">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="md-body-medium mt-2 text-on-surface-variant">
                {description}
              </p>
            )}
          </div>
          {!hideCloseButton && (
            <button
              type="button"
              className="md-state -m-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant"
              aria-label={closeLabel}
              onClick={onClose}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 px-6 pb-6 pt-2">{footer}</footer>
        )}
      </div>
    </div>,
    document.body,
  );
}

export function useDialogFocus(open: boolean, onClose: () => void, initialFocusRef?: RefObject<HTMLElement | null>) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const unregister = registerOverlayDismissal(() => closeRef.current(), 100);
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      if (panelRef.current?.contains(document.activeElement)) return;
      const target = initialFocusRef?.current ?? panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      if (target) {
        target.focus();
      } else {
        panelRef.current?.focus();
      }
    });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      unregister();
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKey);
      previousFocusRef.current?.focus();
    };
  }, [open]);

  return panelRef;
}
