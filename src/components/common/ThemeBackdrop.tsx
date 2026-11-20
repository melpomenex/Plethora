import { useEffect, useRef, useState } from "react";
import { useTheme } from "../../contexts/ThemeContext";
import { useSettingsStore } from "../../stores/settingsStore";
import { useBattery } from "../../contexts/BatteryContext";
import { usePresentation } from "../../contexts/PresentationContext";
import { isNativeMobile } from "../../lib/tauri";
import { AnimatedFrameBackdrop } from "./animatedImage/AnimatedFrameBackdrop";
import {
  createBackdropRenderer,
  type BackdropController,
} from "./ambient/renderer/createThemeRenderer";
import { findEffect } from "./ambient/renderer/effects";
import type { RendererInputs } from "./ambient/renderer/types";
import { loadBackdropImage } from "../../themes/imageStorage";
import {
  animatedImagePosterKey,
  loadAnimatedImagePack,
  loadAnimatedImagePoster,
} from "../../themes/animatedImage/storage";
import type { AnimatedImagePack } from "../../themes/animatedImage/contracts";

function mediaIdFromPosterKey(imageId: string): string | null {
  return /^media:v1:(anim-[a-z0-9-]{8,64}):poster$/.exec(imageId)?.[1] ?? null;
}

/**
 * Ambient animated backdrop. React owns lifecycle and environment state; the
 * renderer layer (ambient/renderer) owns drawing, backends (WebGL2 preferred,
 * Canvas2D fallback), quality policy and frame scheduling. Renderers create
 * their own canvas element inside the host div below.
 */
