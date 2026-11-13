import { useState, useEffect } from "react";
import { useModal } from "../common/Modal";
import {
  ArrowsClockwise,
  BookOpen,
  Brain,
  Check,
  Cookie,
  Download,
  FolderOpen,
  Globe,
  HardDrives,
  Info,
  Key,
  Plug,
  Queue,
  Scissors,
  Sparkle,
  Trash,

  Upload,
  WarningCircle,
  X,
  YoutubeLogo,
} from "@phosphor-icons/react";
import { useSettingsStore } from "../../stores/settingsStore";
import { SponsorBlockSettingsPanel } from "./SponsorBlockSettings";
import { NumericInput } from "../common";
import { YouTubePlaylistManager } from "../media/YouTubePlaylistManager";
import { NotebookLMWorkspace } from "./NotebookLMWorkspace";
import {
  getIntegrationSettings,
  updateObsidianConfig,
  updateAnkiConfig,
  testAnkiConnection,
  getAnkiDecks,
  getAnkiModels,
  syncFlashcardsToAnki,
  syncToObsidian,
  syncFromObsidian,
  migrateObsidianVaultIds,
  startBrowserSyncServer,
  stopBrowserSyncServer,
  getBrowserSyncServerStatus,
  getBrowserSyncConfig,
  setBrowserSyncConfig,
  type ObsidianConfig,
  type AnkiConfig,
} from "../../api/integrations";
import { openFolderPicker, openFilePicker, isTauri, invokeCommand } from "../../lib/tauri";
import {
  getStoredYouTubeCookies,
  storeYouTubeCookies,
  clearYouTubeCookies,
  parseCookiesFromString,
  testYouTubeCookies,
  validateYouTubeCookies,
  type YouTubeCookie,
} from "../../utils/youtubeCookies";
import { useI18n } from "../../lib/i18n";
import { SettingsSearchTarget } from "./search/SettingsSearchNavigation";
import { useToast } from "../common/Toast";
import { useApiTokensStore } from "../../stores/apiTokensStore";
import { usePlatformCapability } from "../../hooks/usePlatformCapability";
import { isPlethoraCloudAvailable } from "../../config/product";

type IntegrationType =
  | "obsidian"
  | "anki"
  | "extension"
  | "notebooklm"
  | "youtube"
  | "youtube-cookies"
  | "youtube-transcript"
  | "sponsorblock"
  | "api-tokens";


