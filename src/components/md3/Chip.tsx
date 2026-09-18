import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Check, X } from "@phosphor-icons/react";
import { cn } from "../../utils/cn";

/**
 * Material 3 chips. `filter`/`input` chips expose selection via
 * `aria-pressed` plus a checkmark/remove affordance — never color alone.
 */
export const chipVariants = cva(
  "md-state md-focus-ring inline-flex min-h-8 select-none items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        assist: "border-outline-variant text-on-surface-variant",
        suggestion: "bg-secondary-container border-transparent text-on-secondary-container",
        filter: "border-outline-variant text-on-surface-variant",
        input: "border-outline-variant text-on-surface",
      },
      selected: {
        true: "bg-secondary-container border-transparent text-on-secondary-container",
        false: "",
      },
    },
    compoundVariants: [{ variant: "filter", selected: true, class: "" }],
    defaultVariants: { variant: "assist", selected: false },
  },
);

export interface ChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    VariantProps<typeof chipVariants> {
  label: string;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  onRemove?: () => void;
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { className, variant, selected, label, icon: IconCmp, onRemove, type = "button", ...props },
  ref,
) {
  const showCheck = variant === "filter" && selected;
  return (
    <button
      ref={ref}
      type={type}
      aria-pressed={variant === "filter" || variant === "input" ? Boolean(selected) : undefined}
      className={cn(chipVariants({ variant, selected }), className)}
      {...props}
    >
      {showCheck && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
      {!showCheck && IconCmp && <IconCmp className="h-4 w-4 shrink-0" aria-hidden="true" />}
      <span className="truncate">{label}</span>
      {onRemove && (
        <span
          role="button"
          tabIndex={-1}
          aria-label={`Remove ${label}`}
          className="md-state -mr-1 ml-1 flex h-5 w-5 items-center justify-center rounded-full"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onRemove();
            }
          }}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      )}
    </button>
  );
});
