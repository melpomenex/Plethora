import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../utils/cn";

export function SafeScrollContainer({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={cn("adaptive-safe-scroll", className)} {...props}>
      {children}
    </div>
  );
}

export function StickyActionBar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("adaptive-sticky-actions", className)}>
      {children}
    </div>
  );
}

