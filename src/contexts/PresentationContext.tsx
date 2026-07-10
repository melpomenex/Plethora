import {
  createContext,
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

export interface PresentationState {
  mode: PresentationMode;
  platform: string;
  pointer: PointerType;
  reducedMotion: boolean;
  isMobileShell: boolean;
  viewportWidth: number;
  viewportHeight: number;
}

const PresentationContext = createContext<PresentationState | null>(null);

function normalizePlatform(): string {
  const native = nativePlatform();
  if (native === "macos") return "mac";
  if (native) return native;
  return getPlatform();
}

export function readPresentationState(): PresentationState {
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
  const reducedMotion = Boolean(
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
  );

  return {
    mode,
    platform: normalizePlatform(),
    pointer,
    reducedMotion,
    isMobileShell: presentationUsesMobileShell(mode),
    viewportWidth,
    viewportHeight,
  };
}

function samePresentation(a: PresentationState, b: PresentationState): boolean {
  return (
    a.mode === b.mode &&
    a.platform === b.platform &&
    a.pointer === b.pointer &&
    a.reducedMotion === b.reducedMotion &&
    a.viewportWidth === b.viewportWidth &&
    a.viewportHeight === b.viewportHeight
  );
}

export function PresentationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PresentationState>(() =>
    readPresentationState(),
  );

  useEffect(() => {
    let rafId: number | null = null;
    const coarseQuery = window.matchMedia?.("(pointer: coarse)");
    const motionQuery = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    );

    const recompute = () => {
      rafId = null;
      const next = readPresentationState();
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
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.presentation = state.mode;
    root.dataset.platform = state.platform;
    root.dataset.pointer = state.pointer;
    root.dataset.reducedMotion = String(state.reducedMotion);
    return () => {
      delete root.dataset.presentation;
      delete root.dataset.platform;
      delete root.dataset.pointer;
      delete root.dataset.reducedMotion;
    };
  }, [state.mode, state.platform, state.pointer, state.reducedMotion]);

  const value = useMemo(() => state, [state]);
  return (
    <PresentationContext.Provider value={value}>
      {children}
    </PresentationContext.Provider>
  );
}

export function usePresentation(): PresentationState {
  const context = useContext(PresentationContext);
  return context ?? readPresentationState();
}

export function usePresentationMode(): PresentationMode {
  return usePresentation().mode;
}

