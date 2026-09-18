import {
  useId,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { X } from "@phosphor-icons/react";
import { usePresentation } from "../../contexts/PresentationContext";
import { dialogSurface, useDialogFocus } from "../md3/Dialog";
import { cn } from "../../utils/cn";

export function ResponsiveDialogSheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  initialFocusRef,
  closeLabel = "Close",
  presentation = "auto",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  closeLabel?: string;
  presentation?: "auto" | "sheet" | "dialog";
  className?: string;
}) {
  const { mode } = usePresentation();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useDialogFocus(open, onClose, initialFocusRef);
  const useSheet =
    presentation === "sheet" ||
    (presentation === "auto" && (mode === "phone" || mode === "tablet"));
  if (!open) return null;

  return createPortal(
    <div className="adaptive-dialog-layer">
      <button
        type="button"
        className="adaptive-dialog-backdrop"
        aria-label={closeLabel}
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={cn(
          dialogSurface,
          "adaptive-dialog-panel",
          useSheet ? "adaptive-dialog-sheet" : "adaptive-dialog-centered",
          className,
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="adaptive-dialog-header">
          <div className="min-w-0">
            <h2 id={titleId} className="adaptive-dialog-title">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="adaptive-dialog-description">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="adaptive-icon-button"
            aria-label={closeLabel}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="adaptive-dialog-body">{children}</div>
        {footer && <footer className="adaptive-dialog-footer">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

