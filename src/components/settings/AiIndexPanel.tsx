/**
 * Library semantic-index panel (OpenSpec `add-ondevice-ai-learning-system`,
 * task 4.8 / ai-semantic-index spec "Index status visibility").
 *
 * Shows the aggregate + per-document index state reported by
 * `ai_learning_index_status`, the active embedding provider/model(s) and
 * storage consumed, and offers the lifecycle controls: bulk backfill
 * (`ai_learning_enqueue_all`, with the charging constraint toggle from design
 * D14), pause/resume, per-document cancel, and reset (`ai_learning_reset_index`
 * — the index is a rebuildable cache; user content is untouched).
 *
 * The initial "Enable indexing" CTA turns the `aiSemanticIndex` feature flag
 * on and starts the bulk backfill. Retrieval mode (semantic vs lexical-only)
 * is surfaced with a one-shot probe retrieve on mount and on manual refresh —
 * the mode is query-dependent, so this is an indicator, not a status field.
 *
 * Progress updates: there is no push event for index progress yet; the panel
 * POLLS `ai_learning_index_status` while it is mounted (2.5 s while work is
 * queued/running, otherwise 15 s). Kept deliberately simple — swap the
 * interval for a `tauri::ipc::Channel` event if/when the backend emits one.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowClockwise,
  Database,
  Pause,
  Play,
  Sparkle,
  Warning,
  Waveform,
} from "@phosphor-icons/react";
import { useShallow } from "zustand/react/shallow";
import { useI18n } from "../../lib/i18n";
import { useSettingsStore } from "../../stores/settingsStore";
import { useDocumentStore } from "../../stores/documentStore";
import { useModal } from "../common/Modal";
import {
  cancelAIDocumentIndexing,
  enqueueAllAIDocuments,
  getAIIndexStatus,
  pauseAIIndexing,
  resetAIIndex,
  resumeAIIndexing,
  retrieveFromLibrary,
  type DocumentIndexStatus,
  type IndexStatusResponse,
} from "../../api/ai-learning";
import { resolveEmbeddingConfigForRag } from "../assistant/ragConfig";
import {
  isPaidEmbeddingProvider,
  paidEmbeddingsEnabled,
  requestPaidConsent,
} from "../../utils/aiBillingConsent";
import {
  embeddingProviderLabel,
  estimateEmbeddingWorkload,
  formatEmbeddingCostClause,
} from "../../utils/embeddingEstimation";

/** Poll cadence while the indexer has work (queued/indexing/pending). */
const ACTIVE_POLL_MS = 2_500;
/** Poll cadence while idle. */
const IDLE_POLL_MS = 15_000;

type RetrievalModeIndicator = "semantic" | "lexicalOnly" | "unknown";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** True when the error payload is the backend's consent rejection. */
function isPaidConsentError(error: unknown): boolean {
  const type =
    typeof error === "object" && error !== null && "type" in error
      ? (error as { type?: unknown }).type
      : undefined;
  return type === "paid_operation_not_consented";
}

const STATE_BADGE_CLASS: Record<string, string> = {
  indexed: "bg-success/15 text-success",
  queued: "bg-primary/15 text-primary",
  indexing: "bg-primary/15 text-primary",
  stale: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  failed: "bg-destructive/15 text-destructive",
  unindexed: "bg-muted text-muted-foreground",
};

