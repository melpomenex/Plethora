import type { ReactNode, Ref } from "react";

interface ReviewCompletionViewportProps {
  children: ReactNode;
  containerRef?: Ref<HTMLDivElement>;
}

/** Keeps completion content inside the available app viewport and scrollable when it is tall. */
export function ReviewCompletionViewport({
  children,
  containerRef,
}: ReviewCompletionViewportProps) {
  return (
    <div
      ref={containerRef}
      data-review-completion-viewport
      className="h-full min-h-0 overflow-y-auto overscroll-y-contain p-6"
    >
      <div className="flex min-h-full w-full flex-col items-center justify-center gap-6 pb-6">
        {children}
      </div>
    </div>
  );
}