export function ThemeBackdrop() {
  const {
    theme,
    appliedTheme,
    themes = [],
    previewThemeId = null,
    animatedImagePreview = null,
  } = useTheme();
  const activeTheme =
    appliedTheme ||
    (previewThemeId !== null && themes.find((t) => t.id === previewThemeId)) ||
    theme;
  const settings = useSettingsStore((s) => s.settings.interface);
  const presentation = usePresentation();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<BackdropController | null>(null);
  const [suspended, setSuspended] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(!document.hidden);
  const [windowFocused, setWindowFocused] = useState(true);
  const isVisible = documentVisible && windowFocused;
  const [resolvedImage, setResolvedImage] = useState<{ key: string; src: string } | null>(null);
  const [resolvedPack, setResolvedPack] = useState<{
    mediaId: string;
    tier: "desktop" | "mobile";
    pack: AnimatedImagePack | null;
  } | null>(null);

  const animation = activeTheme.effects?.backgroundAnimation;
  const bgImage = activeTheme.effects?.backgroundImage;
  const previewAsset =
    animatedImagePreview !== null &&
    animatedImagePreview.theme.id === activeTheme.id &&
    bgImage?.imageId === animatedImagePosterKey(animatedImagePreview.prepared.mediaId)
      ? animatedImagePreview.prepared
      : null;
  const ambientPaletteId = activeTheme.effects?.ambientPaletteId ?? activeTheme.id;
  const { onBattery, battery } = useBattery();
  const nativeMobile = isNativeMobile();
  const mobileTier = nativeMobile || presentation.isMobileShell;
  const imageAnimation = activeTheme.effects?.imageAnimation;
  const imageMediaId = bgImage?.imageId ? mediaIdFromPosterKey(bgImage.imageId) : null;
  const imagePackTier = mobileTier ? "mobile" : "desktop";
  const mobilePowerAllowsPlayback = !nativeMobile || (battery.isPresent && battery.isCharging);
  const animatedImagePlaybackAllowed = Boolean(
    imageAnimation?.enabled &&
    imageAnimation.sourceFormat === "gif" &&
    imageAnimation.mediaId === imageMediaId &&
    settings.animationsEnabled &&
    !settings.reducedMotionForce &&
    !presentation.reducedMotion &&
    !presentation.isEinkMode &&
    mobilePowerAllowsPlayback
  );
  const activePack = resolvedPack?.mediaId === imageMediaId && resolvedPack.tier === imagePackTier
    ? resolvedPack.pack
    : null;
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
      setDocumentVisible(!document.hidden);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Tauri focus change: also pause when the app window loses focus
    let disposed = false;
    let unlistenFocus: (() => void) | null = null;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        const unlisten = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          setWindowFocused(Boolean(focused));
        });
        if (disposed) unlisten();
        else unlistenFocus = unlisten;
      } catch {
        // Not in Tauri environment, document.visibilitychange is sufficient
      }
    })();

    return () => {
      disposed = true;
      window.removeEventListener("plethora-theme-backdrop-suspend", handleSuspend as EventListener);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      unlistenFocus?.();
    };
  }, []);

  useEffect(() => {
    if (!imageMediaId || !animatedImagePlaybackAllowed) {
      setResolvedPack(null);
      return;
    }
    if (previewAsset) {
      setResolvedPack({ mediaId: imageMediaId, tier: imagePackTier, pack: previewAsset.pack ?? null });
      return;
    }
    let cancelled = false;
    void loadAnimatedImagePack(imageMediaId, imagePackTier).then(({ pack }) => {
      if (!cancelled) setResolvedPack({ mediaId: imageMediaId, tier: imagePackTier, pack });
    }).catch(() => {
      if (!cancelled) setResolvedPack({ mediaId: imageMediaId, tier: imagePackTier, pack: null });
    });
    return () => { cancelled = true; };
  }, [imageMediaId, imagePackTier, animatedImagePlaybackAllowed, previewAsset]);

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

  useEffect(() => {
    if (!bgImage?.imageId) {
      setResolvedImage(null);
      return;
    }
    if (previewAsset) {
      let objectUrl: string | null = null;
      try {
        objectUrl = URL.createObjectURL(previewAsset.poster);
        setResolvedImage({ key: bgImage.imageId, src: objectUrl });
      } catch {
        setResolvedImage(null);
      }
      return () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
    const mediaId = mediaIdFromPosterKey(bgImage.imageId);
    if (mediaId) {
      let cancelled = false;
      let objectUrl: string | null = null;
      loadAnimatedImagePoster(mediaId).then(({ poster }) => {
        if (cancelled) return;
        if (!poster) {
          setResolvedImage(null);
          return;
        }
        try {
          objectUrl = URL.createObjectURL(poster);
          setResolvedImage({ key: bgImage.imageId, src: objectUrl });
        } catch {
          setResolvedImage(null);
        }
      }).catch(() => {
        if (!cancelled) setResolvedImage(null);
      });
      return () => {
        cancelled = true;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
    let cancelled = false;
    loadBackdropImage(bgImage.imageId).then((url) => {
      if (!cancelled) {
        setResolvedImage(url ? { key: bgImage.imageId, src: url } : null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [bgImage?.imageId, bgImage?.thumbnailDataUrl, previewAsset]);

  if (suspended && !bgImage?.imageId) return null;

  if (bgImage?.imageId) {
    const src =
      (resolvedImage?.key === bgImage.imageId ? resolvedImage.src : null) ||
      bgImage.thumbnailDataUrl;
    if (!src) return null;
    const blurPx = bgImage.blur ?? 6;
    const brightness = bgImage.brightness ?? 0.95;
    const scrimOpacity = bgImage.scrimOpacity ?? 0.52;
    const bgHex = activeTheme.colors?.background || "#121426";
    const imageFilter = `blur(${blurPx}px) brightness(${brightness}) saturate(1.08)`;
    const imageTransform = "scale(1.06)";
    const canPlayImage = animatedImagePlaybackAllowed && activePack !== null;
    return (
      <div aria-hidden="true" className="theme-backdrop">
        {canPlayImage && activePack ? (
          <AnimatedFrameBackdrop
            pack={activePack}
            posterSrc={src}
            visible={isVisible && !suspended}
            mobile={mobileTier}
            filter={imageFilter}
            transform={imageTransform}
          />
        ) : (
          <img
            src={src}
            alt=""
            className="h-full w-full object-cover"
            style={{
              objectPosition: bgImage.position || "center",
              filter: imageFilter,
              transform: imageTransform,
            }}
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            backgroundColor: bgHex,
            opacity: scrimOpacity,
          }}
        />
        <div
          className="absolute inset-0"
          style={{
            background:
              activeTheme.variant === "dark"
                ? "radial-gradient(ellipse at center, transparent 35%, rgba(0, 0, 0, 0.42) 100%)"
                : "radial-gradient(ellipse at center, transparent 40%, rgba(255, 255, 255, 0.25) 100%)",
          }}
        />
      </div>
    );
  }

  if (!animation) return null;
  if (!renderable) return null;
  if (!staticRenderable) return null;

  return <div ref={hostRef} aria-hidden="true" className="theme-backdrop" />;
}
