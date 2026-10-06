import { useState, useEffect, useCallback } from "react";
import { ArrowClockwise, Brain, CheckCircle, Database, Lightning, Warning } from "@phosphor-icons/react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "../../lib/i18n";
import { NumericInput } from "../common";
import { isPaidEmbeddingProvider } from "../../utils/aiBillingConsent";
import { embeddingProviderLabel } from "../../utils/embeddingEstimation";
import { listOllamaModels } from "../../api/ai";
import { isNativeMobile } from "../../lib/tauri";

const DEFAULT_OLLAMA_EMBED_MODELS = [
  "embeddinggemma-2",
  "embeddinggemma-2:740m",
  "nomic-embed-text",
  "mxbai-embed-large",
  "all-minilm",
];

/**
 * Embedding provider settings: choose a cloud or local embedding provider and
 * configure chunk size / top-k. The provider configured here feeds the
 * semantic index (`ai_learning_*` commands); the index status, per-document
 * states, and pause/resume/reset controls live in `AiIndexPanel`, mounted
 * directly below this section on the same settings tab.
 */
export function EmbeddingSettings() {
  const { t } = useI18n();
  const { settings, updateSettingsCategory } = useSettingsStore(
    useShallow((s) => ({
      settings: s.settings.embedding,
      updateSettingsCategory: s.updateSettingsCategory,
    }))
  );

  const [installedOllamaModels, setInstalledOllamaModels] = useState<string[]>([]);
  const [isLoadingOllama, setIsLoadingOllama] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<"idle" | "checking" | "connected" | "error">("idle");
  const [ollamaError, setOllamaError] = useState<string | null>(null);

  const update = (patch: Partial<typeof settings>) => updateSettingsCategory("embedding", patch);

  const refreshOllama = useCallback(async () => {
    if (settings.provider !== "ollama") return;
    setIsLoadingOllama(true);
    setOllamaStatus("checking");
    setOllamaError(null);
    try {
      const models = await listOllamaModels(settings.ollamaBaseUrl);
      if (Array.isArray(models) && models.length > 0) {
        setInstalledOllamaModels(models);
        setOllamaStatus("connected");
      } else {
        setOllamaStatus("connected");
      }
    } catch (error) {
      console.warn("Failed to list installed Ollama models:", error);
      setOllamaStatus("error");
      const msg = error instanceof Error ? error.message : String(error);
      setOllamaError(msg);
    } finally {
      setIsLoadingOllama(false);
    }
  }, [settings.provider, settings.ollamaBaseUrl]);

  useEffect(() => {
    if (settings.provider === "ollama") {
      void refreshOllama();
    }
  }, [settings.provider, settings.ollamaBaseUrl, refreshOllama]);

  const ollamaModels = Array.from(
    new Set([
      ...(settings.ollamaModel ? [settings.ollamaModel] : []),
      ...installedOllamaModels,
      ...DEFAULT_OLLAMA_EMBED_MODELS,
    ])
  );

  const providerOptions = [
    { value: "openai", label: t("embeddings.providerOpenai"), modelKey: "openaiModel" as const, models: ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"] },
    { value: "cohere", label: t("embeddings.providerCohere"), modelKey: "cohereModel" as const, models: ["embed-english-v3.0", "embed-multilingual-v3.0"] },
    { value: "openrouter", label: t("embeddings.providerOpenrouter"), modelKey: "openrouterModel" as const, models: ["openai/text-embedding-3-small"] },
    { value: "ollama", label: t("embeddings.providerOllama"), modelKey: "ollamaModel" as const, models: ollamaModels },
  ];
  const activeProvider = providerOptions.find((p) => p.value === settings.provider)!;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Brain className="w-5 h-5 text-primary" />
          {t("embeddings.title")}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">{t("embeddings.desc")}</p>
      </div>

      {/* Provider selection */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Database className="w-4 h-4" /> {t("embeddings.provider")}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {providerOptions.map((p) => (
            <button
              key={p.value}
              onClick={() => update({ provider: p.value as typeof settings.provider })}
              className={`px-3 py-2 rounded-md text-sm border transition-colors text-left ${
                settings.provider === p.value
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border hover:bg-muted text-foreground"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Model picker for the active provider */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("embeddings.model")}</span>
            {settings.provider === "ollama" && (
              <button
                type="button"
                onClick={() => void refreshOllama()}
                disabled={isLoadingOllama}
                className="flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
              >
                <ArrowClockwise className={`w-3.5 h-3.5 ${isLoadingOllama ? "animate-spin" : ""}`} />
                <span>{isLoadingOllama ? "Checking installed..." : "Refresh installed models"}</span>
              </button>
            )}
          </div>
          <select
            value={settings[activeProvider.modelKey] ?? activeProvider.models[0]}
            onChange={(e) => update({ [activeProvider.modelKey]: e.target.value } as Partial<typeof settings>)}
            className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm"
          >
            {activeProvider.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>

        {settings.provider === "ollama" && (
          <div className="space-y-2">
            <label className="block text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">{t("embeddings.ollamaBaseUrl")}</span>
                <button
                  type="button"
                  onClick={() => void refreshOllama()}
                  disabled={isLoadingOllama}
                  className="text-xs text-primary hover:underline disabled:opacity-50 inline-flex items-center gap-1"
                >
                  <ArrowClockwise className={`w-3 h-3 ${isLoadingOllama ? "animate-spin" : ""}`} />
                  <span>{isLoadingOllama ? "Testing..." : "Test Connection"}</span>
                </button>
              </div>
              <input
                type="text"
                value={settings.ollamaBaseUrl}
                onChange={(e) => {
                  setOllamaStatus("idle");
                  update({ ollamaBaseUrl: e.target.value });
                }}
                placeholder="http://localhost:11434"
                className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono"
              />
            </label>

            {ollamaStatus === "connected" && (
              <p className="text-xs text-success flex items-center gap-1.5 font-medium">
                <CheckCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>Connected to Ollama ({installedOllamaModels.length} models installed)</span>
              </p>
            )}

            {ollamaStatus === "error" && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive space-y-1.5">
                <div className="flex items-start gap-1.5 font-semibold">
                  <Warning className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>Cannot reach Ollama at {settings.ollamaBaseUrl}</span>
                </div>
                {ollamaError && (
                  <p className="font-mono text-[11px] opacity-90 break-all">{ollamaError}</p>
                )}
                <div className="text-muted-foreground pt-1 space-y-1 text-[11px] border-t border-destructive/20">
                  <p>
                    <strong>Running Ollama over Tailscale / LAN?</strong> By default, Ollama only binds to <code className="text-foreground">127.0.0.1</code> and rejects remote connections.
                  </p>
                  <p>
                    On your host machine, configure Ollama to accept remote network traffic:
                  </p>
                  <code className="block p-1 bg-background/50 rounded font-mono text-[10px] text-foreground">
                    OLLAMA_HOST=0.0.0.0 OLLAMA_ORIGINS=&quot;*&quot; ollama serve
                  </code>
                  {isNativeMobile() && (settings.ollamaBaseUrl.includes("localhost") || settings.ollamaBaseUrl.includes("127.0.0.1")) && (
                    <p className="text-amber-600 dark:text-amber-400 font-medium">
                      Note: On mobile, &ldquo;localhost&rdquo; refers to your phone itself. Use your computer&apos;s Tailscale IP (e.g. http://100.x.y.z:11434).
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {settings.provider !== "ollama" && (
          <p className="text-xs text-muted-foreground">{t("embeddings.apiKeyNote")}</p>
        )}

        {/* Paid/cloud indicator + explicit consent (ai-billing-safety #14) */}
        {isPaidEmbeddingProvider(settings.provider) && (
          <div className="space-y-3 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
              <Warning className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                {t("embeddings.paidIndicatorDesc", {
                  provider: embeddingProviderLabel(settings.provider),
                })}
              </span>
            </p>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={settings.paidEmbeddingsEnabled === true}
                onChange={(e) => update({ paidEmbeddingsEnabled: e.target.checked })}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-foreground block">
                  {t("paid.embeddingsEnabledLabel")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t("paid.embeddingsEnabledDesc")}
                </span>
              </span>
            </label>
            {settings.paidEmbeddingsEnabled !== true && (
              <p className="text-xs text-muted-foreground">
                {t("paid.embeddingsDisabledHint", {
                  provider: embeddingProviderLabel(settings.provider),
                })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Retrieval tuning */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Lightning className="w-4 h-4" /> {t("embeddings.retrievalTuning")}
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm">
            <span className="text-muted-foreground">{t("embeddings.chunkSize")}</span>
            <NumericInput
              min={50}
              max={2000}
              value={settings.chunkSize}
              onChange={(value) => update({ chunkSize: value })}
              className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">{t("embeddings.chunkOverlap")}</span>
            <NumericInput
              min={0}
              max={500}
              value={settings.chunkOverlap}
              onChange={(value) => update({ chunkOverlap: value })}
              className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">{t("embeddings.topK")}</span>
            <NumericInput
              min={1}
              max={50}
              value={settings.topK}
              onChange={(value) => update({ topK: value })}
              className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm"
            />
          </label>
          <label className="block text-sm">
            <span className="text-muted-foreground">{t("embeddings.minSimilarity")}</span>
            <NumericInput
              step={0.05}
              min={0}
              max={1}
              value={settings.minSimilarity}
              onChange={(value) => update({ minSimilarity: value })}
              className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm"
            />
          </label>
        </div>
      </div>
    </div>
  );
}
