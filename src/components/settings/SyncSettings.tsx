import { useState, useEffect, useMemo } from "react";
import {
  ArrowsClockwise,
  Cloud,
  CloudSlash,
  Copy,
  Download,
  HardDrive,
  Key,
  Lock,
  LockOpen,
  Scan,
  WifiHigh,
} from "@phosphor-icons/react";
import { createNewSyncRoomId, getSyncRoomId, setSyncRoomId, rejoinRoom, updateYjsSyncStatus } from "../../lib/yjsSync";
import { useI18n } from "../../lib/i18n";
import { isNativeMobile, isPWA } from "../../lib/tauri";
import { startSyncSubsystems } from "../../lib/startSyncSubsystems";
import { QRCodeCanvas } from "qrcode.react";
import { SyncQrScanner } from "./SyncQrScanner";
import { SyncedFilesManifestPanel } from "../sync/SyncedFilesManifestPanel";
import { useSettingsStore } from "../../stores/settingsStore";
import {
  enableEncryption,
  enableEncryptionWithSecret,
  disableEncryption,
  isEncryptionEnabled,
  getCachedRoomSecretOrNull,
} from "../../lib/sync/roomCrypto";
import {
  encodeSyncQrPayload,
  parseSyncQrPayload,
  isSyncQrPayload,
  InvalidQrPayloadError,
} from "../../lib/sync/qrFormat";

