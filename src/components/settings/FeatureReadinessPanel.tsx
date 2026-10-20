/**
 * Per-feature readiness rows for AI Settings (F0 tasks 1.3 / 2.1-2.3).
 *
 * Presentation only. It reads the shared, revision-keyed readiness snapshot
 * and offers typed recovery routes. It never starts a download, an index job,
 * inference or a settings change.
 */

import { ArrowsClockwise, CheckCircle, WarningCircle, XCircle } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import {
  FEATURE_METADATA,
  type FeatureDependency,
  type FeatureReadiness,
  type FeatureStatus,
  type RecoveryAction,
} from "../../lib/ai/features/types";
import { summarizeActivation } from "../../lib/ai/features/registry";
import { useFeatureReadiness } from "../../lib/ai/features/useFeatureReadiness";
import { SettingsSearchTarget } from "./search/SettingsSearchNavigation";

const STATUS_COPY: Record<FeatureStatus, { key: string; tone: string; Icon: typeof CheckCircle }> = {
  checking: { key: "ai.feature.status.checking", tone: "text-muted-foreground", Icon: ArrowsClockwise },
  disabled: { key: "ai.feature.status.disabled", tone: "text-muted-foreground", Icon: XCircle },
  ready: { key: "ai.feature.status.ready", tone: "text-green-600 dark:text-green-400", Icon: CheckCircle },
  "setup-required": { key: "ai.feature.status.setupRequired", tone: "text-amber-600 dark:text-amber-400", Icon: WarningCircle },
  "model-download-required": { key: "ai.feature.status.modelDownloadRequired", tone: "text-amber-600 dark:text-amber-400", Icon: WarningCircle },
  indexing: { key: "ai.feature.status.indexing", tone: "text-sky-600 dark:text-sky-400", Icon: ArrowsClockwise },
  "unavailable-platform": { key: "ai.feature.status.unavailablePlatform", tone: "text-muted-foreground", Icon: XCircle },
  error: { key: "ai.feature.status.error", tone: "text-destructive", Icon: WarningCircle },
};

function uniqueDependencies(rows: readonly FeatureReadiness[]): FeatureDependency[] {
  const seen = new Map<string, FeatureDependency>();
  for (const row of rows) {
    for (const dep of row.dependencies) {
      if (dep.state === "satisfied") continue;
      const previous = seen.get(dep.code);
      if (!previous || previous.state !== dep.state) seen.set(dep.code, dep);
    }
  }
  return [...seen.values()];
}

function uniqueRecovery(rows: readonly FeatureReadiness[]): RecoveryAction[] {
  const seen = new Map<string, RecoveryAction>();
  for (const row of rows) {
    for (const action of row.recoveryActions) {
      if (!seen.has(action.targetId)) seen.set(action.targetId, action);
    }
  }
  return [...seen.values()];
}

interface FeatureReadinessPanelProps {
  /** Navigation-only recovery handler. Returns false when not mounted here. */
  onRecover?: (action: RecoveryAction) => void;
  /** Opens the existing AI Diagnostics modal (target ai.diagnostics). */
  onOpenDiagnostics?: () => void;
}

export function FeatureReadinessPanel({
  onRecover,
  onOpenDiagnostics,
}: FeatureReadinessPanelProps) {
  const { t } = useI18n();
  const { rows, loading, checkedAt, refresh } = useFeatureReadiness();
  const summary = summarizeActivation(rows);
  const dependencies = uniqueDependencies(rows);
  const recovery = uniqueRecovery(rows);

  return (
    <SettingsSearchTarget
      id="ai.featureReadiness"
      label={t("ai.feature.readiness.title")}
      className="space-y-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-foreground">
            {t("ai.feature.readiness.title")}
          </h4>
          <p className="text-xs text-muted-foreground">
            {t("ai.feature.readiness.description")}
          </p>
        </div>
        <button
          type="button"
          onClick={refresh}
          className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label={t("ai.feature.readiness.refresh")}
        >
          <ArrowsClockwise className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <p className="text-xs text-muted-foreground" aria-live="polite">
        {loading || !checkedAt
          ? t("ai.feature.readiness.checking")
          : t("ai.feature.readiness.summary", {
              ready: summary.ready,
              total: summary.total,
              setup: summary.needsSetup,
            })}
      </p>

      <ul className="space-y-2">
        {rows.map((row) => {
          const displayStatus: FeatureStatus = row.checking ? "checking" : row.status;
          const copy = STATUS_COPY[displayStatus];
          const { Icon } = copy;
          const metadata = FEATURE_METADATA[row.featureId];
          const blockers = row.dependencies.filter(
            (dep) => dep.state !== "satisfied" && dep.state !== "degraded"
          );
          return (
            <li
              key={row.featureId}
              className="p-2.5 rounded-lg border border-border bg-muted/10"
              data-feature-id={row.featureId}
              data-feature-status={row.status}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                  {t(metadata.labelKey)}
                </span>
                <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${copy.tone}`}>
                  <Icon className="w-3.5 h-3.5" aria-hidden />
                  {t(copy.key)}
                </span>
              </div>
              {blockers.length > 0 && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {blockers
                    .map((dep) => t(dep.reasonKey ?? `ai.feature.dependency.${dep.code}`))
                    .join(" · ")}
                </p>
              )}
              {row.limitations.length > 0 && (
                <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                  {row.limitations.map((limitation) => t(limitation)).join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {dependencies.length > 0 && (
        <div className="text-[11px] text-muted-foreground">
          {t("ai.feature.readiness.blockers", {
            count: dependencies.length,
          })}
        </div>
      )}

      {recovery.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {recovery.map((action) => (
            <button
              key={action.targetId}
              type="button"
              onClick={() => {
                if (action.targetId === "ai.diagnostics") {
                  onOpenDiagnostics?.();
                  return;
                }
                onRecover?.(action);
              }}
              className="px-2.5 py-1 text-xs bg-muted text-foreground border border-border rounded-lg hover:bg-muted/80 transition-colors"
            >
              {t(action.labelKey)}
            </button>
          ))}
        </div>
      )}
    </SettingsSearchTarget>
  );
}
