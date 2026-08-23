import { useI18n } from "../../lib/i18n";

/** Privacy indicator for on-device generation results (OpenSpec A). */
export function OnDeviceProcessingBadge({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <span
      data-testid="on-device-processing-badge"
      className={`inline-flex items-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300 ${className}`}
    >
      {t("onDeviceAi.processingOnDevice")}
    </span>
  );
}
