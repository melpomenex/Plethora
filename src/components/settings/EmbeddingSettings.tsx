import { Brain, Database, Lightning, Warning } from "@phosphor-icons/react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "../../lib/i18n";
import { NumericInput } from "../common";
import { isPaidEmbeddingProvider } from "../../utils/aiBillingConsent";
import { embeddingProviderLabel } from "../../utils/embeddingEstimation";

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

  const update = (patch: Partial<typeof settings>) => updateSettingsCategory("embedding", patch);

  const providerOptions = [
    { value: "openai", label: t("embeddings.providerOpenai"), modelKey: "openaiModel" as const, models: ["text-embedding-3-small", "text-embedding-3-large", "text-embedding-ada-002"] },
    { value: "cohere", label: t("embeddings.providerCohere"), modelKey: "cohereModel" as const, models: ["embed-english-v3.0", "embed-multilingual-v3.0"] },
    { value: "openrouter", label: t("embeddings.providerOpenrouter"), modelKey: "openrouterModel" as const, models: ["openai/text-embedding-3-small"] },
    { value: "ollama", label: t("embeddings.providerOllama"), modelKey: "ollamaModel" as const, models: ["nomic-embed-text", "mxbai-embed-large", "all-minilm"] },
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
        <label className="block text-sm">
          <span className="text-muted-foreground">{t("embeddings.model")}</span>
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
        </label>

        {settings.provider === "ollama" && (
          <label className="block text-sm">
            <span className="text-muted-foreground">{t("embeddings.ollamaBaseUrl")}</span>
            <input
              type="text"
              value={settings.ollamaBaseUrl}
              onChange={(e) => update({ ollamaBaseUrl: e.target.value })}
              placeholder="http://localhost:11434"
              className="mt-1 w-full px-3 py-2 bg-background border border-border rounded text-sm font-mono"
            />
          </label>
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
