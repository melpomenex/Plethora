import { useId, useRef, type ReactNode } from "react";
import { Check } from "@phosphor-icons/react";
import { cn } from "../../utils/cn";

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  disabled?: boolean;
}

export interface SegmentedButtonProps<T extends string | number> {
  options: SegmentedOption<T>[];
  value: T | readonly T[] | null;
  onChange: (value: T) => void;
  /** Multi-select mode: selected segments toggle independently. */
  multi?: boolean;
  label: string;
  className?: string;
  disabled?: boolean;
  size?: "sm" | "md";
}

/**
 * Material 3 segmented button. Single-select uses roving selection (arrow
 * keys move selection); multi-select toggles with Space/Enter. Selection is
 * always indicated by a checkmark + tonal fill, never color alone.
 */
export function SegmentedButton<T extends string | number>({
  options,
  value,
  onChange,
  multi = false,
  label,
  className,
  disabled,
  size = "md",
}: SegmentedButtonProps<T>) {
  const baseRef = useRef<HTMLDivElement>(null);
  const groupId = useId();

  const selected = (v: T): boolean => (Array.isArray(value) ? value.includes(v) : value === v);

  const tabOption = options.find((opt) => !opt.disabled && selected(opt.value)) ?? options.find((opt) => !opt.disabled);

  const moveFocus = (from: number, dir: 1 | -1) => {
    const container = baseRef.current;
    if (!container) return;
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = buttons[(idx + dir + buttons.length) % buttons.length] ?? buttons[from];
    next?.focus();
    if (!multi) {
      const opt = options[Number(next?.dataset.optionIndex)];
      if (opt) onChange(opt.value);
    }
  };

  return (
    <div
      ref={baseRef}
      role={multi ? "group" : "radiogroup"}
      aria-label={label}
      className={cn(
        "inline-flex overflow-hidden rounded-full border border-outline",
        disabled && "pointer-events-none opacity-40",
        className,
      )}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          moveFocus(0, 1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          moveFocus(options.length - 1, -1);
        }
      }}
    >
      {options.map((opt, i) => {
        const isSelected = selected(opt.value);
        const IconCmp = opt.icon;
        return (
          <button
            key={String(opt.value)}
            id={`${groupId}-${opt.value}`}
            type="button"
            data-option-index={i}
            tabIndex={multi || (!disabled && opt === tabOption) ? 0 : -1}
            role={multi ? "checkbox" : "radio"}
            aria-checked={isSelected}
            disabled={disabled || opt.disabled}
            className={cn(
              "md-state md-focus-ring inline-flex flex-1 select-none items-center justify-center gap-1.5 border-outline font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40",
              i > 0 && "border-l",
              size === "sm" ? "min-h-8 px-3 text-xs" : "min-h-10 px-4 text-sm",
              isSelected
                ? "bg-secondary-container text-on-secondary-container"
                : "text-on-surface",
            )}
            onClick={() => onChange(opt.value)}
          >
            {isSelected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
            {!isSelected && IconCmp && <IconCmp className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <span className="truncate">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}
