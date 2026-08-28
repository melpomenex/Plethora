import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useSettingsStore } from "../../stores/settingsStore";
import { useBattery } from "../../contexts/BatteryContext";
import { isNativeMobile } from "../../lib/tauri";
import {
  createBackdropRenderer,
  type BackdropController,
} from "./ambient/renderer/createThemeRenderer";
import { findEffect } from "./ambient/renderer/effects";
import type { RendererInputs } from "./ambient/renderer/types";

/**
 * Ambient animated backdrop. React owns lifecycle and environment state; the
 * renderer layer (ambient/renderer) owns drawing, backends (WebGL2 preferred,
 * Canvas2D fallback), quality policy and frame scheduling. Renderers create
 * their own canvas element inside the host div below.
 */
export function ThemeBackdrop() {
  const { theme } = useTheme();
  const settings = useSettingsStore((s) => s.settings.interface);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<BackdropController | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [isVisible, setIsVisible] = useState(!document.hidden);

  const animation = theme.effects?.backgroundAnimation;
  const ambientPaletteId = theme.effects?.ambientPaletteId ?? theme.id;
  const { onBattery } = useBattery();
  const density = settings.animationFrequency;
  // Reduce density when on battery (50% reduction)
  const effectiveDensity = onBattery ? density * 0.5 : density;

  // Brightness via CSS filter — GPU-accelerated, zero per-frame cost.
  // Setting is stored in tenths (10 = 1.0x, 12 = 1.2x, etc.)
  const brightnessGain = Math.max(0.1, settings.animationBrightness / 10);

  // Master toggle for animated themes. Defaulted to true on desktop; native
  // mobile defaults to false (see settingsStore init) so we don't reintroduce
  // the sustained GPU load that heated phones, but users can opt back in.
  const animationsEnabled = settings.animationsEnabled;

  // Respect the OS reduced-motion preference. When set, decorative animation is
  // disabled regardless of the user toggle — a cheap accessibility win.
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  const staticOnly = !animationsEnabled || prefersReducedMotion;

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setPrefersReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const handleSuspend = (event: Event) => {
      const customEvent = event as CustomEvent<{ suspended?: boolean }>;
      setSuspended(Boolean(customEvent.detail?.suspended));
    };

    window.addEventListener("plethora-theme-backdrop-suspend", handleSuspend as EventListener);

    // Visibility change: pause/resume animations when tab/window is hidden/shown
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Tauri focus change: also pause when the app window loses focus
    let unlistenFocus: (() => void) | null = null;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        unlistenFocus = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (!focused) {
            setIsVisible(false);
          } else if (!document.hidden) {
            setIsVisible(true);
          }
        });
      } catch {
        // Not in Tauri environment, document.visibilitychange is sufficient
      }
    })();

    return () => {
      window.removeEventListener("plethora-theme-backdrop-suspend", handleSuspend as EventListener);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unlistenFocus?.();
    };
  }, []);

  // Resolve the effect once per render for the guard checks below (cheap map
  // lookup with the legacy prefix fallback).
  const effect = animation ? findEffect(animation) : null;
  const renderable = Boolean(effect && (effect.canvas2d || effect.webgl));
  // Static-only guard: effects without a static frame (all Canvas2D effects
  // except the jellyfish family) render nothing when motion is disabled.
  const staticRenderable = staticOnly ? Boolean(effect?.supportsStatic) : true;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !animation || suspended) return;
    if (!renderable || !staticRenderable) return;

    const inputs: RendererInputs = {
      effectId: animation,
      paletteId: ambientPaletteId,
      // Raw user density — backends apply their own battery/quality scaling.
      density,
      brightness: brightnessGain,
      environment: {
        mobile: isNativeMobile(),
        onBattery,
        reducedMotion: prefersReducedMotion,
        animationsEnabled,
        visible: isVisible,
      },
    };

    const controller = createBackdropRenderer({ host, inputs });
    controllerRef.current = controller;
    // While hidden/unfocused the renderer parks with its painted last frame
    // visible; the visibility effect below resumes it when focus returns.
    if (isVisible) controller.start();

    return () => {
      controller.dispose();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
    // Brightness is deliberately excluded: it flows through updateInputs so
    // dragging the slider never re-creates particle state. isVisible is also
    // excluded — visibility suspends/resumes the renderer instead of tearing
    // it down, so an unfocused window keeps its frozen backdrop.
  }, [
    animation,
    ambientPaletteId,
    effectiveDensity,
    suspended,
    animationsEnabled,
    prefersReducedMotion,
    renderable,
    staticRenderable,
    onBattery,
  ]);

  // Visibility: suspend (frozen frame, no RAF/timers) when hidden/unfocused,
  // resume when visible again. The controller may not exist yet (created
  // while hidden) — resume is a no-op until it starts.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    if (isVisible) {
      controller.resume();
    } else {
      controller.suspend();
    }
  }, [isVisible]);

  // Brightness changes update the live renderer without re-creating it.
  useEffect(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    controller.updateInputs({
      effectId: animation ?? "",
      paletteId: ambientPaletteId,
      density,
      brightness: brightnessGain,
      environment: {
        mobile: isNativeMobile(),
        onBattery,
        reducedMotion: prefersReducedMotion,
        animationsEnabled,
        visible: isVisible,
      },
    });
  }, [brightnessGain]);

  if (!animation || suspended) return null;
  if (!renderable) return null;
  if (!staticRenderable) return null;

  return <div ref={hostRef} aria-hidden="true" className="theme-backdrop" />;
}