// Feature flag for the device-sync end-to-end encryption UI. The crypto core,
// secure storage, encrypted provider wrapper, and yjsSync wiring all stay
// loaded regardless — this only gates the user-facing controls.
//
// The forked relay (opaque frame forwarding + encrypted frame-log) is deployed
// at sync.readsync.org, so encrypted rooms replicate correctly. File-blob
// encryption (under the same room key's file sub-key) is wired into the
// file-service transport, so uploads/downloads are ciphertext-only when a key
// is set. Users opt in per room; legacy "TLS only" rooms keep working.
const SYNC_ENCRYPTION_UI_ENABLED = true;

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

  // Encryption state. `encryptionEnabled` reflects whether a derived room key
  // is cached on this device — if so, sync runs through EncryptedWebsocketProvider.
  // `roomSecret` is the user-shareable string (used to populate the QR). It is
  // null when encryption is off OR when we know a key is cached but the secret
  // isn't (e.g. user set it via an older build that didn't persist the secret).
  const [encryptionEnabled, setEncryptionEnabled] = useState(false);
  const [roomSecret, setRoomSecret] = useState<string | null>(null);
  const [revealSecret, setRevealSecret] = useState(false);

  const { settings, updateSettings } = useSettingsStore();
  const syncSettings = settings.sync ?? DEFAULT_SYNC_SETTINGS;
  const yjsSettings = syncSettings.yjs ?? DEFAULT_SYNC_SETTINGS.yjs;
  const autoDownloadMode = syncSettings?.autoDownloadMode ?? "wifi-only";

  const [customUrl, setCustomUrl] = useState(yjsSettings.url || "");

  useEffect(() => {
    setCustomUrl(yjsSettings.url || "");
  }, [yjsSettings.url]);

  useEffect(() => {
    setRoomId(getSyncRoomId());
    if (SYNC_ENCRYPTION_UI_ENABLED) {
      void loadEncryptionState();
    }
  }, []);

  async function loadEncryptionState() {
    try {
      const enabled = await isEncryptionEnabled();
      setEncryptionEnabled(enabled);
      if (enabled) {
        const secret = await getCachedRoomSecretOrNull();
        setRoomSecret(secret);
      } else {
        setRoomSecret(null);
      }
    } catch (err) {
      console.warn("[SyncSettings] failed to load encryption state", err);
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

    // New-format payloads (`incrementum-sync:v1:<roomId>:<secret>`) carry
    // both the room ID and the encryption secret. Legacy plain room IDs are
    // accepted as-is — sync runs in "TLS only" mode for them.
    if (SYNC_ENCRYPTION_UI_ENABLED && isSyncQrPayload(raw)) {
      try {
        const parsed = parseSyncQrPayload(raw);
        await enableEncryptionWithSecret(parsed.roomId, parsed.roomSecret);
        setSyncRoomId(parsed.roomId);
        setRoomId(parsed.roomId);
        setEncryptionEnabled(true);
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
        await rejoinRoom(parsed.roomId);
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
    }

    try {
      setSyncRoomId(raw);
      setRoomId(raw);
      setJoinRoomId("");
      // Replication observers must be attached before rejoinRoom connects to
      // the new room, so we receive the room's existing state on join.
      try {
        await startSyncSubsystems();
      } catch (err) {
        console.warn("[SyncSettings] subsystems start failed before room join", err);
      }
      await rejoinRoom(raw);
      setRoomMessage(t("syncSettings.codeAppliedMsg"));
      return { ok: true };
    } catch (err) {
      const msg = t("syncSettings.failedJoinMsg", { error: (err as Error).message });
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
    // Rotating the room ID invalidates any cached encryption key (the key
    // is derived from the secret + roomId, so the old key won't match the
    // new room). Clear it so the user re-enables encryption explicitly.
    if (SYNC_ENCRYPTION_UI_ENABLED && encryptionEnabled) {
      await disableEncryption().catch((e) =>
        console.warn("[SyncSettings] failed to clear encryption on room rotate", e),
      );
      setEncryptionEnabled(false);
      setRoomSecret(null);
      setRoomMessage(t("syncSettings.newCodeEncryptMsg"));
    } else {
      setRoomMessage(t("syncSettings.newCodeMsg"));
    }
  };

  const handleEnableEncryption = async () => {
    try {
      const secret = await enableEncryption(roomId);
      setEncryptionEnabled(true);
      setRoomSecret(secret);
      setRevealSecret(true);
      // The encryption key is read at provider-construction time, so rebuild
      // the provider against the same room to pick it up without a reload.
      // `forceProviderRebuild` overrides the same-room short-circuit (which
      // would otherwise leave the plaintext provider running until restart).
      await rejoinRoom(roomId, { forceProviderRebuild: true }).catch((e) =>
        console.warn("[SyncSettings] rejoin after enabling encryption failed", e),
      );
      setRoomMessage(t("syncSettings.encryptionEnabledMsg"));
    } catch (err) {
      setRoomMessage(t("syncSettings.failedEnableEncryptionMsg", { error: (err as Error).message }));
    }
  };

  const handleDisableEncryption = async () => {
    if (!confirm(t("syncSettings.confirmDisableEncryption"))) {
      return;
    }
    try {
      await disableEncryption();
      setEncryptionEnabled(false);
      setRoomSecret(null);
      setRevealSecret(false);
      await rejoinRoom(roomId, { forceProviderRebuild: true }).catch((e) =>
        console.warn("[SyncSettings] rejoin after disabling encryption failed", e),
      );
      setRoomMessage(t("syncSettings.encryptionDisabledMsg"));
    } catch (err) {
      setRoomMessage(t("syncSettings.failedDisableMsg", { error: (err as Error).message }));
    }
  };

  const handleResetEncryption = async () => {
    if (
      !confirm(t("syncSettings.confirmResetKey"))
    ) {
      return;
    }
    try {
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

  // QR payload reflects the room + optional secret. When encryption is on
  // AND we have the secret cached, produce the new format so scanning peers
  // join encrypted automatically. Otherwise emit the bare roomId for
  // back-compat with older builds.
  const qrPayload = useMemo(() => {
    if (SYNC_ENCRYPTION_UI_ENABLED && encryptionEnabled && roomSecret) {
      return encodeSyncQrPayload(roomId, roomSecret);
    }
    return roomId;
  }, [roomId, encryptionEnabled, roomSecret]);

  const encryptionStatusLabel = encryptionEnabled
    ? t("syncSettings.statusEncrypted")
    : roomId
      ? t("syncSettings.statusTlsOnly")
      : t("syncSettings.statusNotSyncing");

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
                {SYNC_ENCRYPTION_UI_ENABLED && encryptionEnabled
                  ? t("syncSettings.scanQrEncryptedDesc")
                  : t("syncSettings.scanQrDesc")}
              </div>
            </div>
          )}

          {/* Encryption management — gated by SYNC_ENCRYPTION_UI_ENABLED.
              The supporting modules (encryption, secureStorage,
              encryptedProvider, qrFormat, roomCrypto) stay loaded; only
              the user-facing controls are hidden. */}
          {SYNC_ENCRYPTION_UI_ENABLED && (
            <div className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  {encryptionEnabled ? (
                    <Lock className="w-4 h-4 text-green-500" />
                  ) : (
                    <LockOpen className="w-4 h-4 text-amber-500" />
                  )}
                  <span>{t("syncSettings.e2eTitle")}</span>
                </div>
                <span className="text-xs text-muted-foreground">{encryptionStatusLabel}</span>
              </div>

              {encryptionEnabled ? (
                <>
                  {roomSecret && (
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
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={handleResetEncryption}
                      className="flex-1 px-2 py-1 bg-muted text-foreground rounded text-xs flex items-center justify-center gap-1"
                    >
                      <Key className="w-3 h-3" /> {t("syncSettings.e2eResetKey")}
                    </button>
                    <button
                      onClick={handleDisableEncryption}
                      className="flex-1 px-2 py-1 bg-destructive text-destructive-foreground rounded text-xs"
                    >
                      {t("syncSettings.e2eDisable")}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {t("syncSettings.e2eDisabledDesc")}
                  </p>
                  <button
                    onClick={handleEnableEncryption}
                    className="w-full px-3 py-2 bg-primary text-primary-foreground rounded text-xs flex items-center justify-center gap-1"
                  >
                    <Lock className="w-3 h-3" /> {t("syncSettings.e2eEnable")}
                  </button>
                </>
              )}
            </div>
          )}
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
            <label className="relative inline-flex items-center cursor-pointer">
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
