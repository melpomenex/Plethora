import { useState, useEffect, useMemo } from "react";
import {
  ArrowsClockwise,
  CaretDown,
  Cloud,
  CloudSlash,
  Copy,
  Download,
  HardDrive,
  Key,
  Lock,
  Scan,
  WarningCircle,
  WifiHigh,
} from "@phosphor-icons/react";
import { createNewSyncRoomId, getSyncRoomId, setSyncRoomId, rejoinRoom, updateYjsSyncStatus } from "../../lib/yjsSync";
import { useI18n } from "../../lib/i18n";
import { isNativeMobile, isPWA } from "../../lib/tauri";
import { getStartupRequestCounts, getSyncTelemetry, type SyncPhaseSample } from "../../lib/sync/syncTelemetry";
import { startSyncSubsystems } from "../../lib/startSyncSubsystems";
import { QRCodeCanvas } from "qrcode.react";
import { SyncQrScanner } from "./SyncQrScanner";
import { ProgressiveSyncStatus } from "../sync/ProgressiveSyncStatus";
import { SyncedFilesManifestPanel } from "../sync/SyncedFilesManifestPanel";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  enableEncryption,
  enableEncryptionWithSecret,
  ensureEncryptionEnabled,
} from "../../lib/sync/roomCrypto";
import {
  encodeSyncQrPayload,
  parseSyncQrPayload,
  isSyncQrPayload,
  InvalidQrPayloadError,
} from "../../lib/sync/qrFormat";
import { getSyncFeatureFlags } from "../../lib/sync/featureFlags";
import { deriveDeltaLogUrls } from "../../lib/sync/deltaLog/urls";
import { DeltaLogMigrationPanel } from "../sync/DeltaLogMigrationPanel";

const DEFAULT_SYNC_SETTINGS = {
  enabled: false,
  provider: "dropbox" as const,
  interval: 3600,
  onStartup: false,
  autoDownloadMode: "wifi-only" as const,
  yjs: { enabled: false, url: "" },
};

