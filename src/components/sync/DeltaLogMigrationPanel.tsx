import { useEffect, useMemo, useState } from "react";
import { CheckCircle, Warning, ArrowsClockwise } from "@phosphor-icons/react";
import { useI18n } from "../../lib/i18n";
import { useModal } from "../common/Modal";
import { useSettingsStore } from "../../stores/settingsStore";
import { getSyncRoomId } from "../../lib/yjsSync";
import { getCachedSubKeys } from "../../lib/sync/roomCrypto";
import { deriveDeltaLogUrls } from "../../lib/sync/deltaLog/urls";
import { head, type DeltaLogClientConfig, type DeltaLogDeviceEntry } from "../../lib/sync/deltaLog/client";
import {
  getCutoverPhase,
  runCutoverPhase,
  retireYjs,
  type CutoverPhase,
} from "../../lib/sync/cutover";
import { getSyncCutoverDomainProgress, drainSyncOutboxBatch } from "../../lib/sync/syncJournal";

const PHASE_LABELS: Record<CutoverPhase, string> = {
  not_started: "Not started",
  drained: "Drained (Yjs history caught up locally)",
  seeded: "Seeded (local data pushed to the new sync service)",
  dual: "Dual-running (writing to both the old and new sync)",
  verified: "Verified (all devices agree)",
  cutover: "Cut over (writing to the new sync only)",
  quiesced: "Quiesced (old sync confirmed idle)",
  retired: "Retired (old sync fully removed)",
};

interface DomainProgressRow {
  domain: string;
  drainedCount: number;
  seededCount: number;
  updatedAt: string;
}

