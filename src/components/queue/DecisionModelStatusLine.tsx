import { cn } from "../../utils";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  decisionModelLiveState,
  type DecisionModelStatus,
} from "../../lib/daqe/decisionModelProbe";
import { Check, Info, Warning, X } from "@phosphor-icons/react";

/**
 * What is actually ranking this queue, right now.
 *
 * ## Why this exists
 *
 * A configured decision model that is *failing* is the worst state in this
 * feature, because nothing looks broken: the picker says "ready", the queue
 * reorders happily, and every model-derived term silently falls back to a
 * per-item-type default. A reader who paid for a model has no way to tell.
 *
 * So the effective state is stated where the ranking is visible, and `degraded`
 * says plainly what is being used instead. It is deliberately not hidden behind
 * settings.
 *
 * The honest ceiling: this reports the last *probe*, so between probes it is up
 * to thirty minutes stale. That expiry is intentional — a green tick that
 * outlived an outage would be worse than admitting we do not know — and the
 * ranking calls themselves degrade per term, which the score breakdown already
 * shows.
 */
export function DecisionModelStatusLine({
  status,
  className,
}: {
  status: DecisionModelStatus;
  className?: string;
}) {
  const { t } = useI18n();
  const rankingEnabled = useSettingsStore((s) => s.settings.daqe.rankingEnabled);

  if (!rankingEnabled) {
    return (
      <Line tone="off" icon={<Info size={12} aria-hidden />} className={className}>
        {t("daqeStatus.rankingOff")}
      </Line>
    );
  }

  const live = decisionModelLiveState(status);

  if (live === "working") {
    return (
      <Line tone="ok" icon={<Check size={12} weight="bold" aria-hidden />} className={className}>
        {t("daqeStatus.working")}
      </Line>
    );
  }

  if (live === "degraded") {
    return (
      <Line tone="bad" icon={<Warning size={12} aria-hidden />} className={className}>
        {t("daqeStatus.degraded")}
      </Line>
    );
  }

  return (
    <Line tone="off" icon={<X size={12} aria-hidden />} className={className}>
      {status.configured ? t("daqeStatus.untested") : t("daqeStatus.unconfigured")}
    </Line>
  );
}

function Line({
  tone,
  icon,
  children,
  className,
}: {
  tone: "ok" | "bad" | "off";
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "flex items-center gap-1.5 text-[11px]",
        tone === "ok" && "text-emerald-700 dark:text-emerald-400",
        tone === "bad" && "text-amber-600 dark:text-amber-400",
        tone === "off" && "opacity-60",
        className,
      )}
    >
      {icon}
      <span>{children}</span>
    </p>
  );
}