export function SyncSettings() {
  const { t } = useI18n();
  const [roomId, setRoomId] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [roomMessage, setRoomMessage] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(true);
  const [showScanner, setShowScanner] = useState(false);

  // Encryption is always on (the relay refuses plaintext sync frames and the
  // boot path auto-provisions a key). The only piece the UI surfaces is the
  // room secret, which the user needs to pair another device via QR or copy.
  // `roomSecret` is null only until the secret finishes loading/provisioning.
  const [roomSecret, setRoomSecret] = useState<string | null>(null);
  const [revealSecret, setRevealSecret] = useState(false);
  const [diagnosticsTick, setDiagnosticsTick] = useState(0);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);

  const { settings, updateSettings } = useSettingsStore();
  const syncSettings = settings.sync ?? DEFAULT_SYNC_SETTINGS;
  const yjsSettings = syncSettings.yjs ?? DEFAULT_SYNC_SETTINGS.yjs;
  const autoDownloadMode = syncSettings?.autoDownloadMode ?? "wifi-only";

  useEffect(() => {
    const timer = window.setInterval(() => setDiagnosticsTick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const telemetry = useMemo(() => getSyncTelemetry(), [diagnosticsTick]);
  const startupRequestCounts = useMemo(() => getStartupRequestCounts(), [diagnosticsTick]);
  const recentTelemetry = useMemo(() => telemetry.slice(-50), [telemetry]);
  const diagnosticsSummary = useMemo(() => {
    const latest = telemetry[telemetry.length - 1];
    const errorCount = telemetry.filter((sample) => sample.outcome === "error").length;
    const startupRequestCount = Object.values(startupRequestCounts).reduce((sum, count) => sum + count, 0);
    return {
      latest,
      errorCount,
      startupRequestCount,
    };
  }, [startupRequestCounts, telemetry]);

  const copySyncDiagnostics = async () => {
    const report = JSON.stringify({ telemetry, startupRequestCounts }, null, 2);
    try {
      await navigator.clipboard.writeText(report);
      setRoomMessage("Sync diagnostics copied");
    } catch {
      setRoomMessage("Unable to copy sync diagnostics");
    }
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes < 1024) return `${Math.round(bytes ?? 0)} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes;
    let unit = -1;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
  };

  const [customUrl, setCustomUrl] = useState(yjsSettings.url || "");

  // Task 7.5: settings.sync.yjs.url stays the single endpoint value the user
  // edits (same field, same label) — deltaLogSync just means it now resolves
  // to a delta-log service base instead of the Yjs relay. A custom
  // self-hosted value is preserved as-is; only its *meaning* changes. This
  // preview never touches the field's stored value or the Apply-URL flow.
  const deltaLogSyncEnabled = getSyncFeatureFlags().deltaLogSync;
  const derivedDeltaLogUrls = useMemo(() => {
    if (!deltaLogSyncEnabled) return null;
    try {
      return deriveDeltaLogUrls(customUrl || "wss://sync.readsync.org");
    } catch {
      return null;
    }
  }, [deltaLogSyncEnabled, customUrl]);

  useEffect(() => {
    setCustomUrl(yjsSettings.url || "");
  }, [yjsSettings.url]);

  useEffect(() => {
    const loadedRoom = getSyncRoomId();
    setRoomId(loadedRoom);
    // Encryption is mandatory; make sure a secret is provisioned and cached
    // so the QR below carries the full `incrementum-sync:v1:<room>:<secret>`
    // payload. Idempotent — no-op if boot already provisioned one.
    void loadRoomSecret(loadedRoom);
  }, []);

  async function loadRoomSecret(room: string) {
    try {
      const secret = await ensureEncryptionEnabled(room);
      setRoomSecret(secret);
    } catch (err) {
      console.warn("[SyncSettings] failed to provision/load encryption secret", err);
    }
  }

  // Decide whether THIS device is the scanner or the code-being-scanned.
  //   - Camera-bearing devices (native Android/iOS builds, plus PWA installs
  //     on phones) are the scanner: hide the QR, show the "Scan" button.
  //   - Everything else (desktop Tauri, desktop browser) shows the QR so a
  //     phone can scan it.
  //
  // The old gate was `display-mode: standalone`, which Tauri's WebView does
  // NOT report — so on native mobile `isStandalone` was false, `showQr` stayed
  // true, and the Scan button (gated on `!showQr`) never rendered. That is
  // why "mobile has no scan functionality": it was showing the QR image to the
  // phone that was supposed to do the scanning.
  useEffect(() => {
    const hasCamera = isNativeMobile() || isPWA();
    setShowQr(!hasCamera);
  }, []);

  useEffect(() => {
    if (!showScanner) {
      return;
    }
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [showScanner]);

  const handleApplyUrl = async () => {
    try {
      const targetUrl = customUrl.trim();
      updateSettings({
        sync: {
          ...syncSettings,
          yjs: {
            ...yjsSettings,
            url: targetUrl,
          },
        },
      });
      await updateYjsSyncStatus();
      setRoomMessage(t("syncSettings.appliedUrlMsg", { url: targetUrl || "Default (wss://sync.readsync.org)" }));
    } catch (err) {
      setRoomMessage(t("syncSettings.failedApplyUrlMsg", { error: (err as Error).message }));
    }
  };

  const handleCopyRoom = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setRoomMessage(t("syncSettings.copiedCodeMsg"));
    } catch {
      setRoomMessage(t("syncSettings.failedCopyMsg"));
    }
  };

  /**
   * Join a sync room from a code (typed or scanned).
   *
   * `valueOverride` lets the QR scanner pass the scanned string directly
   * instead of round-tripping through the input field. Returns a result so the
   * scanner can decide whether to close (accepted) or keep scanning (rejected —
   * e.g. a malformed or non-sync payload). For the typed-input path the return
   * value is ignored.
   *
   * Joining switches the running sync to the new room in-process via
   * rejoinRoom() (tears down the old provider, writes the room ID, rebuilds),
   * so there is no longer a "reload to connect" step.
   */
  const handleJoinRoom = async (
    valueOverride?: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    const raw = (valueOverride ?? joinRoomId).trim();
    if (!raw) {
      setRoomMessage(t("syncSettings.enterCodeMsg"));
      return { ok: false, error: t("syncSettings.enterCodeMsg") };
    }

    // Encryption is mandatory, so joining another device's room requires its
    // full invite payload (`incrementum-sync:v1:<roomId>:<secret>`). A bare
    // room ID alone can't work — this device would provision its own key and
    // could never decrypt the peer's frames. Guide the user toward the
    // invite code / QR instead of silently joining an incompatible room.
    if (!isSyncQrPayload(raw)) {
      const msg = t("syncSettings.needInviteCodeMsg");
      setRoomMessage(msg);
      return { ok: false, error: msg };
    }

    try {
      const parsed = parseSyncQrPayload(raw);
      await enableEncryptionWithSecret(parsed.roomId, parsed.roomSecret);
      setSyncRoomId(parsed.roomId);
      setRoomId(parsed.roomId);
      setRoomSecret(parsed.roomSecret);
      setJoinRoomId("");
      // Replication observers must be attached before rejoinRoom connects to
      // the new room, so we receive the room's existing state on join. Await
      // (idempotent no-op when boot already started the chain).
      try {
        await startSyncSubsystems();
      } catch (err) {
        console.warn("[SyncSettings] subsystems start failed before room join", err);
      }
      // forceProviderRebuild: the user may already be on this room with a
      // different (or auto-provisioned) key cached. Without this, rejoinRoom
      // short-circuits at the same-room check and the just-cached secret
      // never takes effect.
      await rejoinRoom(parsed.roomId, { forceProviderRebuild: true });
      setRoomMessage(t("syncSettings.joinedEncryptedMsg"));
      return { ok: true };
    } catch (err) {
      const msg =
        err instanceof InvalidQrPayloadError
          ? t("syncSettings.invalidCodeMsg", { error: err.message })
          : t("syncSettings.failedJoinMsg", { error: (err as Error).message });
      setRoomMessage(msg);
      return { ok: false, error: msg };
    }
  };

  const handleRotateRoom = async () => {
    if (!confirm(t("syncSettings.confirmNewCode"))) {
      return;
    }
    const next = createNewSyncRoomId();
    setRoomId(next);
    // Encryption is always on. Provision a fresh key for the new room (the
    // old room's key is derived from secret+roomId and won't match) and show
    // it so the user can pair their other devices with the new room.
    try {
      const secret = await ensureEncryptionEnabled(next);
      setRoomSecret(secret);
      setRevealSecret(true);
      setRoomMessage(t("syncSettings.newCodeEncryptMsg"));
    } catch (err) {
      console.warn("[SyncSettings] failed to provision encryption on room rotate", err);
      setRoomMessage(t("syncSettings.newCodeMsg"));
    }
  };

  const handleRotateKey = async () => {
    if (!confirm(t("syncSettings.confirmResetKey"))) {
      return;
    }
    try {
      // Generate a brand-new secret + key for the current room. Every other
      // device syncing this room must re-pair using the new secret shown
      // below — the old one no longer decrypts newly-encrypted frames.
      const secret = await enableEncryption(roomId);
      setRoomSecret(secret);
      setRevealSecret(true);
      setRoomMessage(t("syncSettings.keyResetMsg"));
    } catch (err) {
      setRoomMessage(t("syncSettings.failedResetKeyMsg", { error: (err as Error).message }));
    }
  };

  const handleCopySecret = async () => {
    if (!roomSecret) return;
    try {
      await navigator.clipboard.writeText(roomSecret);
      setRoomMessage(t("syncSettings.secretCopiedMsg"));
    } catch {
      setRoomMessage(t("syncSettings.failedCopySecretMsg"));
    }
  };

  // Encryption is always on, so whenever we have the secret cached the QR
  // carries the full invite payload (room + secret) and a scanning peer
  // joins encrypted automatically. Before the secret loads, fall back to the
  // bare roomId so the QR renders immediately rather than flickering empty.
  const qrPayload = useMemo(() => {
    if (roomSecret) {
      return encodeSyncQrPayload(roomId, roomSecret);
    }
    return roomId;
  }, [roomId, roomSecret]);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Cloud className="w-8 h-8 text-primary" />
        <div>
          <h2 className="text-2xl font-bold text-foreground">{t("syncSettings.title")}</h2>
          <p className="text-sm text-muted-foreground">
            Sync your reading data across your devices over a shared sync room.
          </p>
        </div>
      </div>

      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <button
              type="button"
              aria-expanded={diagnosticsExpanded}
              aria-controls="sync-diagnostics-details"
              onClick={() => setDiagnosticsExpanded((expanded) => !expanded)}
              className="flex items-center gap-2 text-left text-lg font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 rounded"
            >
              <CaretDown className={`h-4 w-4 shrink-0 transition-transform ${diagnosticsExpanded ? "rotate-0" : "-rotate-90"}`} />
              <span>{t("syncSettings.diagnosticsTitle")}</span>
            </button>
            <p className="mt-1 text-xs text-muted-foreground">{t("syncSettings.diagnosticsDesc")}</p>
          </div>
          <button
            type="button"
            onClick={() => { void copySyncDiagnostics(); }}
            className="shrink-0 px-3 py-2 bg-muted text-foreground rounded text-xs flex items-center gap-1"
          >
            <Copy className="w-3 h-3" /> {t("syncSettings.copyDiagnostics")}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
          <span>
            {t("syncSettings.diagnosticsPhases", { count: telemetry.length })}
          </span>
          <span>
            {t("syncSettings.diagnosticsLatest", { phase: diagnosticsSummary.latest?.phase ?? t("syncSettings.diagnosticsNone") })}
          </span>
          <span className={diagnosticsSummary.errorCount > 0 ? "inline-flex items-center gap-1 text-destructive" : "text-emerald-500"}>
            {diagnosticsSummary.errorCount > 0 && <WarningCircle className="h-3.5 w-3.5" />}
            {diagnosticsSummary.errorCount > 0
              ? t("syncSettings.diagnosticsErrors", { count: diagnosticsSummary.errorCount })
              : t("syncSettings.diagnosticsHealthy")}
          </span>
          {diagnosticsSummary.startupRequestCount > 0 && (
            <span>{t("syncSettings.diagnosticsStartupRequests", { count: diagnosticsSummary.startupRequestCount })}</span>
          )}
        </div>

        {diagnosticsExpanded && (
          <div id="sync-diagnostics-details" className="mt-3 max-h-80 overflow-auto rounded border border-border/70" tabIndex={0}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="sticky top-0 bg-card text-muted-foreground border-b border-border">
                  <tr><th className="py-2 px-3 pr-3">{t("syncSettings.diagnosticsPhase")}</th><th className="py-2 pr-3">{t("syncSettings.diagnosticsDuration")}</th><th className="py-2 pr-3">{t("syncSettings.diagnosticsRecords")}</th><th className="py-2 pr-3">{t("syncSettings.diagnosticsBytes")}</th><th className="py-2 pr-3">{t("syncSettings.diagnosticsOutcome")}</th></tr>
                </thead>
                <tbody>
                  {recentTelemetry.length === 0 ? (
                    <tr><td colSpan={5} className="py-3 px-3 text-muted-foreground">{t("syncSettings.diagnosticsNoneRecorded")}</td></tr>
                  ) : recentTelemetry.map((sample: SyncPhaseSample, index) => (
                    <tr key={`${sample.startedAt}-${index}`} className="border-b border-border/50">
                      <td className="py-2 px-3 pr-3 font-mono">{sample.phase}</td>
                      <td className="py-2 pr-3">{Math.round(sample.durationMs ?? 0)} ms</td>
                      <td className="py-2 pr-3">{sample.records ?? 0}</td>
                      <td className="py-2 pr-3">{formatBytes(sample.bytes)}</td>
                      <td className={sample.outcome === "error" ? "py-2 pr-3 text-destructive" : "py-2 pr-3"}>{sample.outcome ?? "pending"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
              {telemetry.length > recentTelemetry.length && t("syncSettings.diagnosticsShowingRecent", { count: recentTelemetry.length, total: telemetry.length })}
              {telemetry.length <= recentTelemetry.length && t("syncSettings.diagnosticsShowingAll")}
              <span className="ml-2">{t("syncSettings.diagnosticsStartupBreakdown", { requests: Object.entries(startupRequestCounts).map(([request, count]) => `${request} (${count})`).join(", ") || t("syncSettings.diagnosticsNone") })}</span>
            </div>
          </div>
        )}
      </div>

      {/* Device sync (room-based) */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h3 className="text-lg font-semibold text-foreground mb-2">{t("syncSettings.deviceSync")}</h3>
        <p className="text-sm text-muted-foreground mb-4">
          {t("syncSettings.deviceSyncDesc")}
        </p>
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t("syncSettings.yourSyncCode")}</label>
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 bg-background border border-border rounded text-xs font-mono"
                value={roomId}
                readOnly
              />
              <button
                onClick={handleCopyRoom}
                className="px-3 py-2 bg-muted text-foreground rounded text-xs"
              >
                {t("syncSettings.copy")}
              </button>
              <button
                onClick={handleRotateRoom}
                className="px-3 py-2 bg-destructive text-destructive-foreground rounded text-xs"
              >
                {t("syncSettings.new")}
              </button>
            </div>
          </div>
          {showQr && (
            <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/30 p-3">
              <QRCodeCanvas value={qrPayload} size={120} />
              <div className="text-xs text-muted-foreground">
                {t("syncSettings.scanQrEncryptedDesc")}
              </div>
            </div>
          )}

          {/* End-to-end encryption is always on. This panel exposes the room
              secret used to pair another device (QR/copy) and a key-rotation
              control; there is no enable/disable toggle by design — the relay
              refuses plaintext sync frames, so encryption is not optional. */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Lock className="w-4 h-4 text-green-500" />
                <span>{t("syncSettings.e2eTitle")}</span>
              </div>
              <span className="text-xs text-muted-foreground">
                {t("syncSettings.statusEncrypted")}
              </span>
            </div>

            {roomSecret ? (
              <div className="space-y-1">
                <label className="block text-xs text-muted-foreground">
                  {revealSecret
                    ? t("syncSettings.e2eRoomSecret")
                    : t("syncSettings.e2eRoomSecretHidden")}
                </label>
                <div className="flex gap-2">
                  <input
                    className="flex-1 px-2 py-1 bg-background border border-border rounded text-xs font-mono"
                    type={revealSecret ? "text" : "password"}
                    value={roomSecret}
                    readOnly
                  />
                  <button
                    onClick={() => setRevealSecret((v) => !v)}
                    className="px-2 py-1 bg-muted text-foreground rounded text-xs"
                  >
                    {revealSecret ? t("syncSettings.e2eHide") : t("syncSettings.e2eShow")}
                  </button>
                  <button
                    onClick={handleCopySecret}
                    className="px-2 py-1 bg-muted text-foreground rounded text-xs flex items-center gap-1"
                  >
                    <Copy className="w-3 h-3" /> {t("syncSettings.copy")}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("syncSettings.e2eSecretShareWarning")}
                </p>
                <div className="flex gap-2 pt-1">
                  <button
                    onClick={handleRotateKey}
                    className="flex-1 px-2 py-1 bg-muted text-foreground rounded text-xs flex items-center justify-center gap-1"
                  >
                    <Key className="w-3 h-3" /> {t("syncSettings.e2eResetKey")}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                {t("syncSettings.e2eLoadingSecret")}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">{t("syncSettings.joinCode")}</label>
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 bg-background border border-border rounded text-xs font-mono"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                placeholder={t("syncSettings.pasteCodePlaceholder")}
              />
              <button
                onClick={() => { void handleJoinRoom(); }}
                  className="px-3 py-2 bg-primary text-primary-foreground rounded text-xs"
                >
                  {t("syncSettings.join")}
                </button>
              {!showQr && (
                <button
                  onClick={() => setShowScanner(true)}
                  className="px-3 py-2 bg-muted text-foreground rounded text-xs flex items-center gap-1"
                >
                  <Scan className="w-3.5 h-3.5" /> {t("syncSettings.scan")}
                </button>
              )}
            </div>
          </div>
          {roomMessage && <div className="text-xs text-muted-foreground">{roomMessage}</div>}
          <div className="text-xs text-muted-foreground">
            {t("syncSettings.scanToJoinHint")}
          </div>
        </div>

        {/* Real-time (Yjs CRDT) sync toggle */}
        <div className="border-t border-border pt-4 mt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowsClockwise className="w-4 h-4 text-primary" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t("syncSettings.realtimeSync")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("syncSettings.realtimeSyncDesc")}
                </p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                className="sr-only peer"
                checked={yjsSettings.enabled}
                onChange={async (e) => {
                  const isChecked = e.target.checked;
                  updateSettings({
                    sync: {
                      ...syncSettings,
                      yjs: {
                        ...yjsSettings,
                        enabled: isChecked,
                      },
                    },
                  });
                  if (isChecked) {
                    // Bring up the replication chain (cards/docs/feeds/file-sync)
                    // BEFORE reconnecting the websocket provider. The observers
                    // attach to the shared Yjs doc; if they aren't registered
                    // when the provider connects, the inbound room state still
                    // merges into the doc but the per-key handlers only fire on
                    // later mutations + the ensure*Ready() replay. Awaiting here
                    // guarantees the receive path is wired when connect happens.
                    // Idempotent: a no-op when boot already started the chain.
                    try {
                      await startSyncSubsystems();
                    } catch (err) {
                      console.warn("[SyncSettings] subsystems start failed; reconnecting anyway", err);
                    }
                  }
                  await updateYjsSyncStatus().catch((err) =>
                    console.error("[SyncSettings] failed to update sync status", err)
                  );
                }}
              />
              <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
            </label>
          </div>

          {yjsSettings.enabled && (
            <div className="mt-4 pt-4 border-t border-border space-y-2">
              <ProgressiveSyncStatus />
              <label className="block text-xs font-medium text-foreground">
                {t("syncSettings.endpoint")} (WebSocket)
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 px-3 py-2 bg-background border border-border rounded text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  onKeyDown={async (e) => {
                    if (e.key === "Enter") {
                      await handleApplyUrl();
                    }
                  }}
                  placeholder="wss://sync.readsync.org"
                />
                <button
                  onClick={handleApplyUrl}
                  className="px-3 py-2 bg-primary hover:bg-primary/95 text-primary-foreground font-medium rounded text-xs transition-colors"
                >
                  {t("syncSettings.applyUrlBtn")}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t("syncSettings.endpointHint")}
              </p>
              {deltaLogSyncEnabled && derivedDeltaLogUrls && (
                <p className="text-xs text-muted-foreground font-mono">
                  → {derivedDeltaLogUrls.httpBase}
                </p>
              )}
              {deltaLogSyncEnabled && (
                <div className="mt-4 pt-4 border-t border-border">
                  <DeltaLogMigrationPanel />
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showScanner && (
        <SyncQrScanner
          onDetected={async (value) => {
            const result = await handleJoinRoom(value);
            // Returning true closes the scanner; false keeps it open so the
            // user can re-scan after an invalid code.
            return result.ok;
          }}
          onClose={() => setShowScanner(false)}
        />
      )}

      {/* Synced files manifest — shows every file registered for sync across
          devices in this room. Diagnostic: if this is empty after importing,
          the file-sync registration isn't running. If it shows files but the
          library shows no badges, the badge rendering is the issue. */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <HardDrive className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">Synced files</h3>
        </div>
        <SyncedFilesManifestPanel />
      </div>

      {/* File Sync Settings */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center gap-3 mb-4">
          <HardDrive className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold text-foreground">{t("syncSettings.fileSync")}</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          {t("syncSettings.fileSyncSectionDesc")}
        </p>

        <div className="space-y-4">
          {/* Auto-download setting */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t("syncSettings.autoDownloadFiles")}
            </label>
            <select
              value={autoDownloadMode}
              onChange={(e) =>
                updateSettings({
                  sync: {
                    ...syncSettings,
                    autoDownloadMode: e.target.value as "always" | "wifi-only" | "manual",
                  },
                })
              }
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground"
            >
              <option value="always">
                {t("syncSettings.alwaysDownload")}
              </option>
              <option value="wifi-only">
                {t("syncSettings.wifiOnly")}
              </option>
              <option value="manual">
                {t("syncSettings.manualDownload")}
              </option>
            </select>
            <p className="text-xs text-muted-foreground mt-1">
              {autoDownloadMode === "always" && (
                <span className="flex items-center gap-1">
                  <Download className="w-3 h-3" /> {t("syncSettings.autoDownloadAlwaysDesc")}
                </span>
              )}
              {autoDownloadMode === "wifi-only" && (
                <span className="flex items-center gap-1">
                  <WifiHigh className="w-3 h-3" /> {t("syncSettings.autoDownloadWifiDesc")}
                </span>
              )}
              {autoDownloadMode === "manual" && (
                <span>{t("syncSettings.autoDownloadManualDesc")}</span>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* Sync not active hint — shown until a room is established. */}
      {!roomId && (
        <div className="bg-card border border-border rounded-lg p-6">
          <div className="flex items-center gap-3">
            <CloudSlash className="w-5 h-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t("syncSettings.syncNotActiveHint")}
            </p>
          </div>
        </div>
      )}

      {/* Reassurance footer */}
      <div className="p-4 bg-muted/30 rounded-lg">
        <div className="flex items-start gap-2">
          <ArrowsClockwise className="w-4 h-4 text-primary mt-0.5" />
          <div className="text-sm text-muted-foreground">
            <p className="font-medium text-foreground mb-1">{t("syncSettings.e2eEncryption")}</p>
            <p>
              {t("syncSettings.e2eFooterDesc")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
