import { useEffect, useState } from "react";
import type { AppearanceEnvironment } from "./resolveThemeAppearance";

/** One subscription set in ThemeProvider; surfaces share its immutable snapshot. */
export function useAppearanceEnvironment(): AppearanceEnvironment {
  const read = () => ({
    dpr: window.devicePixelRatio || 1,
    forcedColors: window.matchMedia?.("(forced-colors: active)").matches || false,
    highContrast: window.matchMedia?.("(prefers-contrast: more)").matches || false,
  });
  const [state, setState] = useState(read);
  useEffect(() => {
    const queries = [
      "(forced-colors: active)",
      "(prefers-contrast: more)",
      `(resolution: ${state.dpr}dppx)`,
    ]
      .map((q) => window.matchMedia?.(q))
      .filter(Boolean);
    const update = () => setState(read());
    queries.forEach((q) => q.addEventListener?.("change", update));
    return () => queries.forEach((q) => q.removeEventListener?.("change", update));
  }, [state.dpr]);
  const hints = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };
  return {
    ...state,
    deviceMemory: hints.deviceMemory,
    saveData: hints.connection?.saveData,
    baseUrl: document.baseURI,
  };
}
