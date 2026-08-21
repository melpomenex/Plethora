import { useMemo } from "react";
import { Minus, Square, X } from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { normalizePane, useTabsStore } from "../../../stores";
import type { Pane } from "../../../stores/tabsStore";
import {
  handleWindowDragRequest,
  isCustomChromeDragActive,
} from "../../../lib/windowDrag";

export const handleLinuxWindowDrag = handleWindowDragRequest;

function findTopRightPaneId(pane: Pane): string | null {
  if (pane.type === "tabs") return pane.id;

  const children =
    pane.direction === "horizontal"
      ? [...pane.children].reverse()
      : pane.children;

  for (const child of children) {
    const id = findTopRightPaneId(child);
    if (id) return id;
  }

  return null;
}

function runWindowAction(
  label: string,
  action: () => Promise<void>,
): void {
  void action().catch((error) => {
    console.error(`[LinuxWindowControls] ${label} failed`, error);
  });
}

interface LinuxWindowControlsProps {
  paneId?: string;
  compact: boolean;
}

export function LinuxWindowControls({
  paneId,
  compact,
}: LinuxWindowControlsProps) {
  const rawRootPane = useTabsStore((state) => state.rootPane);

  const topRightPaneId = useMemo(() => {
    const root = normalizePane(rawRootPane);
    return findTopRightPaneId(root);
  }, [rawRootPane]);

  if (
    !paneId ||
    paneId !== topRightPaneId ||
    !isCustomChromeDragActive()
  ) {
    return null;
  }

  const appWindow = getCurrentWindow();

  const size = compact
    ? "w-7 min-h-[28px]"
    : "w-10 min-h-[44px]";

  const base = `
    ${size}
    flex items-center justify-center
    flex-shrink-0
    text-muted-foreground
    transition-colors
    focus-visible:outline-none
    focus-visible:ring-1
    focus-visible:ring-inset
    focus-visible:ring-primary
  `;

  const icon = compact ? "w-3 h-3" : "w-3.5 h-3.5";

  return (
    <div
      className="
        flex self-stretch flex-shrink-0 items-stretch
        border-l border-border bg-card
      "
    >
      <button
        type="button"
        className={`${base} hover:bg-muted hover:text-foreground`}
        onClick={() =>
          runWindowAction("minimize", () => appWindow.minimize())
        }
        aria-label="Minimize window"
        title="Minimize"
      >
        <Minus className={icon} weight="bold" />
      </button>

      <button
        type="button"
        className={`${base} hover:bg-muted hover:text-foreground`}
        onClick={() =>
          runWindowAction(
            "toggle maximize",
            () => appWindow.toggleMaximize(),
          )
        }
        aria-label="Maximize or restore window"
        title="Maximize / Restore"
      >
        <Square className={icon} />
      </button>

      <button
        type="button"
        className={`
          ${base}
          hover:bg-destructive
          hover:text-destructive-foreground
        `}
        onClick={() =>
          runWindowAction("close", () => appWindow.close())
        }
        aria-label="Close window"
        title="Close"
      >
        <X className={icon} weight="bold" />
      </button>
    </div>
  );
}
