/**
 * XThreadSkeleton — native loading skeleton shaped like the real reader:
 * posts with avatar/text/image placeholders plus the thread spine. Shown
 * while the unrolled thread payload is being fetched.
 */
import { memo } from "react";

export const XThreadSkeleton = memo(function XThreadSkeleton({
  postCount = 4,
}: {
  postCount?: number;
}) {
  return (
    <div
      role="status"
      aria-label="Loading X thread"
      className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6"
    >
      {/* Header skeleton */}
      <div className="mb-8 flex items-center gap-3">
        <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
          <div className="h-3 w-24 animate-pulse rounded bg-muted/70" />
        </div>
        <div className="h-8 w-28 animate-pulse rounded-full bg-muted/70" />
      </div>

      {/* Post skeletons with spine */}
      {Array.from({ length: postCount }, (_, i) => (
        <div key={i} className="flex gap-3 sm:gap-4" data-testid="x-thread-skeleton-post">
          {/* Spine rail */}
          <div className="flex w-8 shrink-0 flex-col items-center">
            <div
              className={cnSkeleton(
                "h-3 w-3 rounded-full bg-muted",
                i === postCount - 1 ? "" : "mb-1"
              )}
            />
            {i < postCount - 1 && <div className="w-0.5 flex-1 rounded bg-border" />}
          </div>
          {/* Post body */}
          <div className="mb-8 flex-1 space-y-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 animate-pulse rounded-full bg-muted" />
              <div className="h-3 w-32 animate-pulse rounded bg-muted/70" />
              <div className="h-3 w-12 animate-pulse rounded bg-muted/50" />
            </div>
            <div className="h-3 w-full animate-pulse rounded bg-muted/60" />
            <div className="h-3 w-11/12 animate-pulse rounded bg-muted/60" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted/60" />
            {i % 3 === 1 && (
              <div className="aspect-video w-full animate-pulse rounded-xl bg-muted/50" />
            )}
          </div>
        </div>
      ))}
      <span className="sr-only">Loading thread…</span>
    </div>
  );
});

/** Tiny local helper so the skeleton file needs no extra imports. */
function cnSkeleton(...classes: (string | false | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