/**

 Migration status panel (task 7.1-7.3). Only meaningful once deltaLogSync is
 enabled for this room — SyncSettings.tsx renders this conditionally on that
 flag, so a user who hasn't opted in never sees a partially-wired panel.

 Deliberately reads live state on mount/refresh rather than subscribing to
 push updates — the cutover phase changes at most a few times over the
 whole migration, not something that needs a live socket.

*/
export function DeltaLogMigrationPanel() {
  const { t } = useI18n();
  // Renamed on destructure: the noNativeDialogs guard flags any bare
  // `confirm(` call textually (it can't distinguish this from the native
  // global), so `confirmModal` avoids a false positive there too.
  const { confirm: confirmModal } = useModal();
  const { settings } = useSettingsStore();
  const syncUrl = settings.sync?.yjs?.url;
  const [phase, setPhase] = useState<CutoverPhase | null>(null);
  const [domainProgress, setDomainProgress] = useState<DomainProgressRow[]>([]);
  const [devices, setDevices] = useState<DeltaLogDeviceEntry[] | null>(null);
  const [rosterError, setRosterError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [backedUpConfirmed, setBackedUpConfirmed] = useState(false);

  const room = useMemo(() => getSyncRoomId(), []);

  const refresh = async () => {
    setLoading(true);
    setRosterError(null);
    try {
      const [currentPhase, progress] = await Promise.all([
        getCutoverPhase(room),
        getSyncCutoverDomainProgress(room),
      ]);
      setPhase(currentPhase);
      setDomainProgress(
        progress
          .filter((row) => !row.domain.startsWith("__")) // hide synthetic bookkeeping rows (__yjs-activity, __verify)
          .map((row) => ({
            domain: row.domain,
            drainedCount: row.drainedCount,
            seededCount: row.seededCount,
            updatedAt: row.updatedAt,
          })),
      );

      const subKeys = await getCachedSubKeys(room);
      if (subKeys && syncUrl) {
        const { httpBase, wsBase } = deriveDeltaLogUrls(syncUrl);
        const config: DeltaLogClientConfig = { httpBase, wsBase, room, manifestAuthKey: subKeys.manifestAuthKey };
        const rosterResponse = await head(config);
        setDevices(rosterResponse.devices);
      } else {
        setDevices(null);
      }
    } catch (err) {
      setRosterError(err instanceof Error ? err.message : String(err));
      setDevices(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  const handleFinishMigration = async () => {
    if (phase !== "verified") return;
    const confirmed = await confirmModal(
      t("syncSettings.deltaLog.finishConfirm") ||
        "This stops sending updates to any device that hasn't upgraded yet — they will fall behind until they update. Continue?",
    );
    if (!confirmed) return;
    try {
      await runCutoverPhase(room);
      setMessage(t("syncSettings.deltaLog.finishedMsg") || "Migration finished — this device now uses the new sync service.");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRetireYjs = async () => {
    if (phase !== "quiesced") return;
    const confirmed = await confirmModal(
      t("syncSettings.deltaLog.retireConfirm") ||
        "This permanently deletes the old sync data on this device. This cannot be undone. Have you backed up your data (Settings → Backup)?",
    );
    if (!confirmed || !backedUpConfirmed) {
      setMessage(t("syncSettings.deltaLog.retireNeedsBackup") || "Confirm you have a backup before retiring the old sync.");
      return;
    }
    try {
      await retireYjs(room, {
        userConfirmed: true,
        backedUp: backedUpConfirmed,
        yjsIndexedDbNames: [`incrementum-yjs:${room}`],
        deleteIndexedDb: (name) =>
          new Promise<void>((resolve, reject) => {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error ?? new Error(`failed to delete ${name}`));
            req.onblocked = () => resolve(); // best-effort; a stale connection blocking us shouldn't fail the whole operation
          }),
      });
      setMessage(t("syncSettings.deltaLog.retiredMsg") || "Old sync retired.");
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRetryStuckOps = async () => {
    setLoading(true);
    try {
      const result = await drainSyncOutboxBatch(100);
      setMessage(
        t("syncSettings.deltaLog.retryResultMsg", { sent: result.sent, failed: result.failed }) ||
          `Retried pending operations: ${result.sent} sent, ${result.failed} still failing.`,
      );
    } finally {
      setLoading(false);
      await refresh();
    }
  };

  if (phase === null && loading) {
    return <div className="text-xs text-muted-foreground">{t("syncSettings.deltaLog.loading") || "Loading migration status…"}</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">
            {t("syncSettings.deltaLog.title") || "Sync engine migration"}
          </p>
          <p className="text-xs text-muted-foreground">
            {phase ? PHASE_LABELS[phase] : "—"}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="px-2 py-1 bg-muted text-foreground rounded text-xs flex items-center gap-1"
        >
          <ArrowsClockwise className="w-3 h-3" /> {t("syncSettings.deltaLog.refresh") || "Refresh"}
        </button>
      </div>

      {domainProgress.length > 0 && (
        <div className="rounded border border-border/70 overflow-hidden">
          <table className="w-full text-xs text-left">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr>
                <th className="py-1.5 px-2">{t("syncSettings.deltaLog.domain") || "Domain"}</th>
                <th className="py-1.5 px-2">{t("syncSettings.deltaLog.drained") || "Drained"}</th>
                <th className="py-1.5 px-2">{t("syncSettings.deltaLog.seeded") || "Seeded"}</th>
              </tr>
            </thead>
            <tbody>
              {domainProgress.map((row) => (
                <tr key={row.domain} className="border-t border-border/50">
                  <td className="py-1.5 px-2 font-mono">{row.domain}</td>
                  <td className="py-1.5 px-2">{row.drainedCount}</td>
                  <td className="py-1.5 px-2">{row.seededCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <p className="text-xs font-medium text-foreground mb-1">{t("syncSettings.deltaLog.deviceRoster") || "Devices"}</p>
        {rosterError && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <Warning className="w-3 h-3" /> {rosterError}
          </p>
        )}
        {!rosterError && devices && devices.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("syncSettings.deltaLog.noDevices") || "No devices have checked in yet."}</p>
        )}
        {!rosterError && devices && devices.length > 0 && (
          <ul className="text-xs text-muted-foreground space-y-1">
            {devices.map((device) => (
              <li key={device.deviceTag} className="flex items-center gap-2">
                <CheckCircle className="w-3 h-3 text-emerald-500" />
                <span className="font-mono">{device.deviceTag.slice(0, 12)}…</span>
                <span>cursor {device.cursor}</span>
                <span>· {new Date(device.seenAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          disabled={phase !== "verified"}
          onClick={() => void handleFinishMigration()}
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("syncSettings.deltaLog.finishMigration") || "Finish migration"}
        </button>
        <button
          type="button"
          onClick={() => void handleRetryStuckOps()}
          className="px-3 py-1.5 bg-muted text-foreground rounded text-xs"
        >
          {t("syncSettings.deltaLog.retryStuck") || "Retry pending operations"}
        </button>
      </div>
      {phase !== "verified" && (
        <p className="text-xs text-muted-foreground">
          {t("syncSettings.deltaLog.finishHint") ||
            "\"Finish migration\" becomes available once every device in this room has confirmed it holds the same data (phase: verified)."}
        </p>
      )}

      {phase === "quiesced" && (
        <div className="rounded border border-destructive/40 bg-destructive/5 p-3 space-y-2">
          <p className="text-xs text-foreground font-medium">{t("syncSettings.deltaLog.retireTitle") || "Retire the old sync engine"}</p>
          <p className="text-xs text-muted-foreground">
            {t("syncSettings.deltaLog.retireDesc") ||
              "This permanently deletes the old sync data on this device and cannot be undone. Back up first (Settings → Backup)."}
          </p>
          <label className="flex items-center gap-2 text-xs text-foreground">
            <input
              type="checkbox"
              checked={backedUpConfirmed}
              onChange={(e) => setBackedUpConfirmed(e.target.checked)}
            />
            {t("syncSettings.deltaLog.backedUpCheckbox") || "I have backed up my data"}
          </label>
          <button
            type="button"
            disabled={!backedUpConfirmed}
            onClick={() => void handleRetireYjs()}
            className="px-3 py-1.5 bg-destructive text-destructive-foreground rounded text-xs disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("syncSettings.deltaLog.retireButton") || "Retire old sync"}
          </button>
        </div>
      )}

      {message && <div className="text-xs text-muted-foreground">{message}</div>}
    </div>
  );
}