export function IntegrationSettings() {
  const { t } = useI18n();
  const [settings, setSettings] = useState(getIntegrationSettings());
  const [activeTab, setActiveTab] = useState<IntegrationType>("obsidian");

  // §2.4 / §2.5: browser-extension sync server and the NotebookLM CLI
  // workspace are desktop-only mechanics (localhost socket / external
  // `notebooklm-py` CLI). Their tabs are hidden on mobile via the platform
  // capability registry; visibility only — no logic changes.
  const extensionServerAvailable = usePlatformCapability("browser_extension_server").available;
  const notebooklmAvailable = usePlatformCapability("notebooklm_cli").available;

  const { settings: globalSettings, updateSettings } = useSettingsStore();

  const handleUpdateTranscriptSettings = (updates: Partial<{ transcriptServerUrl: string; transcriptServerApiKey: string; transcriptOnDeviceEnabled: boolean }>) => {
    updateSettings({
      youtube: {
        ...globalSettings.youtube,
        ...updates,
      }
    });
  };

  const modal = useModal();

  // Obsidian state
  const [obsidianVault, setObsidianVault] = useState("");
  const [obsidianNotes, setObsidianNotes] = useState("Plethora");
  const [obsidianAttachments, setObsidianAttachments] = useState("Plethora Assets");
  const [obsidianDataview, setObsidianDataview] = useState("");

  // Anki state
  const [ankiUrl, setAnkiUrl] = useState("http://localhost:8765");
  const [ankiDeck, setAnkiDeck] = useState("Plethora");
  const [ankiModel, setAnkiModel] = useState("Basic");
  const [ankiConnected, setAnkiConnected] = useState(false);
  const [ankiDecks, setAnkiDecks] = useState<string[]>([]);
  const [ankiModels, setAnkiModels] = useState<string[]>([]);

  // Extension state
  const [extensionPort, setExtensionPort] = useState(8766);
  const [extensionAutoStart, setExtensionAutoStart] = useState(false);
  const [extensionStatus, setExtensionStatus] = useState<{
    running: boolean;
    port: number;
    connections: number;
  }>({ running: false, port: 8766, connections: 0 });

  // YouTube Cookies state
  const [youtubeCookies, setYoutubeCookies] = useState<YouTubeCookie[]>([]);
  const [cookieInput, setCookieInput] = useState("");
  const [cookieFilePath, setCookieFilePath] = useState<string>(() => {
    return localStorage.getItem("plethora_youtube_cookie_file") || "";
  });
  const [cookieTestStatus, setCookieTestStatus] = useState<{
    status: "idle" | "testing" | "success" | "error";
    message: string;
  }>({ status: "idle", message: "" });
  const [showCookieInput, setShowCookieInput] = useState(false);

  const handleCookieFilePathChange = async (path: string) => {
    setCookieFilePath(path);
    try {
      localStorage.setItem("plethora_youtube_cookie_file", path);
      if (isTauri()) {
        await invokeCommand("set_youtube_cookies_path", { path: path ? path.trim() : null });
      }
    } catch (e) {
      console.error("Failed to persist custom cookies path:", e);
    }
  };

  // Operation status
  const [isOperating, setIsOperating] = useState(false);
  const [operationResult, setOperationResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Transcript Diagnostics State & Actions
  const [testResult, setTestResult] = useState<{
    testing: boolean;
    onDevice?: { available: boolean; platform: string };
    vps?: { online: boolean; statusText: string; workersAvailable?: number; workers?: Record<string, string>; cacheSize?: number };
    lastDiagnostic?: any;
  } | null>(null);

  const runTranscriptDiagnostics = async () => {
    setTestResult((prev) => ({ ...prev, testing: true }));
    const result: typeof testResult = { testing: true };

    if (isTauri()) {
      try {
        const { invokeCommand } = await import("../../lib/tauri");
        const onDevice = await invokeCommand<any>("on_device_transcript_available");
        result.onDevice = {
          available: onDevice.available,
          platform: onDevice.platform,
        };
      } catch {
        result.onDevice = { available: false, platform: "unknown" };
      }
    } else {
      result.onDevice = { available: false, platform: "web" };
    }

    const vpsUrl = globalSettings.youtube?.transcriptServerUrl;
    const vpsKey = globalSettings.youtube?.transcriptServerApiKey;
    if (vpsUrl) {
      try {
        const base = vpsUrl.replace(/\/api\/?$/, "").replace(/\/+$/, "");
        const headers: Record<string, string> = {};
        if (vpsKey) headers["X-API-Key"] = vpsKey;

        const res = await fetch(`${base}/health`, { headers });
        if (res.ok) {
          const healthData = await res.json();
          result.vps = {
            online: true,
            statusText: t("i18nAudit.ui.connected-successfully.a8defc9c"),
            workersAvailable: healthData.workers_available,
            workers: healthData.workers,
            cacheSize: healthData.cache_size,
          };
        } else {
          result.vps = {
            online: false,
            statusText: `Server returned HTTP ${res.status}`,
          };
        }
      } catch (e: any) {
        result.vps = {
          online: false,
          statusText: e.message || "Failed to reach server",
        };
      }
    }

    try {
      const { getLastDiagnostic } = await import("../../lib/transcript/sourceChain");
      result.lastDiagnostic = getLastDiagnostic();
    } catch {}

    setTestResult({ ...result, testing: false });
  };

  useEffect(() => {
    if (activeTab === "youtube-transcript") {
      import("../../lib/transcript/sourceChain").then(({ getLastDiagnostic }) => {
        const last = getLastDiagnostic();
        if (last) {
          setTestResult((prev) => ({ ...prev, testing: false, lastDiagnostic: last }));
        }
      });
    }
  }, [activeTab]);

  useEffect(() => {
    const loaded = getIntegrationSettings();
    setSettings(loaded);

    if (loaded.obsidian) {
      setObsidianVault(loaded.obsidian.vaultPath);
      setObsidianNotes(loaded.obsidian.notesFolder);
      setObsidianAttachments(loaded.obsidian.attachmentsFolder);
      setObsidianDataview(loaded.obsidian.dataviewFolder || "");
    }

    if (loaded.anki) {
      setAnkiUrl(loaded.anki.url);
      setAnkiDeck(loaded.anki.deckName);
      setAnkiModel(loaded.anki.modelName);
    }

    setExtensionPort(loaded.extensionPort);
  }, []);

  useEffect(() => {
    const loadBrowserSyncConfig = async () => {
      try {
        const config = await getBrowserSyncConfig();
        setExtensionPort(config.port);
        setExtensionAutoStart(config.autoStart);
      } catch {
        // Ignore errors
      }
    };
    loadBrowserSyncConfig();
  }, []);

  useEffect(() => {
    loadExtensionStatus();
    const interval = setInterval(loadExtensionStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    setYoutubeCookies(getStoredYouTubeCookies());
    if (isTauri()) {
      invokeCommand<string | null>("get_youtube_cookies_path")
        .then((path) => {
          if (path) {
            setCookieFilePath(path);
            localStorage.setItem("plethora_youtube_cookie_file", path);
          }
        })
        .catch(() => {});
    }
  }, []);

  const loadExtensionStatus = async () => {
    try {
      const status = await getBrowserSyncServerStatus(extensionPort);
      setExtensionStatus(status);
    } catch {
      // Ignore errors
    }
  };

  const buildObsidianConfig = (): ObsidianConfig => ({
      vaultPath: obsidianVault,
      notesFolder: obsidianNotes || "Plethora",
      attachmentsFolder: obsidianAttachments || "Plethora Assets",
      dataviewFolder: obsidianDataview || undefined,
  });

  const handleSaveObsidian = () => {
    const config: ObsidianConfig = {
      vaultPath: obsidianVault,
      notesFolder: obsidianNotes,
      attachmentsFolder: obsidianAttachments,
      dataviewFolder: obsidianDataview || undefined,
    };
    updateObsidianConfig(config);
    showResult(true, t("integrations.obsidianConfigurationSaved"));
  };

  // Test Anki connection
  const handleTestAnki = async () => {
    setIsOperating(true);
    try {
      const connected = await testAnkiConnection(ankiUrl);
      setAnkiConnected(connected);

      if (connected) {
        const [decks, models] = await Promise.all([
          getAnkiDecks(ankiUrl),
          getAnkiModels(ankiUrl),
        ]);
        setAnkiDecks(decks);
        setAnkiModels(models);
        showResult(true, t("integrations.connectedToAnki"));
      } else {
        showResult(false, t("integrations.failedConnectToAnki"));
      }
    } catch {
      setAnkiConnected(false);
      showResult(false, t("integrations.failedTestAnkiConnection"));
    } finally {
      setIsOperating(false);
    }
  };

  const handleSaveAnki = () => {
    const config: AnkiConfig = {
      url: ankiUrl,
      deckName: ankiDeck,
      modelName: ankiModel,
    };
    updateAnkiConfig(config);
    showResult(true, t("integrations.ankiConfigurationSaved"));
  };

  // Toggle extension server
  const handleToggleExtension = async () => {
    setIsOperating(true);
    try {
      if (extensionStatus.running) {
        await stopBrowserSyncServer();
        showResult(true, t("integrations.extensionServerStopped"));
      } else {
        await startBrowserSyncServer(extensionPort);
        showResult(true, t("integrations.extensionServerStarted"));
      }
      loadExtensionStatus();
    } catch {
      showResult(false, t("integrations.failedToggleExtensionServer"));
    } finally {
      setIsOperating(false);
    }
  };

  const handleExtensionConfigChange = async (port?: number, autoStart?: boolean) => {
    try {
      await setBrowserSyncConfig({
        host: "127.0.0.1",
        port: port ?? extensionPort,
        autoStart: autoStart ?? extensionAutoStart,
      });
      if (autoStart !== undefined) {
        setExtensionAutoStart(autoStart);
      }
    } catch {
      // Ignore errors
    }
  };

  // YouTube Cookies handlers
  const handleSaveCookies = () => {
    if (!cookieInput.trim()) {
      showResult(false, t("integrations.pleaseEnterCookies"));
      return;
    }

    try {
      const parsed = parseCookiesFromString(cookieInput);
      if (parsed.length === 0) {
        showResult(false, t("integrations.noValidCookiesFound"));
        return;
      }

      const validation = validateYouTubeCookies(parsed);
      storeYouTubeCookies(parsed);
      setYoutubeCookies(parsed);
      setCookieInput("");
      setShowCookieInput(false);

      if (validation.valid) {
        showResult(
          true,
          `Saved ${parsed.length} cookies. ${validation.hasAuth ? "Authentication cookies detected!" : ""}`
        );
      } else {
        showResult(
          true,
          `Saved ${parsed.length} cookies. Warning: Missing recommended cookies: ${validation.missing.join(", ")}`
        );
      }
    } catch (error) {
      showResult(false, error instanceof Error ? error.message : t("integrations.failedParseCookies"));
    }
  };

  const handleTestCookies = async () => {
    if (youtubeCookies.length === 0) {
      showResult(false, t("integrations.noCookiesToTest"));
      return;
    }

    setCookieTestStatus({ status: "testing", message: t("integrations.testingCookies") });

    const result = await testYouTubeCookies(youtubeCookies);

    if (result.success) {
      setCookieTestStatus({ status: "success", message: result.message });
      showResult(true, result.message);
    } else {
      setCookieTestStatus({ status: "error", message: result.message });
      showResult(false, result.message);
    }

    setTimeout(() => {
      setCookieTestStatus({ status: "idle", message: "" });
    }, 5000);
  };

  const handleClearCookies = () => {
    clearYouTubeCookies();
    setYoutubeCookies([]);
    setCookieTestStatus({ status: "idle", message: "" });
    showResult(true, t("integrations.cookiesCleared"));
  };

  const showResult = (success: boolean, message: string) => {
    setOperationResult({ success, message });
    setTimeout(() => setOperationResult(null), 3000);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Plug className="w-6 h-6 text-primary" />
        <h2 className="text-2xl font-bold text-foreground">{t("integrations.title")}</h2>
      </div>

      {/* Search-only reveal resolvers: open the owning tab before its content
          (and the actual target) mounts. They are not focus destinations. */}
      <div className="hidden" aria-hidden="true">
        <SettingsSearchTarget id="integrations.reveal.obsidian" reveal={() => setActiveTab("obsidian")} />
        <SettingsSearchTarget id="integrations.reveal.anki" reveal={() => setActiveTab("anki")} />
        <SettingsSearchTarget id="integrations.reveal.extension" reveal={() => setActiveTab("extension")} />
        <SettingsSearchTarget id="integrations.reveal.youtube" reveal={() => setActiveTab("youtube")} />
        <SettingsSearchTarget id="integrations.reveal.youtube-cookies" reveal={() => setActiveTab("youtube-cookies")} />
        <SettingsSearchTarget id="integrations.reveal.youtube-transcript" reveal={() => setActiveTab("youtube-transcript")} />
        <SettingsSearchTarget id="integrations.reveal.notebooklm" reveal={() => setActiveTab("notebooklm")} />
        <SettingsSearchTarget id="integrations.reveal.api-tokens" reveal={() => setActiveTab("api-tokens")} />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setActiveTab("obsidian")}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            activeTab === "obsidian"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:opacity-90"
          }`}
        >
          <BookOpen className="w-4 h-4" />
          {t("integrations.obsidian")}
        </button>
        <button
          onClick={() => setActiveTab("anki")}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            activeTab === "anki"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:opacity-90"
          }`}
        >
          <Brain className="w-4 h-4" />
          {t("integrations.anki")}
        </button>
        {extensionServerAvailable && (
          <button
            onClick={() => setActiveTab("extension")}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
              activeTab === "extension"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:opacity-90"
            }`}
          >
            <Globe className="w-4 h-4" />
            {t("integrations.browserExtension")}
          </button>
        )}
        {notebooklmAvailable && (
          <button
            onClick={() => setActiveTab("notebooklm")}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
              activeTab === "notebooklm"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:opacity-90"
            }`}
          >
            <Sparkle className="w-4 h-4" />
            {t("integrations.notebooklm")}
          </button>
        )}
        <button
          onClick={() => setActiveTab("youtube")}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            activeTab === "youtube"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:opacity-90"
          }`}
        >
          <Queue className="w-4 h-4" />
          {t("integrations.youtubePlaylists")}
        </button>
        <button
          onClick={() => setActiveTab("youtube-cookies")}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            activeTab === "youtube-cookies"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:opacity-90"
          }`}
        >
          <Cookie className="w-4 h-4" />
          {t("integrations.youtubeCookies")}
        </button>
        <button
          onClick={() => setActiveTab("youtube-transcript")}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            activeTab === "youtube-transcript"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:opacity-90"
          }`}
        >
          <YoutubeLogo className="w-4 h-4" />
          {t("integrations.youtubeTranscript")}
        </button>
        <button
          onClick={() => setActiveTab("sponsorblock")}
          className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
            activeTab === "sponsorblock"
              ? "bg-primary text-primary-foreground"
              : "bg-secondary text-secondary-foreground hover:opacity-90"
          }`}
        >
          <Scissors className="w-4 h-4" />
          {t("integrations.sponsorBlock")}
        </button>
        {isPlethoraCloudAvailable() && (
          <button
            onClick={() => setActiveTab("api-tokens")}
            className={`px-4 py-2 rounded-lg flex items-center gap-2 transition-colors ${
              activeTab === "api-tokens"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:opacity-90"
            }`}
          >
            <Key className="w-4 h-4" />
            {t("i18nAudit.ui.api-webhooks.cf5ae9f7")}</button>
        )}
      </div>

      {/* Result notification */}
      {operationResult && (
        <div
          className={`p-4 rounded-lg flex items-center gap-2 ${
            operationResult.success
              ? "bg-green-500/10 text-green-500 border border-green-500/20"
              : "bg-destructive/10 text-destructive border border-destructive/20"
          }`}
        >
          {operationResult.success ? (
            <Check className="w-4 h-4" />
          ) : (
            <X className="w-4 h-4" />
          )}
          <span>{operationResult.message}</span>
        </div>
      )}

      {/* Obsidian Settings */}
      {activeTab === "sponsorblock" && (
        <div className="bg-card text-card-foreground border border-border rounded-xl p-6 shadow-sm">
          <h3 className="text-lg font-semibold text-foreground mb-3">
            {t("integrations.sponsorBlock")}
          </h3>
          <SponsorBlockSettingsPanel />
        </div>
      )}

      {activeTab === "obsidian" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <BookOpen className="w-5 h-5 text-purple-500" />
              <SettingsSearchTarget id="integrations.obsidian" label={t("integrations.obsidianIntegration")}>
<h3 className="text-lg font-semibold text-foreground">{t("integrations.obsidianIntegration")}</h3>
              </SettingsSearchTarget>
            </div>

            <div className="space-y-4">
              {/* Vault path */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t("integrations.vaultPath")}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={obsidianVault}
                    onChange={(e) => setObsidianVault(e.target.value)}
                    placeholder="/home/user/Documents/ObsidianVault"
                    className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    onClick={async () => {
                      try {
                        const folder = await openFolderPicker({
                          title: t("integrations.selectObsidianVaultFolder"),
                        });
                        if (folder) {
                          setObsidianVault(folder);
                        }
                      } catch (error) {
                        console.error("Failed to open folder picker:", error);
                        showResult(false, t("integrations.failedOpenFolderPicker"));
                      }
                    }}
                    className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 flex items-center gap-2"
                  >
                    <FolderOpen className="w-4 h-4" />
                    {t("integrations.browse")}
                  </button>
                </div>
              </div>

              {/* Notes folder */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t("integrations.notesFolder")}
                </label>
                <input
                  type="text"
                  value={obsidianNotes}
                  onChange={(e) => setObsidianNotes(e.target.value)}
                  placeholder="Plethora"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Attachments folder */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t("integrations.attachmentsFolder")}
                </label>
                <input
                  type="text"
                  value={obsidianAttachments}
                  onChange={(e) => setObsidianAttachments(e.target.value)}
                  placeholder="Plethora Assets"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Dataview folder */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t("integrations.dataviewFolderOptional")}
                </label>
                <input
                  type="text"
                  value={obsidianDataview}
                  onChange={(e) => setObsidianDataview(e.target.value)}
                  placeholder="Dataview"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Save button */}
              <button
                onClick={handleSaveObsidian}
                className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
              >
                {t("integrations.saveObsidianConfiguration")}
              </button>
            </div>
          </div>

          {/* One-time vault id migration (opt-in, default off) */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h4 className="font-semibold text-foreground mb-2">
              {t("integrations.migrateVaultIdsTitle")}
            </h4>
            <p className="text-sm text-muted-foreground mb-4">
              {t("integrations.migrateVaultIdsDesc")}
            </p>
            <button
              onClick={async () => {
                const config = buildObsidianConfig();
                if (!config.vaultPath) {
                  showResult(false, t("integrations.migrateVaultIdsNeedVault"));
                  return;
                }
                const confirmed = await modal.confirm(
                  t("integrations.migrateVaultIdsConfirm", {
                    notes: config.notesFolder,
                  }),
                  t("integrations.migrateVaultIdsTitle"),
                  { confirmText: t("integrations.migrateVaultIdsButton") }
                );
                if (!confirmed) {
                  return;
                }
                setIsOperating(true);
                try {
                  const result = await migrateObsidianVaultIds(config);
                  showResult(
                    result.errors.length === 0,
                    t("integrations.migrateVaultIdsResult", {
                      rewritten: result.filesRewritten,
                      scanned: result.filesScanned,
                    }) + (result.errors.length ? ` (${result.errors.length} errors, see logs)` : "")
                  );
                  if (result.errors.length) {
                    console.warn("[migrateVaultIds]", result.errors);
                  }
                } catch (error) {
                  console.error("Vault id migration failed:", error);
                  showResult(false, t("integrations.migrateVaultIdsFailed"));
                } finally {
                  setIsOperating(false);
                }
              }}
              disabled={isOperating}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {t("integrations.migrateVaultIdsButton")}
            </button>
          </div>

          {/* AI Conversation Export Info */}
          <div className="bg-card border border-border rounded-lg p-6">
            <h4 className="font-semibold text-foreground mb-2">{t("integrations.aiConversationExport")}</h4>
            <p className="text-sm text-muted-foreground mb-4">
              {t("integrations.aiConversationExportDesc")}
            </p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Info className="w-4 h-4 text-blue-500" />
              <span>{t("integrations.conversationsExportedAsMarkdown")}</span>
            </div>
          </div>

          {/* Sync actions */}
          {settings.obsidian && (
            <div className="bg-card border border-border rounded-lg p-6">
              <h4 className="font-semibold text-foreground mb-4">{t("integrations.syncActions")}</h4>
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    setIsOperating(true);
                    try {
                      await syncToObsidian(settings.obsidian);
                      showResult(true, t("integrations.syncedToObsidian"));
                    } catch {
                      showResult(false, t("integrations.failedSyncToObsidian"));
                    } finally {
                      setIsOperating(false);
                    }
                  }}
                  disabled={isOperating}
                  className="flex-1 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  {t("integrations.syncAllToObsidian")}
                </button>
                <button
                  onClick={async () => {
                    setIsOperating(true);
                    try {
                      await syncFromObsidian(settings.obsidian);
                      showResult(true, t("integrations.syncedFromObsidian"));
                    } catch {
                      showResult(false, t("integrations.failedSyncFromObsidian"));
                    } finally {
                      setIsOperating(false);
                    }
                  }}
                  disabled={isOperating}
                  className="flex-1 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  {t("integrations.syncFromObsidian")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Anki Settings */}
      {activeTab === "anki" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <Brain className="w-5 h-5 text-blue-500" />
              <SettingsSearchTarget id="integrations.anki" label={t("integrations.ankiIntegration")}>
<h3 className="text-lg font-semibold text-foreground">{t("integrations.ankiIntegration")}</h3>
              </SettingsSearchTarget>
              {ankiConnected && (
                <span className="ml-auto px-2 py-1 bg-green-500/20 text-green-500 text-xs rounded-full flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  {t("common.connected")}
                </span>
              )}
            </div>

            <div className="space-y-4">
              {/* Anki URL */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t("integrations.ankiConnectUrl")}
                </label>
                <input
                  type="text"
                  value={ankiUrl}
                  onChange={(e) => setAnkiUrl(e.target.value)}
                  placeholder="http://localhost:8765"
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Test connection */}
              <button
                onClick={handleTestAnki}
                disabled={isOperating}
                className="w-full px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <ArrowsClockwise className={`w-4 h-4 ${isOperating ? "animate-spin" : ""}`} />
                {t("integrations.testConnection")}
              </button>

              {/* Deck selection */}
              {ankiConnected && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      {t("integrations.targetDeck")}
                    </label>
                    <select
                      value={ankiDeck}
                      onChange={(e) => setAnkiDeck(e.target.value)}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ankiDecks.map((deck) => (
                        <option key={deck} value={deck}>
                          {deck}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Model selection */}
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      {t("integrations.cardModel")}
                    </label>
                    <select
                      value={ankiModel}
                      onChange={(e) => setAnkiModel(e.target.value)}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      {ankiModels.map((model) => (
                        <option key={model} value={model}>
                          {model}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Save button */}
                  <button
                    onClick={handleSaveAnki}
                    className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
                  >
                    {t("integrations.saveAnkiConfiguration")}
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Sync actions */}
          {settings.anki && ankiConnected && (
            <div className="bg-card border border-border rounded-lg p-6">
              <h4 className="font-semibold text-foreground mb-4">{t("integrations.syncActions")}</h4>
              <p className="text-sm text-muted-foreground mb-4">
                {t("integrations.syncFlashcardsFromPlethoraToAnki")}
              </p>
              <button
                onClick={async () => {
                  setIsOperating(true);
                  try {
                    const result = await syncFlashcardsToAnki([], settings.anki);
                    showResult(
                      true,
                      `Synced ${result.added} cards to Anki${result.failed > 0 ? ` (${result.failed} failed)` : ""}`
                    );
                  } catch {
                    showResult(false, t("integrations.failedSyncToAnki"));
                  } finally {
                    setIsOperating(false);
                  }
                }}
                disabled={isOperating}
                className="w-full px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Upload className="w-4 h-4" />
                {t("integrations.syncFlashcardsToAnki")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Browser Extension Settings */}
      {activeTab === "extension" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <Globe className="w-5 h-5 text-green-500" />
              <SettingsSearchTarget id="integrations.browserExtension" label={t("integrations.browserExtensionServer")}>
<h3 className="text-lg font-semibold text-foreground">{t("integrations.browserExtensionServer")}</h3>
              </SettingsSearchTarget>
              {extensionStatus.running && (
                <span className="ml-auto px-2 py-1 bg-green-500/20 text-green-500 text-xs rounded-full flex items-center gap-1">
                  <HardDrives className="w-3 h-3" />
                  {t("integrations.running")}
                </span>
              )}
            </div>

            <div className="space-y-4">
              {/* Port */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  {t("integrations.httpServerPort")}
                </label>
                <NumericInput
                  value={extensionPort}
                  onChange={(value) => setExtensionPort(value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t("integrations.defaultPortHint")}
                </p>
              </div>

              {/* Auto-start toggle */}
              <div className="flex items-center justify-between">
                <div>
                  <label className="block text-sm font-medium text-foreground">
                    {t("integrations.autoStartOnAppLaunch")}
                  </label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("integrations.autoStartDesc")}
                  </p>
                </div>
                <button
                  onClick={() => handleExtensionConfigChange(undefined, !extensionAutoStart)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    extensionAutoStart ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      extensionAutoStart ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Status info */}
              {extensionStatus.running && (
                <div className="p-3 bg-muted/30 rounded-lg">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("integrations.status")}</span>
                    <span className="text-green-500">{t("integrations.running")}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("integrations.port")}</span>
                    <span className="text-foreground">{extensionStatus.port}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{t("integrations.connections")}</span>
                    <span className="text-foreground">{extensionStatus.connections}</span>
                  </div>
                </div>
              )}

              {/* Toggle button */}
              <button
                onClick={handleToggleExtension}
                disabled={isOperating}
                className={`w-full px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 ${
                  extensionStatus.running
                    ? "bg-destructive text-destructive-foreground"
                    : "bg-primary text-primary-foreground"
                }`}
              >
                <HardDrives className="w-4 h-4" />
                {extensionStatus.running ? t("integrations.stopServer") : t("integrations.startServer")}
              </button>
            </div>
          </div>

          {/* Info */}
          <div className="p-4 bg-muted/30 rounded-lg">
            <p className="text-sm text-muted-foreground">
              {t("integrations.browserExtensionInfo", { port: extensionPort })}
            </p>
          </div>
        </div>
      )}

      {/* YouTube Playlist Settings */}
      {activeTab === "youtube" && (
        <SettingsSearchTarget id="integrations.youtubePlaylist" label={t("integrations.youtubePlaylists")}>
          <div className="space-y-4">
            <div className="bg-card border border-border rounded-lg p-6">
              <YouTubePlaylistManager />
            </div>
          </div>
        </SettingsSearchTarget>
      )}

      {/* NotebookLM Settings */}
      {activeTab === "notebooklm" && (
        <SettingsSearchTarget id="integrations.notebooklm" label={t("integrations.notebooklm")}>
          <NotebookLMWorkspace />
        </SettingsSearchTarget>
      )}

      {/* YouTube Cookies Settings */}
      {activeTab === "youtube-cookies" && (
        <div className="space-y-4">
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="flex items-center gap-3 mb-4">
              <Cookie className="w-5 h-5 text-red-500" />
              <SettingsSearchTarget id="integrations.youtubeCookies" label={t("integrations.youtubeAuthCookies")}>
<h3 className="text-lg font-semibold text-foreground">{t("integrations.youtubeAuthCookies")}</h3>
              </SettingsSearchTarget>
              {youtubeCookies.length > 0 && (
                <span className="ml-auto px-2 py-1 bg-green-500/20 text-green-500 text-xs rounded-full flex items-center gap-1">
                  <Check className="w-3 h-3" />
                  {t("integrations.cookiesCount", { count: youtubeCookies.length })}
                </span>
              )}
            </div>

            <div className="space-y-4">
              {/* Info banner */}
              <div className="p-4 bg-muted/30 rounded-lg flex gap-3">
                <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">{t("integrations.whyUploadCookies")}</p>
                  <p>
                    {t("integrations.whyUploadCookiesDesc")}
                  </p>
                </div>
              </div>

              {/* Cookie status */}
              {youtubeCookies.length > 0 ? (
                <div className="p-4 bg-muted/30 rounded-lg">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-foreground">{t("integrations.cookiesStored")}</span>
                    <span className="text-sm text-green-500">{t("integrations.cookiesCount", { count: youtubeCookies.length })}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleTestCookies}
                      disabled={cookieTestStatus.status === "testing"}
                      className="flex-1 px-3 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center justify-center gap-2 text-sm"
                    >
                      <ArrowsClockwise className={`w-4 h-4 ${cookieTestStatus.status === "testing" ? "animate-spin" : ""}`} />
                      {cookieTestStatus.status === "testing" ? t("integrations.testingCookies") : t("integrations.testCookies")}
                    </button>
                    <button
                      onClick={handleClearCookies}
                      className="px-3 py-2 bg-destructive/20 text-destructive rounded-lg hover:opacity-90 flex items-center justify-center gap-2 text-sm"
                    >
                      <Trash className="w-4 h-4" />
                      {t("common.clear")}
                    </button>
                  </div>
                  {cookieTestStatus.status !== "idle" && (
                    <div className={`mt-2 text-sm flex items-center gap-2 ${
                      cookieTestStatus.status === "success" ? "text-green-500" :
                      cookieTestStatus.status === "error" ? "text-destructive" :
                      "text-muted-foreground"
                    }`}>
                      {cookieTestStatus.status === "success" && <Check className="w-4 h-4" />}
                      {cookieTestStatus.status === "error" && <X className="w-4 h-4" />}
                      {cookieTestStatus.message}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <WarningCircle className="w-4 h-4" />
                    <span className="text-sm">{t("integrations.noCookiesStored")}</span>
                  </div>
                </div>
              )}

              {/* Cookie input area */}
              {!showCookieInput ? (
                <button
                  onClick={() => setShowCookieInput(true)}
                  className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 flex items-center justify-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  {t("integrations.uploadCookies")}
                </button>
              ) : (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-2">
                      {t("integrations.pasteYoutubeCookies")}
                    </label>
                    <textarea
                      value={cookieInput}
                      onChange={(e) => setCookieInput(e.target.value)}
                      placeholder='[{"name": "VISITOR_INFO1_LIVE", "value": "...", "domain": ".youtube.com"}, ...]'
                      rows={6}
                      className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm font-mono"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveCookies}
                      className="flex-1 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
                    >
                      {t("integrations.saveCookies")}
                    </button>
                    <button
                      onClick={() => {
                        setShowCookieInput(false);
                        setCookieInput("");
                      }}
                      className="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              )}

              {/* Custom Cookies File Path */}
              <SettingsSearchTarget id="setting-youtube-cookie-file" label={t("integrations.youtubeCookieFile")}>
                <div className="p-4 bg-muted/30 rounded-lg space-y-2">
                  <label className="block text-sm font-medium text-foreground">
                    {t("integrations.youtubeCookieFile")}
                  </label>
                  <p className="text-xs text-muted-foreground">
                    {t("integrations.youtubeCookieFileDesc")}
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={cookieFilePath}
                      onChange={(e) => handleCookieFilePathChange(e.target.value)}
                      placeholder="/path/to/cookies.txt"
                      aria-label={t("integrations.youtubeCookieFilePath")}
                      className="flex-1 px-3 py-1.5 bg-background border border-border rounded-lg text-sm font-mono text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const file = await openFilePicker({
                            title: t("integrations.selectCookieFile"),
                            filters: [{ name: t("integrations.cookieFileFilter"), extensions: ["txt"] }],
                          });
                          if (file && typeof file === "string") {
                            handleCookieFilePathChange(file);
                          }
                        } catch (err) {
                          console.error("Failed to select cookies file:", err);
                        }
                      }}
                      className="px-3 py-1.5 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 flex items-center gap-1.5 text-xs font-medium"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      {t("common.browse")}
                    </button>
                  </div>
                </div>
              </SettingsSearchTarget>

              {/* Instructions */}
              <div className="p-4 bg-muted/30 rounded-lg">
                <p className="text-sm font-medium text-foreground mb-2">{t("integrations.howToGetCookies")}</p>
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal list-inside">
                  <li>{t("integrations.cookieInstruction1")}</li>
                  <li>{t("integrations.cookieInstruction2")}</li>
                  <li>{t("integrations.cookieInstruction3")}</li>
                  <li>{t("integrations.cookieInstruction4")}</li>
                </ol>
                <p className="text-xs text-muted-foreground mt-3">
                  {t("integrations.cookieImportantNote")}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "youtube-transcript" && (
        <div className="bg-card text-card-foreground border border-border rounded-xl p-6 shadow-sm">
          <div className="space-y-6">
            <div>
              <SettingsSearchTarget id="integrations.youtubeTranscripts" label={t("integrations.youtubeTranscripts")}>
<h3 className="text-lg font-semibold text-foreground">{t("integrations.youtubeTranscripts")}</h3>
              </SettingsSearchTarget>
              <p className="text-sm text-muted-foreground mt-1">
                {t("integrations.youtubeTranscriptsDesc")}
              </p>
            </div>

            {/* Toggle Row */}
            <div className="flex items-center justify-between p-4 border border-border rounded-xl bg-background/50">
              <div className="space-y-0.5 max-w-[80%]">
                <span className="block text-sm font-medium text-foreground">
                  {t("integrations.onDeviceFetching")}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {t("integrations.onDeviceFetchingDesc")}
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={globalSettings.youtube?.transcriptOnDeviceEnabled ?? true}
                  onChange={(e) => handleUpdateTranscriptSettings({ transcriptOnDeviceEnabled: e.target.checked })}
                />
                <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
              </label>
            </div>

            <div className="border-t border-border pt-4">
              <h4 className="text-sm font-medium text-foreground mb-3">{t("integrations.selfHostedSettings")}</h4>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-2">
                    {t("i18nAudit.ui.server-endpoint-base-url.7a8ce94a")}</label>
                  <input
                    type="url"
                    value={globalSettings.youtube?.transcriptServerUrl || ""}
                    onChange={(e) => handleUpdateTranscriptSettings({ transcriptServerUrl: e.target.value })}
                    placeholder="https://transcripts.yourdomain.com"
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("i18nAudit.ui.the-api-endpoint-resolves-to.64da9251", { var0: "{Server URL}/api/youtube/transcript" })}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-medium text-foreground mb-2">
                    {t("i18nAudit.ui.server-api-key.bb659c43")}</label>
                  <input
                    type="password"
                    value={globalSettings.youtube?.transcriptServerApiKey || ""}
                    onChange={(e) => handleUpdateTranscriptSettings({ transcriptServerApiKey: e.target.value })}
                    placeholder={t("i18nAudit.ui.enter-your-transcript-server.d166b14a")}
                    className="w-full px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm font-mono"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("i18nAudit.ui.required-when-your-self-host.523b081e", { var0: "TRANSCRIPT_API_KEY" })}
                  </p>
                </div>
              </div>
            </div>

            {/* Diagnostics Panel */}
            <div className="border-t border-border pt-4">
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-sm font-medium text-foreground">{t("integrations.diagnostics")}</h4>
                <button
                  type="button"
                  disabled={testResult?.testing}
                  onClick={runTranscriptDiagnostics}
                  className="px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg hover:bg-primary/95 focus:outline-none disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                >
                  <ArrowsClockwise className={`w-3.5 h-3.5 ${testResult?.testing ? "animate-spin" : ""}`} />
                  {testResult?.testing ? t("integrations.testing") : t("integrations.testConnectivity")}
                </button>
              </div>

              {testResult && (
                <div className="space-y-4">
                  {/* On-device capability status */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-3 border border-border rounded-xl bg-background/30 flex flex-col gap-1">
                      <span className="text-xs font-medium text-muted-foreground">{t("integrations.onDeviceSupport")}</span>
                      {testResult.onDevice ? (
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className={`w-2 h-2 rounded-full ${testResult.onDevice.available ? "bg-emerald-500" : "bg-amber-500"}`} />
                          <span className="text-sm font-semibold text-foreground">
                            {testResult.onDevice.available
                              ? t("i18nAudit.ui.available-var0.6730cc42", {var0: testResult.onDevice.platform})
                              : t("i18nAudit.ui.not-supported-on-web.30fa4eb5")}
                          </span>
                        </div>
                      ) : (
                        <span className="text-sm text-foreground">-</span>
                      )}
                    </div>

                    {/* VPS status */}
                    {globalSettings.youtube?.transcriptServerUrl && (
                      <div className="p-3 border border-border rounded-xl bg-background/30 flex flex-col gap-1">
                        <span className="text-xs font-medium text-muted-foreground">{t("integrations.selfHostedServer")}</span>
                        {testResult.vps ? (
                          <div>
                            <div className="flex items-center gap-1.5 mt-1">
                              <span className={`w-2 h-2 rounded-full ${testResult.vps.online ? "bg-emerald-500" : "bg-red-500"}`} />
                              <span className="text-sm font-semibold text-foreground">
                                {testResult.vps.online ? t("i18nAudit.ui.online.6df144ed") : t("i18nAudit.ui.offline.90ec47a6")}
                              </span>
                            </div>
                            <span className="text-xs text-muted-foreground mt-1 block">
                              {testResult.vps.statusText}
                            </span>
                          </div>
                        ) : (
                          <span className="text-sm text-foreground">-</span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* VPS details if online */}
                  {testResult.vps?.online && (
                    <div className="p-4 border border-border rounded-xl bg-background/20 space-y-2.5">
                      <div className="flex justify-between text-xs border-b border-border/50 pb-1.5">
                        <span className="text-muted-foreground">{t("integrations.cachedTranscripts")}</span>
                        <span className="font-semibold text-foreground">{testResult.vps.cacheSize ?? 0}</span>
                      </div>
                      <div className="flex justify-between text-xs border-b border-border/50 pb-1.5">
                        <span className="text-muted-foreground">{t("integrations.activeWorkers")}</span>
                        <span className="font-semibold text-foreground">{testResult.vps.workersAvailable ?? 0}</span>
                      </div>
                      {testResult.vps.workers && Object.keys(testResult.vps.workers).length > 0 && (
                        <div className="space-y-1 mt-2">
                          <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground block">{t("i18nAudit.ui.registered-workers.1a3e19aa")}</span>
                          {Object.entries(testResult.vps.workers).map(([wid, lastPoll]) => (
                            <div key={wid} className="flex justify-between text-xs font-mono bg-background/40 p-1.5 rounded border border-border/30">
                              <span className="text-foreground">{wid}</span>
                              <span className="text-muted-foreground text-[10px]">{new Date(lastPoll).toLocaleTimeString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Last resolution diagnostic */}
                  {testResult.lastDiagnostic && (
                    <div className="p-4 border border-border/80 rounded-xl bg-background/10 space-y-2.5">
                      <span className="text-xs font-semibold text-foreground block">{t("i18nAudit.ui.last-transcript-request-deta.fc4de1d5")}</span>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-muted-foreground uppercase font-semibold">{t("i18nAudit.ui.video-id.c333539d")}</span>
                          <span className="font-mono text-foreground">{testResult.lastDiagnostic.videoId}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-muted-foreground uppercase font-semibold">{t("i18nAudit.ui.status.18751bab")}</span>
                          <span className={`font-semibold ${testResult.lastDiagnostic.status === "success" ? "text-emerald-500" : "text-red-500"}`}>
                            {testResult.lastDiagnostic.status === "success" ? t("i18nAudit.ui.success.7fd90e7e") : t("i18nAudit.ui.failed.502b0607")}
                          </span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-muted-foreground uppercase font-semibold">{t("i18nAudit.ui.source-route.0cf80672")}</span>
                          <span className="font-medium text-foreground bg-secondary/40 px-1.5 py-0.5 rounded w-max">{testResult.lastDiagnostic.source}</span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] text-muted-foreground uppercase font-semibold">{t("i18nAudit.ui.duration.11caf82d")}</span>
                          <span className="text-foreground">{testResult.lastDiagnostic.durationMs}ms</span>
                        </div>
                      </div>
                      {testResult.lastDiagnostic.error && (
                        <div className="text-xs p-2 bg-red-500/10 border border-red-500/20 rounded text-red-400 font-mono mt-1 break-all">
                          {testResult.lastDiagnostic.error}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Public API Tokens & Webhooks Settings (Plethora Cloud) */}
      {activeTab === "api-tokens" && isPlethoraCloudAvailable() && (
        <SettingsSearchTarget id="integrations.publicApi" label={t("i18nAudit.ui.pro-public-api-webhooks.bbad437b")}>
          <ApiTokensIntegrationPanel />
        </SettingsSearchTarget>
      )}
    </div>
  );
}

function ApiTokensIntegrationPanel() {
  const { t } = useI18n();
  const { tokens, webhooks, createToken, revokeToken, registerWebhook, deleteWebhook } = useApiTokensStore();
  const [tokenName, setTokenName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["read:library", "write:inbox"]);
  const [newlyCreatedSecret, setNewlyCreatedSecret] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEvents, setWebhookEvents] = useState<string[]>(["document.created", "item.reviewed"]);
  const [newWebhookSecret, setNewWebhookSecret] = useState<string | null>(null);
  const toast = useToast();

  const handleCreateToken = async () => {
    if (!tokenName.trim()) {
      toast.warning(t("i18nAudit.ui.please-enter-a-token-name.623a9f27"));
      return;
    }
    try {
      const token = await createToken(tokenName.trim(), selectedScopes);
      setNewlyCreatedSecret(token.secretToken || null);
      setTokenName("");
      toast.success(t("i18nAudit.ui.api-bearer-token-created-suc.5fa1c5c2"));
    } catch (err) {
      toast.error(t("i18nAudit.ui.token-creation-failed.c74790c5"), err instanceof Error ? err.message : String(err));
    }
  };

  const handleRegisterWebhook = async () => {
    if (!webhookUrl.trim() || !webhookUrl.startsWith("http")) {
      toast.warning(t("i18nAudit.ui.please-enter-a-valid-http-ht.f7b9f7a6"));
      return;
    }
    try {
      const wh = await registerWebhook(webhookUrl.trim(), webhookEvents);
      setNewWebhookSecret(wh.secret);
      setWebhookUrl("");
      toast.success(t("i18nAudit.ui.webhook-registered-with-hmac.68b449d4"));
    } catch (err) {
      toast.error(t("i18nAudit.ui.webhook-registration-failed.e958343b"), err instanceof Error ? err.message : String(err));
    }
  };

  const availableScopes = [
    { id: "read:library", label: t("i18nAudit.ui.read-library-documents.0c28a2ef") },
    { id: "write:inbox", label: t("i18nAudit.ui.write-to-remote-inbox.227e5454") },
    { id: "read:notes", label: t("i18nAudit.ui.read-annotations-notes.6c00bac2") },
    { id: "write:cards", label: t("i18nAudit.ui.create-update-flashcards.ef10b79c") },
    { id: "admin:webhooks", label: t("i18nAudit.ui.manage-webhook-subscriptions.4ad16366") },
  ];

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <div className="p-6 bg-card border rounded-lg space-y-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Key className="w-5 h-5 text-primary" />
          </div>
          <div>
            <SettingsSearchTarget id="integrations.publicApi" label={t("i18nAudit.ui.pro-public-api-webhooks.bbad437b")}>
<h3 className="text-lg font-semibold text-foreground">{t("i18nAudit.ui.pro-public-api-webhooks.bbad437b")}</h3>
              </SettingsSearchTarget>
            <p className="text-sm text-muted-foreground">{t("i18nAudit.ui.automate-document-ingest-cap.8aa9a43b")}</p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground pt-2">
          {t("i18nAudit.ui.use-scoped-bearer-tokens-to-.a1b7a739")}</p>
      </div>

      {/* Token Generator */}
      <div className="p-6 bg-card border rounded-lg space-y-4">
        <h4 className="text-base font-semibold text-foreground">{t("i18nAudit.ui.generate-scoped-api-token.b1976131")}</h4>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("i18nAudit.ui.token-name-client-descriptio.74a90e3c")}</label>
            <input
              type="text"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
              placeholder={t("i18nAudit.ui.e-g-raycast-extension-obsidi.b5da80c3")}
              className="w-full px-3 py-2 bg-background border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-2">{t("i18nAudit.ui.granted-scopes.a48572fa")}</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {availableScopes.map((scope) => (
                <label key={scope.id} className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedScopes.includes(scope.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedScopes([...selectedScopes, scope.id]);
                      } else {
                        setSelectedScopes(selectedScopes.filter((s) => s !== scope.id));
                      }
                    }}
                    className="rounded border-border"
                  />
                  <span>{scope.label}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={handleCreateToken}
            className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-sm font-medium transition-colors"
          >
            {t("i18nAudit.ui.generate-token.e7a2819e")}</button>
        </div>

        {newlyCreatedSecret && (
          <div className="p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-lg space-y-2">
            <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              {t("i18nAudit.ui.secret-token-copy-now-this-w.6087418d")}</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={newlyCreatedSecret}
                className="flex-1 font-mono text-xs px-3 py-2 bg-background border rounded-lg text-foreground select-all"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(newlyCreatedSecret);
                  toast.success(t("i18nAudit.ui.secret-token-copied-to-clipb.d1155252"));
                }}
                className="px-3 py-2 bg-secondary text-secondary-foreground hover:opacity-90 rounded-lg text-xs font-medium"
              >
                {t("i18nAudit.ui.copy.6ffc193a")}</button>
            </div>
          </div>
        )}
      </div>

      {/* Active Tokens Table */}
      <div className="p-6 bg-card border rounded-lg space-y-4">
        <h4 className="text-base font-semibold text-foreground">{t("i18nAudit.ui.active-tokens.a85f364a")}{tokens.filter((t) => !t.revokedAt).length})</h4>
        {tokens.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("i18nAudit.ui.no-api-tokens-created-yet.e7512102")}</p>
        ) : (
          <div className="divide-y border rounded-lg overflow-hidden">
            {tokens.map((token) => (
              <div key={token.id} className="p-4 flex items-center justify-between gap-4">
                <div>
                  <p className={`text-sm font-medium ${token.revokedAt ? "line-through text-muted-foreground" : "text-foreground"}`}>
                    {token.name}
                  </p>
                  <p className="text-xs font-mono text-muted-foreground mt-0.5">
                    {token.prefix}{t("i18nAudit.ui.created.0b7903f8") + " "}{new Date(token.createdAt).toLocaleDateString()}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {token.scopes.map((s) => (
                      <span key={s} className="px-1.5 py-0.5 bg-muted text-muted-foreground rounded text-[10px] font-mono">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                {!token.revokedAt && (
                  <button
                    onClick={() => {
                      void revokeToken(token.id)
                        .then(() => toast.info(t("i18nAudit.ui.token-revoked.b6bca964")))
                        .catch((err: unknown) => toast.error(t("i18nAudit.ui.revoke-failed.f29bc491"), err instanceof Error ? err.message : String(err)));
                    }}
                    className="px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                  >
                    {t("i18nAudit.ui.revoke.0bb59119")}</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Webhook Registration */}
      <div className="p-6 bg-card border rounded-lg space-y-4">
        <h4 className="text-base font-semibold text-foreground">{t("i18nAudit.ui.webhook-subscriptions.d32c7313")}</h4>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t("i18nAudit.ui.webhook-endpoint-url.583d4a82")}</label>
            <input
              type="text"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://your-server.com/api/plethora-webhook"
              className="w-full px-3 py-2 bg-background border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <button
            onClick={handleRegisterWebhook}
            className="px-4 py-2 bg-secondary text-secondary-foreground hover:opacity-90 rounded-lg text-sm font-medium transition-colors"
          >
            {t("i18nAudit.ui.register-webhook.02df83fb")}</button>
        </div>

        {newWebhookSecret && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg space-y-2">
            <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
              {t("i18nAudit.ui.webhook-hmac-secret-for-sign.876fffed")}</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={newWebhookSecret}
                className="flex-1 font-mono text-xs px-3 py-2 bg-background border rounded-lg text-foreground select-all"
              />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(newWebhookSecret);
                  toast.success(t("i18nAudit.ui.hmac-secret-copied.7bd052ad"));
                }}
                className="px-3 py-2 bg-secondary text-secondary-foreground hover:opacity-90 rounded-lg text-xs font-medium"
              >
                {t("i18nAudit.ui.copy.6ffc193a")}</button>
            </div>
          </div>
        )}

        {webhooks.length > 0 && (
          <div className="divide-y border rounded-lg overflow-hidden mt-4">
            {webhooks.map((wh) => (
              <div key={wh.id} className="p-4 flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-mono text-foreground break-all">{wh.url}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("i18nAudit.ui.events.29d9485e") + " "}{wh.events.join(", ")} {t("i18nAudit.ui.added.14a880ff") + " "}{new Date(wh.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  onClick={() => {
                    void deleteWebhook(wh.id)
                      .then(() => toast.info(t("i18nAudit.ui.webhook-removed.6033276b")))
                      .catch((err: unknown) => toast.error(t("i18nAudit.ui.delete-failed.6acb82fa"), err instanceof Error ? err.message : String(err)));
                  }}
                  className="px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                >
                  {t("i18nAudit.ui.delete.0501158d")}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

