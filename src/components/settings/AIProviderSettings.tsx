/**
 * AI Provider Settings Component
 * LLM Provider configuration and MCP Servers configuration
 */

import { SettingsSection, SettingsRow } from "./SettingsPage";
import { LLMProviderSettings } from "./LLMProviderSettings";
import { OnDeviceAiPanel } from "./OnDeviceAiPanel";
import { MCPServersSettings } from "./MCPServersSettings";
import {
  syncPrimaryProviderToNativeAI,
  useLLMProvidersStore,
} from "../../stores/llmProvidersStore";
import { useMCPServersStore } from "../../stores/mcpServersStore";
import { useSettingsStore, type ActiveRecallMode } from "../../stores/settingsStore";
import { invokeCommand as invoke } from "../../lib/tauri";
import { NumericInput } from "../common";
import { AIDiagnosticsModal } from "./AIDiagnosticsModal";
import { useState, useEffect } from "react";
import { useI18n } from "../../lib/i18n";
import { getAIConfig, setApiKey, isMaskedKey } from "../../api/ai";

/**
 * AI Provider Settings
 */
export function AISettings({ onChange }: { onChange: () => void }) {
  const { t } = useI18n();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const providers = useLLMProvidersStore((state) => state.providers);
  const addProvider = useLLMProvidersStore((state) => state.addProvider);
  const updateProvider = useLLMProvidersStore((state) => state.updateProvider);
  const removeProvider = useLLMProvidersStore((state) => state.removeProvider);

  // Keep the native/browser-extension AI service aligned with the provider
  // registry even when the registry was hydrated before its store bridge ran.
  useEffect(() => {
    void syncPrimaryProviderToNativeAI(providers);
  }, [providers]);

  const mcpServers = useMCPServersStore((state) => state.servers);
  const addMCPServer = useMCPServersStore((state) => state.addServer);
  const removeMCPServer = useMCPServersStore((state) => state.removeServer);
  const updateMCPServer = useMCPServersStore((state) => state.updateServer);

  // Context window tokens setting
  const { settings, updateSettings } = useSettingsStore();
  const [contextWindowTokens, setContextWindowTokens] = useState(settings.ai.maxTokens);

  useEffect(() => {
    setContextWindowTokens(settings.ai.maxTokens);
  }, [settings.ai.maxTokens]);

  const handleSaveContextWindow = (value: number) => {
    setContextWindowTokens(value);
    updateSettings({ ai: { ...settings.ai, maxTokens: value } });
    onChange();
  };

  // AI Memory States
  const [memoryEnabled, setMemoryEnabled] = useState(settings.ai.memoryEnabled || false);
  const [memoryContent, setMemoryContent] = useState("");
  const [isEditingMemory, setIsEditingMemory] = useState(false);
  const [editedMemory, setEditedMemory] = useState("");
  const [isSavingMemory, setIsSavingMemory] = useState(false);

  // Brave Search API key state. The key itself is stored in the OS keychain
  // (via `setApiKey("brave", ...)`); here we only track whether one is stored
  // (`hasBraveKey`) plus the transient input buffer (`braveKey`) used when the
  // user types a new key to save/test. We never display the stored secret.
  const [braveKey, setBraveKey] = useState("");
  const [hasBraveKey, setHasBraveKey] = useState(false);
  const [isTestingBrave, setIsTestingBrave] = useState(false);
  const [braveTestResult, setBraveTestResult] = useState<string | null>(null);

  // Sync memoryEnabled state when settings change
  useEffect(() => {
    setMemoryEnabled(settings.ai.memoryEnabled || false);
  }, [settings.ai.memoryEnabled]);

  useEffect(() => {
    async function loadMemory() {
      try {
        const content = await invoke<string>("get_memory_content");
        setMemoryContent(content);
        setEditedMemory(content);
      } catch (err) {
        console.error("Failed to load AI memories in settings:", err);
      }
    }
    loadMemory();
  }, []);

  // Load whether a Brave Search API key is already stored in the keychain.
  // `getAIConfig()` returns masked keys ("••••••••") for anything present, so
  // we only need the truthiness of `api_keys.brave` to show the "stored"
  // indicator — we never display the secret itself.
  useEffect(() => {
    async function loadBraveStatus() {
      try {
        const cfg = await getAIConfig();
        const braveVal = cfg?.api_keys?.brave || "";
        setHasBraveKey(!!braveVal);
      } catch (err) {
        console.error("Failed to load Brave Search key status:", err);
      }
    }
    loadBraveStatus();
  }, []);

  // Save the typed Brave key to the keychain (replacing any existing one),
  // then clear the input so the secret is never left in component state.
  const handleSaveBraveKey = async () => {
    if (!braveKey) return;
    try {
      await setApiKey("brave", braveKey);
      setHasBraveKey(true);
      setBraveKey("");
      setBraveTestResult(null);
    } catch (err) {
      console.error("Failed to save Brave Search API key:", err);
      setBraveTestResult(t("aiSettings.connectionFailed", { provider: "Brave Search" }));
    }
  };

  // Persist the typed key (if any) then run a live search to verify it works.
  const handleTestBrave = async () => {
    try {
      setIsTestingBrave(true);
      setBraveTestResult(null);
      if (braveKey) {
        await setApiKey("brave", braveKey);
        setHasBraveKey(true);
        setBraveKey("");
      }
      await invoke("brave_web_search", { query: "incrementum" });
      setBraveTestResult("Brave Search: Connection successful");
    } catch (err) {
      // Surface the backend's real error (HTTP status / parse failure / etc.)
      // instead of a generic "Connection failed", so miskeys/network issues
      // are diagnosable.
      const detail = err instanceof Error ? err.message : String(err);
      setBraveTestResult(`${t("aiSettings.connectionFailed", { provider: "Brave Search" })} — ${detail}`);
      console.error("Brave Search test failed:", err);
    } finally {
      setIsTestingBrave(false);
    }
  };

  const handleToggleMemory = (enabled: boolean) => {
    setMemoryEnabled(enabled);
    updateSettings({
      ai: {
        ...settings.ai,
        memoryEnabled: enabled,
      },
    });
    onChange();
  };

  const handleSaveMemoryEdits = async () => {
    try {
      setIsSavingMemory(true);
      await invoke("save_memory_content", { content: editedMemory });
      setMemoryContent(editedMemory);
      setIsEditingMemory(false);
    } catch (err) {
      console.error("Failed to save memory edits:", err);
      alert("Failed to save memory edits.");
    } finally {
      setIsSavingMemory(false);
    }
  };

  const handleTestConnection = async (config: { id: string; provider: string; apiKey: string; baseUrl?: string; model: string }) => {
    try {
      const result = await invoke<boolean>("llm_test_connection", {
        provider: config.provider,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      });
      return result;
    } catch (error) {
      console.error("Failed to test connection:", error);
      return false;
    }
  };

  const handleTestMCPServer = async (_server: { id: string; name: string; endpoint: string; transport: "stdio" | "sse" }) => {
    // TODO: Implement actual MCP server connection test
    // For now, just return true
    return true;
  };

  const handleAddProvider = (provider: Omit<{ id: string; provider: "openai" | "anthropic" | "gemini" | "deepseek" | "ollama" | "openrouter"; name: string; apiKey: string; baseUrl?: string; model: string; enabled: boolean; temperature: number; maxTokens: number; systemPrompt?: string }, "id">) => {
    addProvider(provider);
    onChange();
  };

  const handleUpdateProvider = (id: string, updates: Partial<{ id: string; provider: "openai" | "anthropic" | "gemini" | "deepseek" | "ollama" | "openrouter"; name: string; apiKey: string; baseUrl?: string; model: string; enabled: boolean; temperature: number; maxTokens: number; systemPrompt?: string }>) => {
    updateProvider(id, updates);
    onChange();
  };

  const handleRemoveProvider = (id: string) => {
    removeProvider(id);
    onChange();
  };

  const handleAddMCPServer = (server: Omit<{ id: string; name: string; endpoint: string; transport: "stdio" | "sse"; enabled?: boolean }, "id">) => {
    addMCPServer(server);
    onChange();
  };

  const handleRemoveMCPServer = (id: string) => {
    removeMCPServer(id);
    onChange();
  };

  const handleUpdateMCPServer = (id: string, updates: Partial<{ id: string; name: string; endpoint: string; transport: "stdio" | "sse"; enabled?: boolean }>) => {
    updateMCPServer(id, updates);
    onChange();
  };

  return (
    <>
      <LLMProviderSettings
        providers={providers}
        onAddProvider={handleAddProvider}
        onUpdateProvider={handleUpdateProvider}
        onRemoveProvider={handleRemoveProvider}
        onTestConnection={handleTestConnection}
      />

      {/* On-device AI (Android only). Renders nothing where no bridge exists. */}
      <OnDeviceAiPanel onChange={onChange} />

      {/* AI Learning System Features (OpenSpec add-ondevice-ai-learning-system) */}
      <SettingsSection
        title="AI Learning System Features"
        description="On-device learning tools: card generation, Socratic tutoring, Ask Library RAG, active recall, occlusion assist, and learning agent."
      >
        <SettingsRow
          label="Enable All AI Learning Features"
          description="Quickly enable all on-device learning capabilities for this device"
        >
          <div className="flex gap-2">
            <button
              onClick={() => {
                updateSettings({
                  features: {
                    ...settings.features,
                    aiLearnThis: true,
                    aiLibraryRag: true,
                    aiSocraticTutor: true,
                    aiOcclusionAssist: true,
                    aiSemanticIndex: true,
                    aiActiveRecall: true,
                    aiAnswerAssessment: true,
                    aiPrerequisites: true,
                    aiConceptLinks: true,
                    aiExtractWorthiness: true,
                    aiAgent: true,
                  },
                });
                onChange();
              }}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:opacity-90 transition-opacity"
            >
              Enable All
            </button>
            <button
              onClick={() => setShowDiagnostics(true)}
              className="px-3 py-1.5 bg-muted text-foreground border border-border rounded-lg text-xs font-medium hover:bg-muted/80 transition-colors"
            >
              {t("aiDiagnostics.button")}
            </button>
          </div>
        </SettingsRow>

        <SettingsRow
          label="Learn this (Card Extraction)"
          description="Propose structured flashcards, cloze deletions, and definitions from selected reading text"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.features.aiLearnThis}
              onChange={(e) => {
                updateSettings({
                  features: { ...settings.features, aiLearnThis: e.target.checked },
                });
                onChange();
              }}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </SettingsRow>

        <SettingsRow
          label="Ask Library (Semantic Memory RAG)"
          description="Search conceptually across your entire library and receive grounded answers with citations"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.features.aiLibraryRag}
              onChange={(e) => {
                updateSettings({
                  features: { ...settings.features, aiLibraryRag: e.target.checked },
                });
                onChange();
              }}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </SettingsRow>

        <SettingsRow
          label="Socratic Tutoring"
          description="Interactive, turn-based guiding dialogues with hint escalation and escape hatches"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.features.aiSocraticTutor}
              onChange={(e) => {
                updateSettings({
                  features: { ...settings.features, aiSocraticTutor: e.target.checked },
                });
                onChange();
              }}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </SettingsRow>

        <SettingsRow
          label="AI Image Occlusion Assist"
          description="Auto-detect text labels on diagrams using on-device OCR and generate occlusion cards"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.features.aiOcclusionAssist}
              onChange={(e) => {
                updateSettings({
                  features: { ...settings.features, aiOcclusionAssist: e.target.checked },
                });
                onChange();
              }}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </SettingsRow>

        <SettingsRow
          label="On-Device Semantic Indexing"
          description="Index documents with local LiteRT EmbeddingGemma embeddings for fast vector retrieval"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.features.aiSemanticIndex}
              onChange={(e) => {
                updateSettings({
                  features: { ...settings.features, aiSemanticIndex: e.target.checked },
                });
                onChange();
              }}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </SettingsRow>

        <SettingsRow
          label="AI Answer Assessment (Review Free-Response)"
          description="Evaluate typed answers against ground truth and highlight missed nuances without overriding rating authority"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.features.aiAnswerAssessment}
              onChange={(e) => {
                updateSettings({
                  features: { ...settings.features, aiAnswerAssessment: e.target.checked },
                });
                onChange();
              }}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </SettingsRow>

        <SettingsRow
          label="Knowledge Relationships & Prerequisites"
          description="Identify concept dependencies, coverage levels, and cross-document concept links"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.features.aiPrerequisites}
              onChange={(e) => {
                updateSettings({
                  features: {
                    ...settings.features,
                    aiPrerequisites: e.target.checked,
                    aiConceptLinks: e.target.checked,
                  },
                });
                onChange();
              }}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </SettingsRow>

        <SettingsRow
          label="Passage Extract-Worthiness Scoring"
          description="Subtle margin indicators on high-value paragraphs in reading view"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.features.aiExtractWorthiness}
              onChange={(e) => {
                updateSettings({
                  features: { ...settings.features, aiExtractWorthiness: e.target.checked },
                });
                onChange();
              }}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </SettingsRow>

        <SettingsRow
          label="Constrained Learning Agent"
          description="Autonomous assistant capable of searching library context and staging proposed cards for review"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.features.aiAgent}
              onChange={(e) => {
                updateSettings({
                  features: { ...settings.features, aiAgent: e.target.checked },
                });
                onChange();
              }}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </SettingsRow>
      </SettingsSection>

      <AIDiagnosticsModal
        isOpen={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
      />

      {/* Brave Search API Key — powers web search in Document Q&A.
          The backend reads this via the keychain (`brave_web_search`); the key
          itself is never shown back, only a "stored" indicator. */}
      <SettingsSection
        title={t("aiSettings.braveApiKey")}
        description={t("aiProvider.braveKeyDesc")}
      >
        <SettingsRow
          label={t("aiSettings.braveApiKey")}
          description={hasBraveKey ? t("aiProvider.braveKeyStored") : t("aiProvider.braveKeyNotStored")}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="password"
              value={braveKey}
              onChange={(e) => setBraveKey(e.target.value)}
              placeholder={hasBraveKey ? "Enter new key to replace…" : "bs-..."}
              className="flex-1 px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSaveBraveKey}
                disabled={!braveKey}
                className="px-3 py-2 bg-muted text-foreground rounded-lg hover:bg-muted/80 disabled:opacity-50 text-sm font-medium"
              >
                {t("common.save")}
              </button>
              <button
                onClick={handleTestBrave}
                disabled={isTestingBrave || (!braveKey && !hasBraveKey)}
                className="px-3 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 text-sm font-medium"
              >
                {isTestingBrave ? "…" : t("common.test")}
              </button>
            </div>
          </div>
        </SettingsRow>

        {braveTestResult && (
          <div
            className={`mt-3 p-3 rounded-lg flex items-center gap-2 text-sm ${
              braveTestResult.includes("successful")
                ? "bg-green-500/10 text-green-500 border border-green-500/20"
                : "bg-destructive/10 text-destructive border border-destructive/20"
            }`}
          >
            <span>{braveTestResult}</span>
          </div>
        )}
      </SettingsSection>

      {/* AI Model Settings */}
      <SettingsSection
        title={t("aiSettings.modelSettings")}
        description={t("aiProvider.modelSettingsDesc")}
      >
        <SettingsRow
          label={t("aiSettings.contextWindow")}
          description={t("aiProvider.contextWindowDesc")}
        >
          <NumericInput
            min={1000}
            max={32000}
            step={500}
            value={contextWindowTokens}
            onChange={handleSaveContextWindow}
            className="w-24 px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          />
        </SettingsRow>
      </SettingsSection>

      {/* MCP Servers Configuration */}
      <MCPServersSettings
        servers={mcpServers}
        onAddServer={handleAddMCPServer}
        onRemoveServer={handleRemoveMCPServer}
        onUpdateServer={handleUpdateMCPServer}
        onTestServer={handleTestMCPServer}
        maxServers={3}
      />

      {/* Auto-Generation Settings */}
      <SettingsSection
        title="Auto-Generation"
        description="Automatically generate flashcards from new extracts"
      >
        <SettingsRow
          label="Auto-generate flashcards"
          description="Generate flashcards automatically when new extracts are created"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.ai.aiControls.autoGenerate}
              onChange={(e) => {
                updateSettings({
                  ai: {
                    ...settings.ai,
                    aiControls: { ...settings.ai.aiControls, autoGenerate: e.target.checked },
                  },
                });
                onChange();
              }}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </SettingsRow>

        <SettingsRow
          label="Flashcard generation target"
          description={
            settings.ai.aiControls.flashcardCountMode === "auto"
              ? "Scales the number of cards with the size of the content being generated from, staying within the range below. Applies to both auto-generation and the Flashcard Studio."
              : "Always generate exactly this many cards per request. Applies to both auto-generation and the Flashcard Studio."
          }
        >
          <div className="flex flex-col items-end gap-2">
            <div className="inline-flex rounded-lg border border-border overflow-hidden">
              {(["fixed", "auto"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    updateSettings({
                      ai: {
                        ...settings.ai,
                        aiControls: { ...settings.ai.aiControls, flashcardCountMode: mode },
                      },
                    });
                    onChange();
                  }}
                  className={`px-3 py-1.5 text-sm capitalize transition-colors ${
                    settings.ai.aiControls.flashcardCountMode === mode
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-foreground hover:bg-muted"
                  }`}
                >
                  {mode === "fixed" ? "Fixed" : "Auto"}
                </button>
              ))}
            </div>

            {settings.ai.aiControls.flashcardCountMode === "fixed" ? (
              <NumericInput
                min={1}
                max={100}
                value={settings.ai.aiControls.flashcardFixedCount}
                onChange={(value) => {
                  updateSettings({
                    ai: {
                      ...settings.ai,
                      aiControls: { ...settings.ai.aiControls, flashcardFixedCount: value },
                    },
                  });
                  onChange();
                }}
                className="w-24 px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
              />
            ) : (
              <div className="flex items-center gap-2">
                <NumericInput
                  min={1}
                  max={settings.ai.aiControls.flashcardAutoMax}
                  value={settings.ai.aiControls.flashcardAutoMin}
                  onChange={(value) => {
                    const flashcardAutoMax = Math.max(value, settings.ai.aiControls.flashcardAutoMax);
                    updateSettings({
                      ai: {
                        ...settings.ai,
                        aiControls: { ...settings.ai.aiControls, flashcardAutoMin: value, flashcardAutoMax },
                      },
                    });
                    onChange();
                  }}
                  className="w-20 px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <NumericInput
                  min={settings.ai.aiControls.flashcardAutoMin}
                  max={100}
                  value={settings.ai.aiControls.flashcardAutoMax}
                  onChange={(value) => {
                    const flashcardAutoMin = Math.min(value, settings.ai.aiControls.flashcardAutoMin);
                    updateSettings({
                      ai: {
                        ...settings.ai,
                        aiControls: { ...settings.ai.aiControls, flashcardAutoMax: value, flashcardAutoMin },
                      },
                    });
                    onChange();
                  }}
                  className="w-20 px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
                />
                <span className="text-sm text-muted-foreground">cards</span>
              </div>
            )}
          </div>
        </SettingsRow>

        <SettingsRow
          label="Quality threshold"
          description="Minimum confidence score (0.0-1.0) to keep generated flashcards"
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={settings.ai.aiControls.qualityThreshold}
              onChange={(e) => {
                updateSettings({
                  ai: {
                    ...settings.ai,
                    aiControls: { ...settings.ai.aiControls, qualityThreshold: parseFloat(e.target.value) },
                  },
                });
                onChange();
              }}
              disabled={!settings.ai.aiControls.autoGenerate}
              className="w-32"
            />
            <span className="text-sm text-muted-foreground w-10">
              {settings.ai.aiControls.qualityThreshold.toFixed(2)}
            </span>
          </div>
        </SettingsRow>

        <SettingsRow
          label="Require manual approval"
          description="Hold generated cards for review before saving"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.ai.aiControls.requireApproval}
              onChange={(e) => {
                updateSettings({
                  ai: {
                    ...settings.ai,
                    aiControls: { ...settings.ai.aiControls, requireApproval: e.target.checked },
                  },
                });
                onChange();
              }}
              disabled={!settings.ai.aiControls.autoGenerate}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary disabled:opacity-50"></div>
          </label>
        </SettingsRow>
      </SettingsSection>

      {/* Summarization Settings */}
      <SettingsSection
        title="Summarization"
        description="Automatically summarize long extracts"
      >
        <SettingsRow
          label="Auto-summarize long extracts"
          description="Generate summaries for extracts exceeding length threshold"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.ai.aiControls.autoSummarize}
              onChange={(e) => {
                updateSettings({
                  ai: {
                    ...settings.ai,
                    aiControls: { ...settings.ai.aiControls, autoSummarize: e.target.checked },
                  },
                });
                onChange();
              }}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </SettingsRow>

        <SettingsRow
          label="Summary length"
          description="Target length for auto-generated summaries"
        >
          <select
            value={settings.ai.aiControls.summaryLength}
            onChange={(e) => {
              updateSettings({
                ai: {
                  ...settings.ai,
                  aiControls: { ...settings.ai.aiControls, summaryLength: e.target.value as "short" | "medium" | "long" },
                },
              });
              onChange();
            }}
            disabled={!settings.ai.aiControls.autoSummarize}
            className="w-full sm:w-auto px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm disabled:opacity-50"
          >
            <option value="short">Short (~100 words)</option>
            <option value="medium">Medium (~250 words)</option>
            <option value="long">Long (~500 words)</option>
          </select>
        </SettingsRow>

        <SettingsRow
          label="Include summary in card content"
          description="Prepend summary to flashcard generation prompt as context"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.ai.aiControls.includeSummaryInCards}
              onChange={(e) => {
                updateSettings({
                  ai: {
                    ...settings.ai,
                    aiControls: { ...settings.ai.aiControls, includeSummaryInCards: e.target.checked },
                  },
                });
                onChange();
              }}
              disabled={!settings.ai.aiControls.autoSummarize}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary disabled:opacity-50"></div>
          </label>
        </SettingsRow>
      </SettingsSection>

      {/* Context Window Settings */}
      <SettingsSection
        title="Context Window"
        description="Configure how much context is sent in AI requests"
      >
        <SettingsRow
          label="Max tokens per request"
          description="Global fallback for max tokens (256-128000); overridden by per-provider value"
        >
          <NumericInput
            min={256}
            max={128000}
            value={settings.ai.aiControls.maxTokensPerRequest}
            onChange={(value) => {
              updateSettings({
                ai: {
                  ...settings.ai,
                  aiControls: { ...settings.ai.aiControls, maxTokensPerRequest: value },
                },
              });
              onChange();
            }}
            className="w-28 px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          />
        </SettingsRow>

        <SettingsRow
          label="Context from related cards"
          description="Include semantically related card content as context"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.ai.aiControls.contextFromRelatedCards}
              onChange={(e) => {
                updateSettings({
                  ai: {
                    ...settings.ai,
                    aiControls: { ...settings.ai.aiControls, contextFromRelatedCards: e.target.checked },
                  },
                });
                onChange();
              }}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </SettingsRow>

        <SettingsRow
          label="Document snippet length"
          description="Characters per context snippet from source documents (200-10000)"
        >
          <NumericInput
            min={200}
            max={10000}
            value={settings.ai.aiControls.documentSnippetLength}
            onChange={(value) => {
              updateSettings({
                ai: {
                  ...settings.ai,
                  aiControls: { ...settings.ai.aiControls, documentSnippetLength: value },
                },
              });
              onChange();
            }}
            className="w-28 px-3 py-2 bg-background border border-border rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary text-sm"
          />
        </SettingsRow>
      </SettingsSection>

      {/* Active Recall (AI Learning System Phase 4, design D19) */}
      <SettingsSection
        title="Active Recall"
        description="While reading, occasionally ask you to recall recently read material from memory. Off by default."
      >
        <SettingsRow
          label="Active recall mode"
          description="Off disables it entirely; Low / Adaptive / Intensive set how often prompts may interrupt reading"
        >
          <select
            data-testid="active-recall-mode"
            className="w-40 px-3 py-2 bg-background border border-border rounded-lg text-foreground text-sm"
            value={settings.ai.activeRecallMode}
            onChange={(e) => {
              updateSettings({
                ai: { ...settings.ai, activeRecallMode: e.target.value as ActiveRecallMode },
              });
              onChange();
            }}
          >
            <option value="off">Off</option>
            <option value="low">Low</option>
            <option value="adaptive">Adaptive</option>
            <option value="intensive">Intensive</option>
          </select>
        </SettingsRow>
      </SettingsSection>

      {/* AI Memory Settings */}
      <SettingsSection
        title="AI Long-Term Memory"
        description="Enable persistent, local memory context to make the AI personalized and personable"
      >
        <SettingsRow
          label="Enable AI Memory"
          description="Load facts and preferences into chat sessions to personalize AI interactions"
        >
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={memoryEnabled}
              onChange={(e) => handleToggleMemory(e.target.checked)}
            />
            <div className="w-11 h-6 bg-muted peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-primary"></div>
          </label>
        </SettingsRow>

        {memoryEnabled && (
          <div className="mt-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-600 dark:text-amber-400 text-xs leading-relaxed">
            <strong>⚠️ Token Usage Warning:</strong> Enabling AI memory will load your persistent markdown memories into all chat prompts. While this dramatically improves context and personalization, it will consume more context tokens per message.
          </div>
        )}

        {memoryEnabled && (
          <div className="mt-4 border border-border rounded-lg overflow-hidden bg-background">
            <div className="flex justify-between items-center px-4 py-2 border-b border-border bg-muted/30">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                MEMORY.md (Durable Markdown Context)
              </span>
              <div className="flex gap-2">
                {isEditingMemory ? (
                  <>
                    <button
                      onClick={() => {
                        setEditedMemory(memoryContent);
                        setIsEditingMemory(false);
                      }}
                      className="px-2.5 py-1 text-xs bg-muted text-foreground rounded hover:bg-muted/80 transition-colors font-medium"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveMemoryEdits}
                      disabled={isSavingMemory}
                      className="px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 transition-opacity flex items-center gap-1 font-medium"
                    >
                      {isSavingMemory ? "Saving..." : "Save Edits"}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setEditedMemory(memoryContent);
                      setIsEditingMemory(true);
                    }}
                    className="px-2.5 py-1 text-xs bg-primary/10 text-primary hover:bg-primary/20 rounded transition-colors font-medium"
                  >
                    Edit Memories
                  </button>
                )}
              </div>
            </div>
            <div className="p-4">
              {isEditingMemory ? (
                <textarea
                  value={editedMemory}
                  onChange={(e) => setEditedMemory(e.target.value)}
                  rows={8}
                  className="w-full p-3 bg-muted/10 border border-border rounded-lg text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent resize-y"
                  placeholder="# AI Memory..."
                />
              ) : (
                <pre className="text-xs text-foreground font-mono whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto">
                  {memoryContent || "(No memory content loaded)"}
                </pre>
              )}
            </div>
          </div>
        )}
      </SettingsSection>
    </>
  );
}
