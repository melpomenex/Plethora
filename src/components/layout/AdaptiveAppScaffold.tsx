import type { ReactNode } from "react";
import { useVisualViewport } from "../../hooks/useVisualViewport";
import { ThemeBackdrop } from "../common/ThemeBackdrop";

export function AdaptiveAppScaffold({
  children,
  mobile,
  fullscreen,
}: {
  children: ReactNode;
  mobile: boolean;
  fullscreen: boolean;
}) {
  useVisualViewport();
  return (
    <div
      className="adaptive-shell-root"
      data-mobile-shell={mobile ? "true" : "false"}
      data-fullscreen={fullscreen ? "true" : "false"}
    >
      <ThemeBackdrop />
      <div className="relative z-10 flex h-full min-h-0 w-full flex-col">
        {children}
      </div>
    </div>
  );
}
