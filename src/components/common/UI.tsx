import {
  type ButtonHTMLAttributes,
  forwardRef,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { DotsThree, type Icon } from "@phosphor-icons/react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../utils/cn";
import { Button, buttonVariants } from "../md3/Button";

// Core visual contract: 8px-based control spacing, Material shape scale, one
// primary emphasis per surface, and a 40px minimum touch target. These
// primitives are intentionally theme-token based.
//
// ActionButton/actionVariants are compatibility shims over the Material 3
// md3/Button — the variant names map 1:1 (primary→filled, secondary→tonal,
// tertiary→text). New code should import from components/md3 directly.

const LEGACY_VARIANT_MAP = {
  primary: "filled",
  secondary: "tonal",
  tertiary: "text",
  destructive: "destructive",
} as const;

const LEGACY_SIZE_MAP = {
  default: "md",
  compact: "sm",
  large: "lg",
  icon: "icon",
} as const;

/** @deprecated Compatibility alias — use md3 Button (variant: filled/tonal/outlined/text). */
export const actionVariants = cva("", {
  variants: {
    variant: { primary: "", secondary: "", tertiary: "", destructive: "" },
    size: { default: "", compact: "", large: "", icon: "" },
  },
  defaultVariants: { variant: "secondary", size: "default" },
});

export interface ActionButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof actionVariants> {}

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  { className, variant, size, type = "button", ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      type={type}
      variant={LEGACY_VARIANT_MAP[variant ?? "secondary"] ?? "tonal"}
      size={LEGACY_SIZE_MAP[size ?? "default"] ?? "md"}
      className={className}
      {...props}
    />
  );
});

export type { VariantProps };
export interface ActionMenuItem {
  label: string;
  icon?: Icon;
  onSelect: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

interface ActionMenuProps {
  label: string;
  items: ActionMenuItem[];
  className?: string;
}

export function ActionMenu({ label, items, className }: ActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  return (
    <div ref={menuRef} className={cn("relative", className)}>
      <ActionButton
        ref={triggerRef}
        variant="secondary"
        size="icon"
        aria-label={label}
        aria-haspopup="menu"
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
      >
        <DotsThree className="h-5 w-5" weight="bold" aria-hidden="true" />
      </ActionButton>
      {isOpen && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-30 mt-2 min-w-48 rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {items.map(({ label: itemLabel, icon: ItemIcon, onSelect, disabled, destructive }) => (
            <button
              key={itemLabel}
              type="button"
              role="menuitem"
              disabled={disabled}
              className={cn(
                "flex min-h-10 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50",
                destructive ? "text-destructive hover:bg-destructive/10" : "text-foreground hover:bg-muted",
              )}
              onClick={() => {
                setIsOpen(false);
                onSelect();
                triggerRef.current?.focus();
              }}
            >
              {ItemIcon && <ItemIcon className="h-4 w-4" aria-hidden="true" />}
              {itemLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function FocusPanel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-2xl border border-primary/25 bg-primary/[0.07] p-5 sm:p-6", className)}>{children}</section>;
}

export function SummarySection({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export interface NumericInputProps {
  id?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
}

export function NumericInput({
  id,
  value,
  onChange,
  min,
  max,
  step,
  className,
  placeholder,
  disabled,
}: NumericInputProps) {
  const [tempValue, setTempValue] = useState<string>(
    value !== undefined && value !== null && !isNaN(value) ? String(value) : ""
  );

  useEffect(() => {
    if (value !== undefined && value !== null && !isNaN(value)) {
      if (Number(tempValue) !== value) {
        setTempValue(String(value));
      }
    } else {
      setTempValue("");
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = e.target.value;
    setTempValue(rawVal);

    if (rawVal === "") {
      return;
    }

    const num = step && step % 1 !== 0 ? parseFloat(rawVal) : parseInt(rawVal, 10);
    if (!isNaN(num)) {
      onChange(num);
    }
  };

  const handleBlur = () => {
    let num = step && step % 1 !== 0 ? parseFloat(tempValue) : parseInt(tempValue, 10);
    if (isNaN(num)) {
      num = value !== undefined && value !== null && !isNaN(value) ? value : (min ?? 0);
    }

    if (min !== undefined && num < min) {
      num = min;
    }
    if (max !== undefined && num > max) {
      num = max;
    }

    setTempValue(String(num));
    onChange(num);
  };

  return (
    <input
      type="number"
      id={id}
      min={min}
      max={max}
      step={step}
      value={tempValue}
      onChange={handleChange}
      onBlur={handleBlur}
      className={className}
      placeholder={placeholder}
      disabled={disabled}
    />
  );
}

