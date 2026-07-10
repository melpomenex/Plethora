import type { ReactNode } from "react";
import { useVisualViewport } from "../../hooks/useVisualViewport";

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
      {children}
    </div>
  );
}

