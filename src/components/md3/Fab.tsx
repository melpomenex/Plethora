import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { Icon } from "@phosphor-icons/react";
import { cn } from "../../utils/cn";

/** Material 3 floating action button (primary, secondary/error containers). */
export const fabVariants = cva(
  "md-state md-focus-ring inline-flex select-none items-center justify-center gap-3 rounded-2xl font-medium shadow-lg transition-[box-shadow,transform] duration-[var(--md-duration-short)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      color: {
        primary: "bg-primary-container text-on-primary-container",
        secondary: "bg-secondary-container text-on-secondary-container",
        error: "bg-error-container text-on-error-container",
        surface: "bg-surface-container-high text-on-surface-variant",
      },
      size: {
        sm: "h-10 w-10 [&_svg]:h-4 [&_svg]:w-4",
        md: "h-14 w-14 rounded-xl [&_svg]:h-6 [&_svg]:w-6",
        lg: "h-24 w-24 rounded-2xl [&_svg]:h-9 [&_svg]:w-9",
      },
      extended: {
        true: "h-14 w-auto rounded-2xl px-5 text-sm",
        false: "",
      },
    },
    defaultVariants: { color: "primary", size: "md", extended: false },
  },
);

export interface FabProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "color">,
    VariantProps<typeof fabVariants> {
  icon?: Icon;
  label?: string;
}

export const Fab = forwardRef<HTMLButtonElement, FabProps>(function Fab(
  { className, color, size, extended, icon: IconCmp, label, type = "button", ...props },
  ref,
) {
  const name = label ?? props["aria-label"];
  return (
    <button
      ref={ref}
      type={type}
      aria-label={name}
      className={cn(fabVariants({ color, size, extended: extended ?? Boolean(label) }), className)}
      {...props}
    >
      {IconCmp && <IconCmp aria-hidden="true" />}
      {label && <span>{label}</span>}
    </button>
  );
});
