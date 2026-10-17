import { createContext, useContext } from "react";
import type { ResolvedThemeAppearance } from "./resolveThemeAppearance";
export const ResolvedAppearanceContext = createContext<ResolvedThemeAppearance | null>(null);
/** Null outside a theme provider keeps independent embed/test surfaces usable. */
export function useResolvedThemeAppearance() {
  return useContext(ResolvedAppearanceContext);
}
