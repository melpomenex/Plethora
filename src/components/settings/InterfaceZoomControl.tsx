/**
 * Interface Zoom Settings control (change: desktop-global-interface-zoom).
 *
 * Renders only the inner control group; `AppearanceSettings` owns the
 * `SettingsRow` wrapper. Deliberately does not import `SettingsPage` to avoid
 * a static circular import. All actions go through the shared controller, so
 * Settings, shortcuts, and the Command Palette cannot diverge.
 */

import { useCallback, useState } from "react";
import { ArrowsInSimple, Minus, Plus } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { useInterfaceZoomState } from "../../hooks/useInterfaceZoom";
import {
  INTERFACE_ZOOM_MAX,
  INTERFACE_ZOOM_MIN,
  INTERFACE_ZOOM_STEP,
} from "../../lib/interfaceZoom/constants";
import {
  resetInterfaceZoom,
  setInterfaceZoomPercent,
  zoomInterfaceIn,
  zoomInterfaceOut,
} from "../../lib/interfaceZoom/controller";

const CONTROL_BUTTON_CLASS =
  "inline-flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-background text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40";

export function InterfaceZoomControl() {
  const { t } = useI18n();
  const { percent, supported, applying, error, canIncrease, canDecrease, canReset } =
    useInterfaceZoomState();
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);

  const run = useCallback((action: () => void) => {
    setRetryAction(() => action);
    action();
  }, []);

  if (!supported) {
    return (
      <p
        role="status"
        className="max-w-md text-sm text-muted-foreground"
      >
        {t("settings.interfaceZoomUnsupported")}
      </p>
    );
  }

  return (
    <div
      role="group"
      aria-label={t("settings.interfaceZoom")}
      className="flex flex-col gap-2 sm:items-end"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => run(zoomInterfaceOut)}
          disabled={!canDecrease || applying}
          aria-label={t("settings.interfaceZoomDecrease")}
          title={t("settings.interfaceZoomDecrease")}
          className={CONTROL_BUTTON_CLASS}
        >
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>

        <input
          type="range"
          min={INTERFACE_ZOOM_MIN}
          max={INTERFACE_ZOOM_MAX}
          step={INTERFACE_ZOOM_STEP}
          value={percent}
          onChange={(event) => {
            const target = Number(event.target.value);
            run(() => setInterfaceZoomPercent(target));
          }}
          disabled={applying}
          aria-label={t("settings.interfaceZoom")}
          aria-valuetext={`${percent}%`}
          className="h-11 w-40 max-w-full accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
        />

        <button
          type="button"
          onClick={() => run(zoomInterfaceIn)}
          disabled={!canIncrease || applying}
          aria-label={t("settings.interfaceZoomIncrease")}
          title={t("settings.interfaceZoomIncrease")}
          className={CONTROL_BUTTON_CLASS}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>

        <output
          aria-live="polite"
          aria-atomic="true"
          className="min-w-16 text-right text-sm font-medium tabular-nums text-foreground"
        >
          {percent}%
        </output>
      </div>

      <button
        type="button"
        onClick={() => run(resetInterfaceZoom)}
        disabled={!canReset || applying}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ArrowsInSimple className="h-4 w-4" aria-hidden="true" />
        {t("settings.interfaceZoomReset")}
      </button>

      {error ? (
        <div
          role="status"
          className="flex max-w-md flex-wrap items-center gap-2 text-xs text-destructive"
        >
          <span>{t("settings.interfaceZoomError")}</span>
          <button
            type="button"
            onClick={() => {
              if (retryAction) retryAction();
              else zoomInterfaceIn();
            }}
            className="min-h-11 rounded-lg px-2 font-medium underline underline-offset-2 hover:text-destructive/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t("common.retry")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
