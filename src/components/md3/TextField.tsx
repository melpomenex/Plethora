import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { cn } from "../../utils/cn";

/**
 * Material 3 outlined text field. Error state pairs the error-container role
 * with an icon + message (never color alone). Floating labels are out of
 * scope; use a static label bound via id/htmlFor.
 */
export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  error?: boolean;
  supportingText?: ReactNode;
  errorText?: ReactNode;
  size?: "sm" | "md";
  wrapClassName?: string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, supportingText, errorText, size = "md", wrapClassName, className, id, ...props },
  ref,
) {
  const hasError = Boolean(error || errorText);
  const inputId = id ?? (label ? `tf-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  return (
    <div className={cn("flex w-full min-w-0 flex-col gap-1", wrapClassName)}>
      {label && (
        <label htmlFor={inputId} className="md-label-medium text-on-surface-variant">
          {label}
        </label>
      )}
      <div className="relative">
        <input
          ref={ref}
          id={inputId}
          aria-invalid={hasError || undefined}
          aria-describedby={hasError && errorText ? `${inputId}-error` : undefined}
          className={cn(
            "md-focus-ring w-full rounded-lg border bg-surface-container-lowest px-3 text-on-surface placeholder:text-on-surface-variant/70 transition-colors focus-visible:outline-none",
            size === "sm" ? "min-h-9 text-sm" : "min-h-11",
            hasError
              ? "border-error pr-9"
              : "border-outline hover:border-on-surface-variant focus-visible:border-primary",
            className,
          )}
          {...props}
        />
        {hasError && (
          <WarningCircle
            className="pointer-events-none absolute right-2.5 top-1/2 h-5 w-5 -translate-y-1/2 text-error"
            aria-hidden="true"
          />
        )}
      </div>
      {hasError && errorText ? (
        <p id={`${inputId}-error`} className="md-body-small text-error">
          {errorText}
        </p>
      ) : supportingText ? (
        <p className="md-body-small text-on-surface-variant">{supportingText}</p>
      ) : null}
    </div>
  );
});

/** Search field: text field with a leading search affordance. */
export const SearchField = forwardRef<HTMLInputElement, TextFieldProps>(function SearchField(
  { label, className, ...props },
  ref,
) {
  return (
    <div className="relative w-full min-w-0">
      <MagnifyingGlass
        className="pointer-events-none absolute left-3 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-on-surface-variant"
        aria-hidden="true"
      />
      <TextField
        ref={ref}
        type="search"
        label={label}
        className={cn("pl-9 [&::-webkit-search-cancel-button]:appearance-none", className)}
        {...props}
      />
    </div>
  );
});
