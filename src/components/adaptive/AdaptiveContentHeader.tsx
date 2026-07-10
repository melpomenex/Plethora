import { useRef, useState, type ReactNode } from "react";
import { DotsThree, X } from "@phosphor-icons/react";
import { cn } from "../../utils/cn";
import { useOverlayDismissal } from "../../hooks/useOverlayDismissal";

export interface AdaptiveHeaderAction {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export function AdaptiveContentHeader({
  title,
  description,
  status,
  primaryAction,
  secondaryActions,
  overflowActions = [],
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  overflowActions?: AdaptiveHeaderAction[];
  className?: string;
}) {
  const [overflowOpen, setOverflowOpen] = useState(false);
  const overflowButtonRef = useRef<HTMLButtonElement>(null);
  useOverlayDismissal(overflowOpen, () => setOverflowOpen(false), 40);

  const closeOverflow = () => {
    setOverflowOpen(false);
    window.requestAnimationFrame(() => overflowButtonRef.current?.focus());
  };

  return (
    <header className={cn("adaptive-content-header", className)}>
      <div className="adaptive-content-header-copy">
        <div className="adaptive-content-header-title-row">
          <h1 className="adaptive-content-header-title">{title}</h1>
          {status && <div className="adaptive-content-header-status">{status}</div>}
        </div>
        {description && (
          <div className="adaptive-content-header-description">{description}</div>
        )}
      </div>
      <div className="adaptive-content-header-actions">
        {secondaryActions && (
          <div className="adaptive-content-header-secondary">
            {secondaryActions}
          </div>
        )}
        {primaryAction && (
          <div className="adaptive-content-header-primary">{primaryAction}</div>
        )}
        {overflowActions.length > 0 && (
          <div className="adaptive-header-overflow-wrap">
            <button
              ref={overflowButtonRef}
              type="button"
              className="adaptive-icon-button adaptive-header-overflow-trigger"
              aria-label="More actions"
              aria-expanded={overflowOpen}
              onClick={() => setOverflowOpen((open) => !open)}
            >
              {overflowOpen ? <X size={20} /> : <DotsThree size={22} weight="bold" />}
            </button>
            {overflowOpen && (
              <div className="adaptive-header-overflow" role="menu" aria-label="More actions">
                {overflowActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    role="menuitem"
                    disabled={action.disabled}
                    className={cn(
                      "adaptive-header-overflow-item",
                      action.destructive && "adaptive-action-destructive",
                    )}
                    onClick={() => {
                      action.onSelect();
                      closeOverflow();
                    }}
                  >
                    {action.icon}
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

