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
} from "@phosphor-icons/react";

export function SyncSettingsPanel() {
  const { isSyncing, lastSyncedAt, pendingOutboxCount, syncNow, generateRecoveryKey, recoveryKey } =
    useSyncStore();
  const { isAuthenticated } = useAccountStore();
  const plan = useEntitlementStore((state) => state.snapshot.plan);
  const [showKeyModal, setShowKeyModal] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(recoveryKey);

  useEffect(() => {
    void useSyncStore.getState().init();
  }, []);

  const handleGenerateKey = async () => {
    const key = await generateRecoveryKey();
    setActiveKey(key);
    setShowKeyModal(true);
  };

  const isPro = plan === "pro";

  return (
    <div className="space-y-6">
      {/* Cloud Sync Status */}
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
            disabled={isSyncing || !isAuthenticated}
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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
          <div className="border rounded-lg p-4 bg-muted/30">
            <span className="text-xs text-muted-foreground">Sync Status</span>
            <p className="text-sm font-medium text-foreground mt-1 flex items-center gap-1.5">
              <CheckCircle className="w-4 h-4 text-green-500" />
              {isSyncing ? "Active (Transferring)" : "Ready & Up to date"}
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
        </div>
      </div>

      {/* Zero-Knowledge Recovery Key */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-500/10 flex items-center justify-center">
              <Key className="w-5 h-5 text-indigo-500" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">
                Sync Master Recovery Key
              </h3>
              <p className="text-sm text-muted-foreground">
                Your 32-byte secret key used to decrypt your cloud library on new devices
              </p>
            </div>
          </div>

          <button
            onClick={() => void handleGenerateKey()}
            className="px-3.5 py-1.5 border hover:bg-muted rounded-lg transition-colors text-sm font-medium flex items-center gap-1.5"
          >
            <ShieldCheck className="w-4 h-4 text-primary" />
            {activeKey ? "View Recovery Key" : "Generate Key"}
          </button>
        </div>
      </div>

      {/* Recovery Key Modal */}
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
              onClick={() => setShowKeyModal(false)}
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
