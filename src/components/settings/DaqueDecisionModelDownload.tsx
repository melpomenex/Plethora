import React from "react";
import { Cpu, DownloadSimple, HardDrive, Trash } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { useHfModelStore } from "../../stores/useHfModelStore";
import { cn } from "../../utils";
import { LAYA_PROVIDER_ID, LOCAL_DECISION_ENGINE_PROVIDER_ID } from "../../lib/daqe/decisionModelOptions";
import {
  LAYA_CHECKPOINTS,
  installLayaCheckpoint,
  isLayaModel,
  layaInstallId,
} from "../../lib/daqe/decisionModelDownloads";

/**
 * Download a decision model's weights.
 *
 * ## What can and cannot be downloaded
 *
 * Only **Laya** has weights here, because it is the only one of the decision
 * models whose artifacts Plethora can fetch and verify: Apache 2.0, published on
 * Hugging Face, installable through the repository's existing model installer —
 * the same one that installs speech models, with the same resume, retry,
 * cancellation, SHA-256 verification and licensing capture.
 *
 * Jev, Clef and the OpenRouter decision models are *services*. There is nothing
 * to download, which is not a limitation of this panel but a fact about them: a
 * remote API is somebody else's weights.
 *
 * ## Why a checkpoint list rather than a free-text repo field
 *
 * The security model in `src-tauri/src/models/hf/security.md` fails closed on
 * artifacts whose integrity is not pinned. A user typing an arbitrary repository
 * id would bypass that gate. So this lists checkpoints that ship with a pinned
 * digest, and the download re-verifies before install.
 */
export const DaqueDecisionModelDownload = React.memo(function DaqueDecisionModelDownload({
  providerId,
}: {
  providerId: string | null;
}) {
  const { t } = useI18n();
  const decisionEngine = useSettingsStore((s) => s.settings.daqe.decisionEngine);
  const updateSettingsCategory = useSettingsStore((s) => s.updateSettingsCategory);

  const installedModels = useHfModelStore((s) => s.installedModels);
  const progress = useHfModelStore((s) => s.progress);
  const installing = useHfModelStore((s) => s.installing);
  const installState = useHfModelStore((s) => s.installState);
  const installError = useHfModelStore((s) => s.error);
  const fetchInstalled = useHfModelStore((s) => s.fetchInstalled);
  const install = useHfModelStore((s) => s.install);
  const cancelInstall = useHfModelStore((s) => s.cancelInstall);
  const uninstall = useHfModelStore((s) => s.uninstall);

  const layaInstalls = LAYA_CHECKPOINTS.map((checkpoint) => ({
    checkpoint,
    record: installedModels.find((model) => isLayaModel(model) && model.repo_id === checkpoint.repoId),
  }));

  const showFor =
    providerId === LAYA_PROVIDER_ID || providerId === LOCAL_DECISION_ENGINE_PROVIDER_ID;

  if (!showFor) return null;

  return (
    <section className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
      <div className="flex items-start gap-1.5">
        <Cpu size={13} className="mt-0.5 shrink-0 opacity-70" aria-hidden />
        <div className="min-w-0">
          <h5 className="text-xs font-medium">{t("daqeDownload.title")}</h5>
          <p className="mt-0.5 text-[11px] opacity-70">{t("daqeDownload.intro")}</p>
        </div>
      </div>

      {layaInstalls.map(({ checkpoint, record }) => {
        const installId = layaInstallId(checkpoint);
        const pct = progress[installId]?.percent ?? 0;
        const busy = installing[installId];
        return (
          <div key={checkpoint.runtime} className="space-y-1.5 rounded border border-border p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate font-mono text-[11px]">{checkpoint.repoId}</p>
                  {record ? (
                    <span className="flex items-center gap-0.5 rounded bg-emerald-500/15 px-1 py-0.5 text-[10px] text-emerald-700 dark:text-emerald-400">
                      <HardDrive size={9} aria-hidden />
                      {t("daqeDownload.installed")}
                    </span>
                  ) : null}
                  {record?.license ? (
                    <span className="rounded bg-muted/60 px-1 py-0.5 text-[10px] opacity-70">
                      {record.license}
                    </span>
                  ) : null}
                </div>
                <p className="mt-0.5 text-[10px] opacity-60">
                  {checkpoint.noteKey
                    ? t(checkpoint.noteKey)
                    : `≈ ${Math.round(checkpoint.approxBytes / 1_000_000)} MB`}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {record ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        // Point the local route at the model that is now on disk.
                        updateSettingsCategory("daqe", {
                          decisionModelProviderId: LAYA_PROVIDER_ID,
                          decisionEngine: {
                            baseUrl: decisionEngine?.baseUrl || "http://127.0.0.1:8000",
                            model: checkpoint.repoId,
                          },
                        });
                      }}
                      className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted/50"
                    >
                      {t("daqeDownload.use")}
                    </button>
                    <button
                      type="button"
                      onClick={() => void uninstall(installId)}
                      className="rounded border border-border p-1 hover:bg-muted/50"
                      title={t("daqeDownload.remove")}
                      aria-label={t("daqeDownload.remove")}
                    >
                      <Trash size={12} aria-hidden />
                    </button>
                  </>
                ) : busy ? (
                  <button
                    type="button"
                    onClick={() => void cancelInstall(layaInstallId(checkpoint))}
                    className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted/50"
                  >
                    {t("daqeDownload.cancel")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      await fetchInstalled().catch(() => {});
                      await installLayaCheckpoint({ checkpoint, install });
                    }}
                    className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[10px] hover:bg-muted/50"
                  >
                    <DownloadSimple size={11} aria-hidden />
                    {t("daqeDownload.download")}
                  </button>
                )}
              </div>
            </div>

            {busy || pct > 0 ? (
              <div className="space-y-0.5">
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-[width]"
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
                <p className="text-[10px] opacity-60">
                  {progress[installId]?.received !== undefined
                    ? `${formatBytes(progress[installId].received)} / ${formatBytes(
                        progress[installId].total ?? 0,
                      )}`
                    : t("daqeDownload.preparing")}
                </p>
              </div>
            ) : null}

            {installState === "error" && installError ? (
              <p className={cn("text-[10px]", "text-red-600 dark:text-red-400")}>{installError}</p>
            ) : null}
          </div>
        );
      })}

      <p className="text-[10px] opacity-60">{t("daqeDownload.serverNote")}</p>
    </section>
  );
});

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} kB`;
  if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}