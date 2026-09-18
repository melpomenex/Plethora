import { useSettingsStore } from "../stores/settingsStore";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  classifyPresentation,
  presentationUsesMobileShell,
  type PointerType,
  type PresentationMode,
} from "../lib/presentation";
import {
  getPlatform,
  isNativeMobile,
  isNativePhone,
  isTauri,
  nativePlatform,
} from "../lib/tauri";
import {
  loadSavedDisplayMode,
  resolveEffectiveEinkMode,
  saveDisplayMode,
} from "../lib/displayMode";
import type { DisplayMode } from "../types/display";

export interface PresentationState {
  mode: PresentationMode;
  platform: string;
  pointer: PointerType;
  reducedMotion: boolean;
  isMobileShell: boolean;
  viewportWidth: number;
  viewportHeight: number;
  displayMode: DisplayMode;
  isEinkMode: boolean;
  setDisplayMode: (mode: DisplayMode) => void;
}

const PresentationContext = createContext<PresentationState | null>(null);

function normalizePlatform(): string {
  const native = nativePlatform();
  if (native === "macos") return "mac";
  if (native) return native;
  return getPlatform();
}

export function readPresentationState(customDisplayMode?: DisplayMode): Omit<PresentationState, "setDisplayMode"> {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const mode = classifyPresentation({
    viewportWidth,
    viewportHeight,
    isTauri: isTauri(),
    isNativeMobile: isNativeMobile(),
    isNativePhone: isNativePhone(),
  });
  const pointer: PointerType = window.matchMedia?.("(pointer: coarse)").matches
    ? "coarse"
    : "fine";
  const displayMode = customDisplayMode ?? loadSavedDisplayMode();
  const isEinkMode = resolveEffectiveEinkMode(displayMode);
  const reducedMotion =
    isEinkMode ||
    Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

  return {
    mode,
    platform: normalizePlatform(),
    pointer,
    reducedMotion,
    isMobileShell: presentationUsesMobileShell(mode),
    viewportWidth,
    viewportHeight,
    displayMode,
    isEinkMode,
  };
}

function samePresentation(
  a: Omit<PresentationState, "setDisplayMode">,
  b: Omit<PresentationState, "setDisplayMode">
): boolean {
  return (
    a.mode === b.mode &&
    a.platform === b.platform &&
    a.pointer === b.pointer &&
    a.reducedMotion === b.reducedMotion &&
    a.viewportWidth === b.viewportWidth &&
    a.viewportHeight === b.viewportHeight &&
    a.displayMode === b.displayMode &&
    a.isEinkMode === b.isEinkMode
  );
}

export function PresentationProvider({ children }: { children: ReactNode }) {
  const animationsEnabled = useSettingsStore((s) => s.settings.interface.animationsEnabled);
  useEffect(() => {
    document.documentElement.dataset.animations = animationsEnabled ? "on" : "off";
    return () => { delete document.documentElement.dataset.animations; };
  }, [animationsEnabled]);
  const [displayMode, setDisplayModeState] = useState<DisplayMode>(() =>
    loadSavedDisplayMode()
  );
  const [state, setState] = useState<Omit<PresentationState, "setDisplayMode">>(() =>
    readPresentationState(displayMode)
  );

  const setDisplayMode = useCallback((mode: DisplayMode) => {
    saveDisplayMode(mode);
    setDisplayModeState(mode);
    const next = readPresentationState(mode);
    setState((current) => (samePresentation(current, next) ? current : next));
  }, []);

  useEffect(() => {
    let rafId: number | null = null;
    const coarseQuery = window.matchMedia?.("(pointer: coarse)");
    const motionQuery = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    );

    const recompute = () => {
      rafId = null;
      const next = readPresentationState(displayMode);
      setState((current) => (samePresentation(current, next) ? current : next));
    };

    const schedule = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(recompute);
    };

    window.addEventListener("resize", schedule);
    window.addEventListener("orientationchange", schedule);
    coarseQuery?.addEventListener?.("change", schedule);
    motionQuery?.addEventListener?.("change", schedule);

    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("orientationchange", schedule);
      coarseQuery?.removeEventListener?.("change", schedule);
      motionQuery?.removeEventListener?.("change", schedule);
    };
  }, [displayMode]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.presentation = state.mode;
    root.dataset.platform = state.platform;
    root.dataset.pointer = state.pointer;
    root.dataset.reducedMotion = String(state.reducedMotion);
    if (state.isEinkMode) {
      root.dataset.displayMode = "eink";
    } else {
      delete root.dataset.displayMode;
    }
    return () => {
      delete root.dataset.presentation;
      delete root.dataset.platform;
      delete root.dataset.pointer;
      delete root.dataset.reducedMotion;
      delete root.dataset.displayMode;
    };
  }, [state.mode, state.platform, state.pointer, state.reducedMotion, state.isEinkMode]);

  const value: PresentationState = useMemo(
    () => ({
      ...state,
      setDisplayMode,
    }),
    [state, setDisplayMode]
  );

  return (
    <PresentationContext.Provider value={value}>
      {children}
    </PresentationContext.Provider>
  );
}

export function usePresentation(): PresentationState {
  const context = useContext(PresentationContext);
  if (!context) {
    const current = readPresentationState();
    return {
      ...current,
      setDisplayMode: (mode: DisplayMode) => {
        saveDisplayMode(mode);
      },
    };
  }
  return context;
}

export function usePresentationMode(): PresentationMode {
  return usePresentation().mode;
}

export function useIsEink(): boolean {
  return usePresentation().isEinkMode;
}


