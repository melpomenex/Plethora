import { useEffect, useRef } from "react";

/**
 * Run an effect only when a mounted tab transitions from inactive to active.
 * The initial active render is intentionally ignored.
 */
export function useTabReactivation(
  isActive: boolean,
  onReactivate: () => void,
): void {
  const wasActiveRef = useRef(isActive);

  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = isActive;

    if (isActive && !wasActive) {
      onReactivate();
    }
  }, [isActive, onReactivate]);
}
