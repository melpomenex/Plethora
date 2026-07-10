import { useEffect } from "react";

export interface VisualViewportMetrics {
  height: number;
  offsetTop: number;
  keyboardHeight: number;
}

export function readVisualViewportMetrics(): VisualViewportMetrics {
  const viewport = window.visualViewport;
  const height = viewport?.height ?? window.innerHeight;
  const offsetTop = viewport?.offsetTop ?? 0;
  return {
    height,
    offsetTop,
    keyboardHeight: Math.max(0, window.innerHeight - height - offsetTop),
  };
}

function publishVisualViewportMetrics() {
  const metrics = readVisualViewportMetrics();
  const root = document.documentElement;
  root.style.setProperty("--app-viewport-height", `${metrics.height}px`);
  root.style.setProperty("--app-viewport-offset-top", `${metrics.offsetTop}px`);
  root.style.setProperty("--app-keyboard-height", `${metrics.keyboardHeight}px`);
}

export function useVisualViewport() {
  useEffect(() => {
    let rafId: number | null = null;
    const schedule = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        publishVisualViewportMetrics();
      });
    };

    publishVisualViewportMetrics();
    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      const root = document.documentElement;
      root.style.removeProperty("--app-viewport-height");
      root.style.removeProperty("--app-viewport-offset-top");
      root.style.removeProperty("--app-keyboard-height");
    };
  }, []);
}

