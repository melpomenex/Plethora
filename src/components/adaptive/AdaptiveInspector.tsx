import { useId, type ReactNode } from "react";
import { X } from "@phosphor-icons/react";
import { usePresentation } from "../../contexts/PresentationContext";
import { useOverlayDismissal } from "../../hooks/useOverlayDismissal";
import { cn } from "../../utils/cn";

export function AdaptiveInspector({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const { mode } = usePresentation();
  const titleId = useId();
  const constrained = mode === "phone" || mode === "tablet" || mode === "compact-desktop";
  useOverlayDismissal(open && constrained, onClose, 30);

  return (
    <>
      {open && constrained && (
        <button
          type="button"
          className="adaptive-inspector-backdrop"
          aria-label="Close inspector"
          onClick={onClose}
        />
      )}
      <aside
        className={cn(
          "adaptive-inspector",
          constrained && "adaptive-inspector-drawer",
          open ? "adaptive-inspector-open" : "adaptive-inspector-closed",
          className,
        )}
        role={constrained ? "dialog" : "complementary"}
        aria-modal={constrained && open ? "true" : undefined}
        aria-hidden={!open}
        aria-labelledby={titleId}
        inert={!open ? true : undefined}
      >
        <header className="adaptive-inspector-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="adaptive-icon-button"
            aria-label="Close inspector"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="adaptive-inspector-body">{children}</div>
      </aside>
    </>
  );
}

