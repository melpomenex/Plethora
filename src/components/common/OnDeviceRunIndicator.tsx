/**
 * Progress strip for a multi-chunk on-device AI run.
 *
 * Only appears while more than one chunk is in flight — a single-chunk run
 * finishes fast enough that a banner would flash and vanish.
 */

import { CircleNotch } from "@phosphor-icons/react";
import { useOnDeviceRunStore } from "../../lib/ai/onDeviceRunStore";
import { useI18n } from "../../lib/i18n";

export function OnDeviceRunIndicator() {
  const { t } = useI18n();
  const label = useOnDeviceRunStore((s) => s.label);
  const chunk = useOnDeviceRunStore((s) => s.chunk);
  const total = useOnDeviceRunStore((s) => s.total);
  const cancel = useOnDeviceRunStore((s) => s.cancel);

  if (!label || total <= 1) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-2.5 shadow-lg"
    >
      <CircleNotch className="w-4 h-4 animate-spin text-primary" />
      <span className="text-sm text-foreground">
        {t("onDeviceAi.chunkProgress", { label, chunk, total })}
      </span>
      {cancel && (
        <button
          onClick={cancel}
          className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("onDeviceAi.cancel")}
        </button>
      )}
    </div>
  );
}