export function AiIndexPanel() {
  const { t } = useI18n();
  const { confirm: confirmModal } = useModal();
  const { enabled, updateSettingsCategory, embeddingProvider, embeddingModel, embeddingSettings, systemSpotlightEnabled, updateSettings } =
    useSettingsStore(
      useShallow((s) => ({
        enabled: s.settings.features.aiSemanticIndex,
        updateSettingsCategory: s.updateSettingsCategory,
        embeddingProvider: s.settings.embedding.provider,
        embeddingModel:
          s.settings.embedding.ollamaModel ||
          s.settings.embedding.openaiModel ||
          s.settings.embedding.cohereModel ||
          s.settings.embedding.openrouterModel ||
          "",
        embeddingSettings: s.settings.embedding,
        systemSpotlightEnabled: s.settings.search?.systemSpotlightEnabled === true,
        updateSettings: s.updateSettings,
      }))
    );
  const documents = useDocumentStore((s) => s.documents);

  // Workload basis for the paid pre-flight estimate: total extractable chars
  // across the library (the chunker splits on this; an empty estimate is
  // expressed as "cannot be precisely estimated" rather than guessed).
  const libraryCharCount = useMemo(
    () => documents.reduce((acc, doc) => acc + (doc.content?.length ?? 0), 0),
    [documents]
  );

  const [status, setStatus] = useState<IndexStatusResponse | null>(null);
  const [mode, setMode] = useState<RetrievalModeIndicator>("unknown");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showDocuments, setShowDocuments] = useState(false);
  const [requireCharging, setRequireCharging] = useState(true);
  // Last refresh generation: async responses from a superseded refresh are
  // dropped so the panel never flickers back to stale data.
  const refreshRef = useRef(0);

  const refresh = useCallback(async () => {
    const run = ++refreshRef.current;
    try {
      const next = await getAIIndexStatus();
      if (run !== refreshRef.current) return;
      setStatus(next);
      setError(null);
    } catch (e) {
      if (run !== refreshRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (run === refreshRef.current) setLoading(false);
    }
  }, []);

  /**
   * Retrieval-mode probe: one k=1 retrieve tells whether the active embedding
   * backend can serve semantic queries right now (`semantic`) or the FTS5
   * fallback is in charge (`lexicalOnly`). The mode is query-dependent, so
   * this is an indicator rather than authoritative status.
   */
  const probeMode = useCallback(async () => {
    try {
      const config = await resolveEmbeddingConfigForRag().catch(() => undefined);
      const probe = await retrieveFromLibrary("index status probe", { k: 1, config });
      setMode(probe.mode);
    } catch {
      setMode("unknown");
    }
  }, []);

  // Initial load + polling while mounted (see the module comment — no push
  // event exists yet, so the interval IS the progress subscription). Behind
  // the flag-off CTA there is nothing to poll.
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    void probeMode();
  }, [refresh, probeMode, enabled]);

  const isActive = useMemo(() => {
    const a = status?.aggregate;
    if (!a) return false;
    return (
      a.paused === false &&
      (a.queuedDocuments > 0 || a.indexingDocuments > 0 || a.pendingDocuments > 0)
    );
  }, [status]);

  useEffect(() => {
    if (!enabled) return;
    const interval = setInterval(() => void refresh(), isActive ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(interval);
  }, [refresh, isActive, enabled]);

  const runAction = useCallback(
    async (key: string, action: () => Promise<unknown>) => {
      setBusy(key);
      setError(null);
      try {
        await action();
        await refresh();
      } catch (e) {
        // Defensive backend gate (paid_operation_not_consented): surface the
        // opt-in so the user can enable paid embeddings and retry instead of
        // just showing a raw error.
        if (isPaidConsentError(e)) {
          const granted = await requestPaidConsent({
            kind: "embeddings",
            provider: embeddingSettings.provider,
            model: embeddingModel,
            label: embeddingProviderLabel(embeddingSettings.provider),
          });
          if (!granted) {
            setError(t("aiLibrary.indexConsentError"));
          }
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [refresh, t, embeddingSettings, embeddingModel]
  );

  /**
   * Paid pre-flight gate for bulk indexing (ai-billing-safety #14):
   *  - local/free providers (Ollama) proceed without consent or confirmation;
   *  - paid cloud providers require the `paidEmbeddingsEnabled` flag (opt-in
   *    surface when off) AND a confirmation showing the workload estimate
   *    (chunks × model) and a cost estimate when pricing is known.
   * Returns false when the user declines at any step (nothing is enqueued).
   */
  const requestIndexConsent = useCallback(async (): Promise<boolean> => {
    const provider = embeddingSettings.provider;
    if (!isPaidEmbeddingProvider(provider)) return true;

    if (!paidEmbeddingsEnabled()) {
      const granted = await requestPaidConsent({
        kind: "embeddings",
        provider,
        model: embeddingModel,
        label: embeddingProviderLabel(provider),
      });
      if (!granted) {
        setError(
          t("aiLibrary.indexConsentRequiredMessage", {
            provider: embeddingProviderLabel(provider),
          })
        );
        return false;
      }
    }

    const estimate = estimateEmbeddingWorkload({
      characterCount: libraryCharCount,
      provider,
      model: embeddingModel,
      chunkSize: embeddingSettings.chunkSize,
    });
    const docCount = documents.length;
    const estimateClause = estimate.costUnknown
      ? t("aiLibrary.indexCostUnknown")
      : ` — ${formatEmbeddingCostClause(estimate)}`;
    return confirmModal(
      t("aiLibrary.indexConfirmMessage", {
        docs: docCount,
        chunks: estimate.estimatedChunks,
        provider: embeddingProviderLabel(provider),
        model: embeddingModel || "default",
        estimate: estimateClause,
      }),
      t("aiLibrary.indexConfirmTitle")
    );
  }, [embeddingSettings, embeddingModel, libraryCharCount, documents, t, confirmModal]);

  /** Enable-flag CTA: turn the feature on and start the bulk backfill. */
  const enableIndexing = useCallback(() => {
    void (async () => {
      if (!(await requestIndexConsent())) return;
      updateSettingsCategory("features", { aiSemanticIndex: true });
      await runAction("enable", () => enqueueAllAIDocuments(requireCharging));
    })();
  }, [requestIndexConsent, updateSettingsCategory, runAction, requireCharging]);

  /** Reindex stale documents — same paid gate as the initial enable. */
  const reindexStale = useCallback(() => {
    void (async () => {
      if (!(await requestIndexConsent())) return;
      await runAction("reindex", () => enqueueAllAIDocuments(requireCharging));
    })();
  }, [requestIndexConsent, runAction, requireCharging]);

  /**
   * Reset needs an explicit in-app confirmation (`useModal` — native
   * `confirm()` is silently suppressed by the desktop WebView).
   */
  const resetWithConfirm = useCallback(() => {
    void confirmModal(t("aiLibrary.indexResetConfirm"), t("aiLibrary.indexTitle")).then((ok) => {
      if (ok) void runAction("reset", resetAIIndex);
    });
  }, [confirmModal, runAction, t]);

  const aggregate = status?.aggregate;
  const failedDocuments = useMemo(
    () => (status?.documents ?? []).filter((d) => d.state === "failed"),
    [status]
  );

  // ── Flag-off CTA ─────────────────────────────────────────────────────────
  if (!enabled) {
    return (
      <div className="max-w-2xl">
        <div className="bg-card border border-border rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Sparkle className="w-4 h-4" /> {t("aiLibrary.indexTitle")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("aiLibrary.indexEnableDesc")}</p>
          {isPaidEmbeddingProvider(embeddingProvider) && (
            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-1.5">
              <Warning className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              {t("aiLibrary.indexPaidIndicatorDesc")}
            </p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={requireCharging}
              onChange={(e) => setRequireCharging(e.target.checked)}
            />
            {t("aiLibrary.indexRequireCharging")}
          </label>
          <button
            onClick={enableIndexing}
            disabled={busy === "enable"}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 disabled:opacity-60"
          >
            {busy === "enable" ? t("aiLibrary.indexStarting") : t("aiLibrary.indexEnable")}
          </button>
          {error && (
            <p className="text-xs text-destructive flex items-start gap-1.5">
              <Warning className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Status dashboard ─────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl space-y-4">
      <div className="bg-card border border-border rounded-lg p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <Database className="w-4 h-4" /> {t("aiLibrary.indexTitle")}
          </h3>
          <div className="flex items-center gap-2">
            {aggregate?.paused ? (
              <button
                onClick={() => void runAction("resume", resumeAIIndexing)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
              >
                <Play className="w-3.5 h-3.5" /> {t("aiLibrary.indexResume")}
              </button>
            ) : (
              <button
                onClick={() => void runAction("pause", pauseAIIndexing)}
                disabled={busy !== null}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
              >
                <Pause className="w-3.5 h-3.5" /> {t("aiLibrary.indexPause")}
              </button>
            )}
            <button
              onClick={resetWithConfirm}
              disabled={busy !== null}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-60"
            >
              {t("aiLibrary.indexReset")}
            </button>
            <button
              onClick={() => {
                void refresh();
                void probeMode();
              }}
              disabled={busy !== null}
              aria-label={t("aiLibrary.indexRefresh")}
              className="rounded-md border border-border px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
            >
              <ArrowClockwise className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted-foreground">{t("aiLibrary.indexLoading")}</p>
        ) : aggregate ? (
          <>
            <div className="grid grid-cols-4 gap-3 text-center">
              <Stat
                label={t("aiLibrary.indexStatIndexed")}
                value={aggregate.indexedDocuments}
                sub={`/ ${aggregate.totalDocuments}`}
              />
              <Stat
                label={t("aiLibrary.indexStatPending")}
                value={
                  aggregate.queuedDocuments + aggregate.indexingDocuments + aggregate.pendingDocuments
                }
                sub={aggregate.paused ? t("aiLibrary.indexPaused") : undefined}
              />
              <Stat label={t("aiLibrary.indexStatFailed")} value={aggregate.failedDocuments} />
              <Stat label={t("aiLibrary.indexStatChunks")} value={aggregate.totalChunks} />
            </div>

            {aggregate.indexingDocuments > 0 && aggregate.activeDocument && (
              <p className="text-xs text-muted-foreground truncate">
                {t("aiLibrary.indexActiveDocument", {
                  title:
                    documents.find((d) => d.id === aggregate.activeDocument)?.title ??
                    aggregate.activeDocument,
                })}
              </p>
            )}

            <div className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-center justify-between gap-2">
                <span>{t("aiLibrary.indexStorage")}</span>
                <span className="font-medium text-foreground">
                  {formatBytes(aggregate.embeddingStorageBytes)}
                  {aggregate.totalEmbeddings > 0 && ` · ${aggregate.totalEmbeddings} vectors`}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span>{t("aiLibrary.indexProvider")}</span>
                <span className="font-medium text-foreground inline-flex items-center gap-1.5">
                  {embeddingProvider}
                  {embeddingModel ? ` · ${embeddingModel}` : ""}
                  {isPaidEmbeddingProvider(embeddingProvider) && (
                    <span
                      title={t("aiLibrary.indexPaidIndicatorDesc")}
                      className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400"
                    >
                      <Warning className="w-3 h-3" />
                      {t("aiLibrary.indexPaidIndicator")}
                    </span>
                  )}
                </span>
              </div>
              {aggregate.embeddingModels.map((m) => (
                <div key={`${m.model}-${m.embeddingVersion}`} className="flex items-center justify-between gap-2">
                  <span>{t("aiLibrary.indexStoredModel")}</span>
                  <span className="font-medium text-foreground">
                    {m.model} · v{m.embeddingVersion} · {m.chunks}
                  </span>
                </div>
              ))}
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span>{t("aiLibrary.systemSpotlight")}</span>
                <input
                  type="checkbox"
                  checked={systemSpotlightEnabled}
                  onChange={(e) =>
                    updateSettings({
                      search: { systemSpotlightEnabled: e.target.checked },
                    })
                  }
                />
              </label>
              <div className="flex items-center justify-between gap-2">
                <span>{t("aiLibrary.indexMode")}</span>
                <span
                  className={`inline-flex items-center gap-1 font-medium ${
                    mode === "semantic" ? "text-success" : "text-amber-600 dark:text-amber-400"
                  }`}
                >
                  <Waveform className="w-3.5 h-3.5" />
                  {mode === "semantic"
                    ? t("aiLibrary.indexModeSemantic")
                    : mode === "lexicalOnly"
                      ? t("aiLibrary.indexModeLexical")
                      : t("aiLibrary.indexModeUnknown")}
                </span>
              </div>
            </div>

            {aggregate.staleDocuments > 0 && (
              <button
                onClick={reindexStale}
                disabled={busy !== null}
                className="px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-xs font-medium hover:opacity-90 disabled:opacity-60"
              >
                {busy === "reindex" ? t("aiLibrary.indexStarting") : t("aiLibrary.indexReindex")}
              </button>
            )}

            {failedDocuments.length > 0 && (
              <p className="text-xs text-destructive flex items-start gap-1.5">
                <Warning className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                {t("aiLibrary.indexFailedHint", { count: failedDocuments.length })}
              </p>
            )}
            {error && (
              <p className="text-xs text-destructive flex items-start gap-1.5">
                <Warning className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                {error}
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("aiLibrary.indexNoStatus")}</p>
        )}
      </div>

      {/* Per-document list (lazy, collapsed by default) */}
      <div className="bg-card border border-border rounded-lg p-5 space-y-3">
        <button
          onClick={() => setShowDocuments((v) => !v)}
          className="text-sm font-semibold flex items-center gap-2 hover:text-primary"
        >
          <Database className="w-4 h-4" />
          {showDocuments ? t("aiLibrary.indexHideDocuments") : t("aiLibrary.indexShowDocuments")}
        </button>
        {showDocuments && (
          <ul className="space-y-1 max-h-80 overflow-y-auto">
            {(status?.documents ?? []).map((doc) => (
              <DocumentRow
                key={doc.documentId}
                doc={doc}
                title={documents.find((d) => d.id === doc.documentId)?.title}
                onCancel={
                  doc.state === "queued" || doc.state === "indexing"
                    ? () =>
                        void runAction(`cancel-${doc.documentId}`, () =>
                          cancelAIDocumentIndexing(doc.documentId)
                        )
                    : undefined
                }
                cancelLabel={t("aiLibrary.indexCancelDocument")}
                busy={busy === `cancel-${doc.documentId}`}
              />
            ))}
            {(status?.documents ?? []).length === 0 && (
              <li className="text-xs text-muted-foreground">{t("aiLibrary.indexNoDocuments")}</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="bg-background/50 rounded p-2">
      <div className="text-xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function DocumentRow({
  doc,
  title,
  onCancel,
  cancelLabel,
  busy,
}: {
  doc: DocumentIndexStatus;
  title?: string;
  onCancel?: () => void;
  cancelLabel: string;
  busy: boolean;
}) {
  const { t } = useI18n();
  const label = title ?? doc.documentId;
  return (
    <li className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted/50">
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{label}</span>
        <span className="block text-muted-foreground">
          {doc.chunksIndexed}/{doc.totalChunks || "?"} ·{" "}
          {t(`aiLibrary.indexState_${doc.state}`)}
        </span>
        {doc.error && (
          <span className="block text-destructive truncate" title={doc.error}>
            {t("aiLibrary.indexError", { message: doc.error })}
          </span>
        )}
      </span>
      <span className="flex items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            STATE_BADGE_CLASS[doc.state] ?? STATE_BADGE_CLASS.unindexed
          }`}
        >
          {t(`aiLibrary.indexState_${doc.state}`)}
        </span>
        {onCancel && (
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-border px-2 py-0.5 hover:bg-muted disabled:opacity-50"
          >
            {cancelLabel}
          </button>
        )}
      </span>
    </li>
  );
}
