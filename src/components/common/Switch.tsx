/**
 * Switch
 *
 * The standard Plethora switch idiom, extracted into one component. This is the
 * `<label><input type="checkbox" class="sr-only peer">` + pill pattern used
 * across Settings (SettingsPage.tsx, AIProviderSettings.tsx, …), with correct
 * 44×24px pill proportions, an opaque white knob, theme tokens for the track
 * (`bg-muted` off / `bg-primary` on), a visible focus ring, and full keyboard
 * operation via the real checkbox.
 *
 * Exposed as `role="switch"` with `aria-checked` so screen readers announce a
 * switch toggle; Enter/Space toggle it via the native checkbox.
 */

import { cn } from "../../utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Accessible name for the control (the label text is separate). */
  "aria-label"?: string;
  disabled?: boolean;
  /** Expand the hit area to ≥44px (mobile touch target) while keeping the pill centered. */
  touchTarget?: boolean;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  "aria-label": ariaLabel,
  disabled,
  touchTarget,
  className,
}: SwitchProps) {
  return (
    <label
      className={cn(
        "relative inline-flex cursor-pointer items-center",
        touchTarget && "min-h-[44px] min-w-[44px] justify-center",
        disabled && "cursor-not-allowed opacity-60",
        className
      )}
    >
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled}
        onKeyDown={(event) => {
          // Deterministic keyboard activation: native checkboxes only toggle on
          // Space in most engines, and jsdom simulates none. Handle Space and
          // Enter explicitly, preventing the native default so the controlled
          // input never double-toggles.
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            if (!disabled) onCheckedChange(!checked);
          }
        }}
        onChange={(event) => {
          if (!disabled) onCheckedChange(event.target.checked);
        }}
        className="peer sr-only"
      />
      <div
        aria-hidden="true"
        className={cn(
          "switch-track relative h-6 w-11 shrink-0 rounded-full bg-muted transition-colors",
          "after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-transform",
          "peer-checked:bg-primary peer-checked:after:translate-x-5",
          "peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-card",
          "peer-disabled:cursor-not-allowed"
        )}
      />
    </label>
  );
}
