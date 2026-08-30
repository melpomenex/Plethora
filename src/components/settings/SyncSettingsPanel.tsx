import { useState, useEffect } from "react";
import { useSyncStore } from "../../stores/syncStore";
import { useAccountStore } from "../../stores/accountStore";
import { useEntitlementStore } from "../../stores/entitlementStore";
import {
  ArrowsClockwise,
  CheckCircle,
  Key,
  LockSimple,
  ShieldCheck,
  Warning,
  WifiHigh,
} from "@phosphor-icons/react";

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function SyncSettingsPanel() {
  const {
    isSyncing,
    lastSyncedAt,
    pendingOutboxCount,
    storageUsedBytes,
    wifiOnly,
    openIssues,
    error,
    syncNow,
    generateRecoveryKey,
    storeRecoveryKey,
    acknowledgeRecoveryKey,
    recoveryKeyAcknowledged,
    listIssues,
    resolveIssue,
    setWifiOnly,
    fetchStorageUsage,
  } = useSyncStore();
  const { isAuthenticated } = useAccountStore();
  const plan = useEntitlementStore((state) => state.snapshot.plan);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [showImportForm, setShowImportForm] = useState(false);
  const [importValue, setImportValue] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const storageLimitBytes = 10 * 1024 * 1024 * 1024;

  useEffect(() => {
    void useSyncStore.getState().init();
    void listIssues();
  }, [listIssues]);

  const handleGenerateKey = async () => {
    if (recoveryKeyAcknowledged) return;
    const key = await generateRecoveryKey();
    await storeRecoveryKey(key);
    setActiveKey(key);
    setShowKeyModal(true);
  };

  const handleImportKey = async () => {
    // Mirror the Rust-side normalization: separators and case never change
    // the derived key, but it must be exactly 64 hex characters.
    const normalized = importValue.replace(/[\s-]/g, "").toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(normalized)) {
      setImportError("Recovery key must contain exactly 64 hexadecimal characters.");
      return;
    }
    setImportBusy(true);
    setImportError(null);
    try {
      await storeRecoveryKey(normalized);
      await acknowledgeRecoveryKey();
      setShowImportForm(false);
      setImportValue("");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Failed to import recovery key.");
    } finally {
      setImportBusy(false);
    }
  };

  const handleAcknowledgeKey = async () => {
    await acknowledgeRecoveryKey();
    setShowKeyModal(false);
  };

  const isPro = plan === "pro";
  const syncDisabled = isSyncing || !isAuthenticated || !isPro;
  const statusLabel = error
    ? "Error"
    : isSyncing
      ? "Active (Transferring)"
      : pendingOutboxCount > 0
        ? "Pending changes"
        : lastSyncedAt
          ? "Up to date"
          : "Not synced yet";
  const statusIconClass = error
    ? "text-amber-500"
    : pendingOutboxCount > 0
      ? "text-amber-500"
      : "text-green-500";
  const StatusIcon = error ? Warning : CheckCircle;

  return (
    <div className="space-y-6">
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <LockSimple className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                End-to-End Encrypted Cloud Sync
              </h3>
              <p className="text-sm text-muted-foreground">
                Zero-knowledge delta sync across desktop, tablet, and mobile devices
              </p>
            </div>
          </div>

          <button
            onClick={() => void syncNow()}
            disabled={syncDisabled}
            className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded-lg transition-colors flex items-center gap-2 text-sm font-medium"
          >
            <ArrowsClockwise className={`w-4 h-4 ${isSyncing ? "animate-spin" : ""}`} />
            {isSyncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>

        {!isAuthenticated && (
          <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-500 text-sm">
            <Warning className="w-4 h-4 flex-shrink-0" />
            <span>Sign in to your Plethora account to enable multi-device cloud synchronization.</span>
          </div>
        )}

        {isAuthenticated && !isPro && (
          <div className="flex items-center gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-500 text-sm">
            <Warning className="w-4 h-4 flex-shrink-0" />
            <span>Plethora Pro is required for cloud sync. Upgrade to sync across devices.</span>
          </div>
        )}

        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm">
            <Warning className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pt-2">
          <div className="border rounded-lg p-4 bg-muted/30">
            <span className="text-xs text-muted-foreground">Sync Status</span>
            <p className="text-sm font-medium text-foreground mt-1 flex items-center gap-1.5">
              <StatusIcon className={`w-4 h-4 ${statusIconClass}`} />
              {statusLabel}
            </p>
          </div>

          <div className="border rounded-lg p-4 bg-muted/30">
            <span className="text-xs text-muted-foreground">Last Synced</span>
            <p className="text-sm font-medium text-foreground mt-1">
              {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : "Not synced yet"}
            </p>
          </div>

          <div className="border rounded-lg p-4 bg-muted/30">
            <span className="text-xs text-muted-foreground">Pending Changes</span>
            <p className="text-sm font-medium text-foreground mt-1">
              {pendingOutboxCount} record{pendingOutboxCount === 1 ? "" : "s"}
            </p>
          </div>

          <div className="border rounded-lg p-4 bg-muted/30">
            <span className="text-xs text-muted-foreground">Cloud Storage</span>
            <p className="text-sm font-medium text-foreground mt-1">
              {formatBytes(storageUsedBytes)} / {formatBytes(storageLimitBytes)}
            </p>
            <button
              type="button"
              onClick={() => void fetchStorageUsage()}
              className="text-xs text-primary mt-1 hover:underline"
            >
              Refresh usage
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={wifiOnly}
            onChange={(event) => setWifiOnly(event.target.checked)}
            className="rounded border-border"
          />
          <WifiHigh className="w-4 h-4 text-muted-foreground" />
          Sync large transfers on Wi‑Fi only
        </label>
      </div>

      {openIssues.length > 0 && (
        <div className="bg-card border rounded-lg p-6 space-y-4">
          <h3 className="text-lg font-semibold text-foreground">Sync Conflicts</h3>
          <p className="text-sm text-muted-foreground">
            {openIssues.length} conflict{openIssues.length === 1 ? "" : "s"} need your decision.
          </p>
          <div className="space-y-3">
            {openIssues.map((issue) => (
              <div key={issue.id} className="border rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {issue.entityType}: {issue.entityId.slice(0, 12)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Server revision {issue.serverRevision}, base {issue.baseRevision}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void resolveIssue(issue.id, "keep_mine")}
                    className="px-3 py-1.5 text-xs border rounded-lg hover:bg-muted"
                  >
                    Keep mine
                  </button>
                  <button
                    type="button"
                    onClick={() => void resolveIssue(issue.id, "keep_theirs")}
                    className="px-3 py-1.5 text-xs border rounded-lg hover:bg-muted"
                  >
                    Keep theirs
                  </button>
                  <button
                    type="button"
                    onClick={() => void resolveIssue(issue.id, "both")}
                    className="px-3 py-1.5 text-xs border rounded-lg hover:bg-muted"
                  >
                    Keep both
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center">
              <Key className="w-5 h-5 text-indigo-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Sync Master Recovery Key</h3>
              <p className="text-sm text-muted-foreground">
                Stored in platform secure storage — not in browser localStorage
              </p>
            </div>
          </div>

          {!recoveryKeyAcknowledged ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleGenerateKey()}
                className="px-3.5 py-1.5 border hover:bg-muted rounded-lg transition-colors text-sm font-medium flex items-center gap-1.5"
                title="First device only — additional devices must import this key"
              >
                <ShieldCheck className="w-4 h-4 text-primary" />
                Generate Key
              </button>
              <button
                onClick={() => {
                  setShowImportForm((open) => !open);
                  setImportError(null);
                }}
                className="px-3.5 py-1.5 border hover:bg-muted rounded-lg transition-colors text-sm font-medium flex items-center gap-1.5"
                title="Use the recovery key from your existing synced device"
              >
                <Key className="w-4 h-4 text-indigo-500" />
                Import Key
              </button>
            </div>
          ) : (
            <button
              disabled
              title="Recovery-key rotation is not available yet"
              className="px-3.5 py-1.5 border disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors text-sm font-medium flex items-center gap-1.5"
            >
              <ShieldCheck className="w-4 h-4 text-primary" />
              Recovery Key Configured
            </button>
          )}
        </div>

        {!recoveryKeyAcknowledged && (
          <p className="text-xs text-muted-foreground">
            Generate a key on your first device only. Every additional device
            must import that same key — a device that generates its own key
            cannot read or be read by the rest of the account.
          </p>
        )}

        {showImportForm && !recoveryKeyAcknowledged && (
          <div className="space-y-2 p-3 bg-muted/50 border rounded-lg">
            <label htmlFor="recovery-key-import" className="text-sm font-medium">
              Paste the recovery key from your existing synced device
            </label>
            <input
              id="recovery-key-import"
              type="text"
              value={importValue}
              onChange={(event) => {
                setImportValue(event.target.value);
                setImportError(null);
              }}
              placeholder="64 hexadecimal characters (dashes optional)"
              autoComplete="off"
              spellCheck={false}
              className="w-full px-3 py-2 bg-background border rounded-lg font-mono text-xs break-all focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {importError && (
              <p className="text-xs text-red-500" role="alert">
                {importError}
              </p>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={() => void handleImportKey()}
                disabled={importBusy || importValue.trim().length === 0}
                className="px-3.5 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded-lg transition-colors text-sm font-medium"
              >
                {importBusy ? "Importing..." : "Import Key"}
              </button>
              <button
                onClick={() => {
                  setShowImportForm(false);
                  setImportValue("");
                  setImportError(null);
                }}
                className="px-3.5 py-1.5 border hover:bg-muted rounded-lg transition-colors text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {showKeyModal && activeKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
              <Key className="w-5 h-5 text-indigo-500" />
              Your Sync Recovery Key
            </h3>
            <p className="text-xs text-muted-foreground">
              Save this key in a secure password manager. Plethora uses zero-knowledge encryption; if you lose all enrolled devices and this recovery key, cloud data cannot be restored.
            </p>
            <div className="p-3 bg-muted rounded-lg font-mono text-xs break-all select-all border">
              {activeKey}
            </div>
            <button
              onClick={() => void handleAcknowledgeKey()}
              className="w-full py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              I have safely stored this key
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
