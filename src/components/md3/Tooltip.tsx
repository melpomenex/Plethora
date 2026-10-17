import { cloneElement, isValidElement, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../utils/cn";

function usePortalTooltipPosition(portal: boolean, visible: boolean, side: "top" | "bottom", setVisible: (value: boolean) => void) {
  const anchor = useRef<HTMLSpanElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    if (!portal || !visible || !anchor.current || !tip.current) return;
    const rect = anchor.current.getBoundingClientRect();
    const box = tip.current.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const bottom = top + (viewport?.height ?? window.innerHeight);
    const idealTop = side === "top" ? rect.top - box.height - 6 : rect.bottom + 6;
    setPosition({ left: Math.max(8, Math.min(window.innerWidth - box.width - 8, rect.left + (rect.width - box.width) / 2)),
      top: Math.max(top + 8, Math.min(bottom - box.height - 8, idealTop)) });
    const hide = () => setVisible(false);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => { window.removeEventListener("scroll", hide, true); window.removeEventListener("resize", hide); };
  }, [portal, visible, side, setVisible]);

  return { anchor, tip, position };
}

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
  portal = false,
}: {
  text: string;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
  /** Escape scrollable controls while keeping the tooltip inside the viewport. */
  portal?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const { anchor, tip, position } = usePortalTooltipPosition(portal, visible, side, setVisible);

  const trigger = isValidElement(children)
    ? cloneElement(children as React.ReactElement<{ "aria-describedby"?: string }>, {
        "aria-describedby": visible ? id : undefined,
      })
    : children;

  const tooltip = <span
    ref={tip}
    id={id}
    role="tooltip"
    aria-hidden={!visible}
    style={portal ? position : undefined}
    className={cn(
      "pointer-events-none z-[var(--md-z-tooltip)] rounded-xs bg-inverse-surface px-2 py-1 md-label-small text-on-inverse-surface opacity-0 transition-opacity duration-[var(--md-duration-short)]",
      portal ? "fixed max-w-[calc(100vw-16px)]" : "absolute left-1/2 -translate-x-1/2 whitespace-nowrap",
      visible && "opacity-100",
      !portal && (side === "top" ? "bottom-[calc(100%+0.4rem)]" : "top-[calc(100%+0.4rem)]"),
    )}
  >{text}</span>;

  return (
    <span
      ref={anchor}
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {trigger}
      {portal ? visible && createPortal(tooltip, document.body) : tooltip}
    </span>
  );
}
