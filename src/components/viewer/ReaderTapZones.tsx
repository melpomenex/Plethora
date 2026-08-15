/**
 * ReaderTapZones component.
 *
 * Provides one-handed tap navigation regions (left = prev, right = next, center = toggle chrome)
 * without intercepting text selection, links, buttons, annotations, or gestures.
 */

import React, { useRef, useCallback } from "react";
import { useIsEink } from "../../contexts/PresentationContext";
import { loadSavedEinkSettings } from "../../lib/displayMode";

interface ReaderTapZonesProps {
  onPrevPage: () => void;
  onNextPage: () => void;
  onToggleChrome?: () => void;
  enabled?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const ReaderTapZones: React.FC<ReaderTapZonesProps> = ({
  onPrevPage,
  onNextPage,
  onToggleChrome,
  enabled,
  className = "",
  children,
}) => {
  const isEink = useIsEink();
  const einkSettings = loadSavedEinkSettings();
  const isTapZonesActive = enabled ?? (isEink && einkSettings.tapZones);

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isTapZonesActive || e.touches.length !== 1) {
      touchStartRef.current = null;
      return;
    }
    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };
  }, [isTapZonesActive]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!isTapZonesActive || !touchStartRef.current) return;
    const start = touchStartRef.current;
    touchStartRef.current = null;

    if (e.changedTouches.length !== 1) return;
    const touch = e.changedTouches[0];

    const deltaX = Math.abs(touch.clientX - start.x);
    const deltaY = Math.abs(touch.clientY - start.y);
    const duration = Date.now() - start.time;

    // Ignore if drag, swipe, or long-press
    if (deltaX > 15 || deltaY > 15 || duration > 450) {
      return;
    }

    // Ignore if user has highlighted text
    if (typeof window !== "undefined") {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        return;
      }
    }

    // Ignore if clicked on an interactive element
    const target = e.target as HTMLElement | null;
    if (
      target &&
      target.closest(
        "a, button, input, textarea, select, [role='button'], [data-interactive], [data-annotation], [data-highlight-id]"
      )
    ) {
      return;
    }

    const container = containerRef.current;
    const rect = container?.getBoundingClientRect() ?? {
      left: 0,
      width: window.innerWidth,
    };
    const relativeX = touch.clientX - rect.left;
    const ratio = relativeX / rect.width;

    if (ratio < 0.25) {
      onPrevPage();
    } else if (ratio > 0.75) {
      onNextPage();
    } else {
      onToggleChrome?.();
    }
  }, [isTapZonesActive, onPrevPage, onNextPage, onToggleChrome]);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full ${className}`}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {children}
    </div>
  );
};
