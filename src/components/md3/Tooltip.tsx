import { cloneElement, isValidElement, useId, useState, type ReactNode } from "react";
import { cn } from "../../utils/cn";

/**
 * Minimal CSS-driven Material tooltip: appears on hover AND keyboard focus,
 * never on touch-only activation, reduced-motion aware (opacity-only
 * transition via motion tokens). The trigger carries aria-describedby while
 * the tooltip is visible — its accessible name stays authoritative.
 */
export function Tooltip({
  text,
  children,
  side = "top",
  className,
}: {
  text: string;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  const trigger = isValidElement(children)
    ? cloneElement(children as React.ReactElement<{ "aria-describedby"?: string }>, {
        "aria-describedby": visible ? id : undefined,
      })
    : children;

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {trigger}
      <span
        id={id}
        role="tooltip"
        aria-hidden={!visible}
        className={cn(
          "pointer-events-none absolute left-1/2 z-[var(--md-z-tooltip)] -translate-x-1/2 whitespace-nowrap rounded-xs bg-inverse-surface px-2 py-1 md-label-small text-on-inverse-surface opacity-0 transition-opacity duration-[var(--md-duration-short)]",
          visible && "opacity-100",
          side === "top" ? "bottom-[calc(100%+0.4rem)]" : "top-[calc(100%+0.4rem)]",
        )}
      >
        {text}
      </span>
    </span>
  );
}
