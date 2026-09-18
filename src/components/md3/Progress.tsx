import { cn } from "../../utils/cn";

/** Material 3 linear progress indicator (determinate or indeterminate). */
export function LinearProgress({
  value,
  className,
  label,
}: {
  value?: number | null;
  className?: string;
  label?: string;
}) {
  const determinate = typeof value === "number";
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(value!) : undefined}
      className={cn("h-1 w-full overflow-hidden rounded-full bg-surface-container-highest", className)}
    >
      <div
        className={cn(
          "h-full rounded-full bg-primary transition-[width] duration-[var(--md-duration-medium)]",
          !determinate && "md-progress-indeterminate",
        )}
        style={determinate ? { width: `${Math.max(0, Math.min(100, value!))}%` } : undefined}
      />
    </div>
  );
}

/** Material 3 circular progress indicator. */
export function CircularProgress({
  value,
  className,
  label,
  size = 24,
}: {
  value?: number | null;
  className?: string;
  label?: string;
  size?: number;
}) {
  const determinate = typeof value === "number";
  const clamped = determinate ? Math.max(0, Math.min(100, value!)) : 0;
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round(clamped) : undefined}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("shrink-0", !determinate && "md-spin", className)}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={3}
        className="stroke-surface-container-highest"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={3}
        strokeLinecap="round"
        className={cn("stroke-primary origin-center", !determinate && "opacity-30")}
        strokeDasharray={circumference}
        strokeDashoffset={determinate ? circumference * (1 - clamped / 100) : circumference * 0.75}
      />
    </svg>
  );
}
