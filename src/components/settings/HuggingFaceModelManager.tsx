/**
 * HuggingFaceModelManager — install compatible Hugging Face speech models with
 * hardware-suitability analysis (requirement #19).
 *
 * Provides the repo input, inspection results (metadata + files), per-candidate
 * suitability badges + explanations, license, install progress / cancel / retry /
 * remove, and the installed-model list. `mode` filters which runtimes are
 * offered: "stt" shows whisper.cpp + sherpa-onnx STT; "tts" shows sherpa TTS.
 *
 * Security: unsupported repos are blocked outright; Not Recommended installs
 * require an explicit "install anyway" override. Nothing here executes repo
 * code — see the Rust security model.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowCounterClockwise,
  CheckCircle,
  CircleNotch,
  Download,
  FileX,
  Info,
  MagnifyingGlass,
  ShieldCheck,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useHfModelStore } from "../../stores/useHfModelStore";
import {
  RUNTIME_LABELS,
  formatBytes,
  type HfArtifact,
  type HfRuntime,
  type InstalledHfModel,
  type SuitabilityLevel,
} from "../../api/hfModels";
import { cn } from "../../utils";
import { useToast } from "../common/Toast";
import { isTauri } from "../../lib/tauri";

export type HfManagerMode = "stt" | "tts";

const SUITABILITY_META: Record<SuitabilityLevel, { label: string; className: string }> = {
  recommended: { label: "Recommended", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30" },
  "should-run": { label: "Should Run", className: "bg-teal-500/10 text-teal-600 border-teal-500/30" },
  "may-run-slowly": { label: "May Run Slowly", className: "bg-amber-500/10 text-amber-600 border-amber-500/30" },
  "not-recommended": { label: "Not Recommended", className: "bg-orange-500/10 text-orange-600 border-orange-500/30" },
  "unsupported-runtime": { label: "Unsupported Runtime", className: "bg-red-500/10 text-red-600 border-red-500/30" },
};

function runtimeForMode(mode: HfManagerMode): HfRuntime[] {
  return mode === "stt"
    ? ["whisper-cpp", "sherpa-onnx-stt", "nemotron-asr"]
    : ["sherpa-onnx-tts"];
}

function InstalledModelRow({
  model,
  onRemove,
}: {
  model: InstalledHfModel;
  onRemove: (id: string) => Promise<void>;
}) {
  const progress = useHfModelStore((s) => s.progress[model.id]);
  const [removing, setRemoving] = useState(false);
  const isActive = progress && progress.percent < 100;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{model.repo_id}</span>
          {model.installed ? (
            <CheckCircle className="h-4 w-4 shrink-0 text-green-500" />
          ) : (
            <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-[10px] font-medium text-red-600">
              Files missing
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {RUNTIME_LABELS[model.runtime]} · rev {model.revision} · {formatBytes(model.download_size_bytes)}
        </p>
      </div>

      {isActive ? (
        <div className="flex items-center gap-2">
          <div className="w-24">
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary" style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="mt-0.5 text-right text-[10px] text-muted-foreground">
              {Math.round(progress.percent)}%
            </p>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={removing}
          onClick={() => {
            setRemoving(true);
            void onRemove(model.id).finally(() => setRemoving(false));
          }}
          className="shrink-0 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
          title="Remove model"
        >
          {removing ? <CircleNotch className="h-3.5 w-3.5 animate-spin" /> : <Trash className="h-3.5 w-3.5" />}
          Remove
        </button>
      )}
    </div>
  );
}

export function HuggingFaceModelManager({ mode }: { mode: HfManagerMode }) {
  const toast = useToast();
  const [repoInput, setRepoInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [expandedFiles, setExpandedFiles] = useState(false);
  const [overrideNotRecommended, setOverrideNotRecommended] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installingKey, setInstallingKey] = useState<string | null>(null);

  const {
    installedModels,
    inspection,
    fetchInstalled,
    inspect,
    install,
    cancelInstall,
    uninstall,
    clearInspection,
    setInstallState,
  } = useHfModelStore();

  const allowedRuntimes = useMemo(() => runtimeForMode(mode), [mode]);

  // Load installed models on mount + when the page becomes visible.
  useEffect(() => {
    void fetchInstalled().catch(() => undefined);
    const onVis = () => {
      if (document.visibilityState === "visible") void fetchInstalled().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [fetchInstalled]);

  const modeInstalled = useMemo(
    () => (installedModels ?? []).filter((m) => allowedRuntimes.includes(m.runtime)),
    [installedModels, allowedRuntimes],
  );

  const handleInspect = useCallback(async () => {
    const input = repoInput.trim();
    if (!input) return;
    setBusy(true);
    setError(null);
    try {
      await inspect(input);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      setInstallState("error", message);
    } finally {
      setBusy(false);
    }
  }, [repoInput, inspect, setInstallState]);

  const handleInstall = useCallback(
    async (artifact: HfArtifact) => {
      const input = inspection?.repo_id
        ? `${inspection.repo_id}${inspection.revision && inspection.revision !== "main" ? `#${inspection.revision}` : ""}`
        : repoInput.trim();
      const key = `${artifact.runtime}:${artifact.kind}`;
      setInstallingKey(key);
      try {
        await install(input, artifact.runtime, artifact.kind);
        toast.success("Model installed", `${input} installed successfully.`);
        setOverrideNotRecommended(false);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (!/cancelled|cancel/i.test(message)) {
          toast.error("Install failed", message);
        }
      } finally {
        setInstallingKey(null);
      }
    },
    [inspection, repoInput, install, toast],
  );

  const handleCancel = useCallback(
    async (id: string) => {
      await cancelInstall(id);
      toast.info("Download cancelled", "The partial download was cleaned up.");
      setInstallState("idle");
    },
    [cancelInstall, setInstallState, toast],
  );

  const handleRemove = useCallback(
    async (id: string) => {
      try {
        await uninstall(id);
        toast.success("Model removed", "The model and its files were removed.");
      } catch (e) {
        toast.error("Remove failed", e instanceof Error ? e.message : String(e));
      }
    },
    [uninstall, toast],
  );

  const candidates = inspection?.candidates ?? [];
  const candidateEntries = inspection?.suitability ?? [];
  const progressMap = useHfModelStore((s) => s.progress);

  return (
    <div className="space-y-4">
      {/* Security note */}
      <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p>
          Only models that match a Plethora-supported runtime (whisper.cpp ggml, sherpa-onnx
          ONNX, or Nemotron ASR GGUF) can be installed. Downloaded files are verified and never
          executed as code. Repositories that don't match a supported artifact are blocked.
        </p>
      </div>

      {/* Input + inspect */}
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <MagnifyingGlass className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleInspect();
              }}
              placeholder="https://huggingface.co/owner/model or owner/model#revision"
              className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm text-foreground"
              disabled={busy}
            />
          </div>
          <button
            type="button"
            onClick={() => void handleInspect()}
            disabled={busy || !repoInput.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {busy ? <CircleNotch className="h-4 w-4 animate-spin" /> : <MagnifyingGlass className="h-4 w-4" />}
            Inspect
          </button>
        </div>
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <WarningCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {/* Inspection results */}
      {inspection && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">
                {inspection.name}
                <span className="ml-2 text-xs font-normal text-muted-foreground">{inspection.repo_id}</span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[
                  inspection.task ?? "no pipeline tag",
                  inspection.params_millions ? `~${inspection.params_millions}M params (estimate)` : null,
                  inspection.precision ? `precision: ${inspection.precision} (estimate)` : null,
                  `~${formatBytes(inspection.download_size_bytes)} repo size (estimate)`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <button
              type="button"
              onClick={clearInspection}
              className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted"
              title="Clear"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {inspection.author && (
            <p className="text-xs text-muted-foreground">Author: {inspection.author}</p>
          )}

          {/* License */}
          {inspection.license && (
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p>
                <span className="font-medium text-foreground">License: {inspection.license}</span>
                {" — downloading a model does not grant you rights to use it. Check the model's "
                + "license and terms before use."}
              </p>
            </div>
          )}

          {/* Candidates */}
          {candidates.length === 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              No artifact in this repository is runnable by any installed Plethora speech runtime.
              Installation is blocked. Only repos exposing a ggml whisper model, a sherpa-onnx
              ONNX model (with tokens), or a Nemotron ASR GGUF model can be installed.
            </div>
          ) : (
            <div className="space-y-2">
              {candidateEntries
                .filter((entry) => allowedRuntimes.includes(entry.artifact.runtime))
                .map((entry) => {
                  const artifact = entry.artifact;
                  const suitability = entry.suitability;
                  const meta = SUITABILITY_META[suitability.level];
                  const key = `${artifact.runtime}:${artifact.kind}`;
                  const isInstalling = installingKey === key;
                  const isBlocked = suitability.level === "unsupported-runtime";
                  const isNotRecommended = suitability.level === "not-recommended";
                  const canInstall = !isBlocked && (!isNotRecommended || overrideNotRecommended);

                  return (
                    <div key={key} className="rounded-lg border border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {artifact.label}
                            {artifact.confidence === "heuristic" && (
                              <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600">
                                inferred (estimate)
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {RUNTIME_LABELS[artifact.runtime]} · {formatBytes(artifact.download_size_bytes)} ·{" "}
                            {artifact.files.length} file(s)
                          </p>
                        </div>
                        <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", meta.className)}>
                          {meta.label}
                        </span>
                      </div>

                      <p className="mt-2 text-xs text-muted-foreground">{suitability.explanation}</p>

                      {isNotRecommended && !isBlocked && (
                        <label className="mt-2 flex items-center gap-2 text-xs text-foreground">
                          <input
                            type="checkbox"
                            checked={overrideNotRecommended}
                            onChange={(e) => setOverrideNotRecommended(e.target.checked)}
                            className="accent-primary"
                          />
                          I understand this model is not recommended for this machine and want to install it anyway.
                        </label>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={!canInstall || isInstalling}
                          onClick={() => void handleInstall(artifact)}
                          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isInstalling ? (
                            <CircleNotch className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                          {isInstalling ? "Installing…" : "Install"}
                        </button>
                        {isBlocked && (
                          <span className="text-xs text-muted-foreground">Unsupported runtime — blocked</span>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}

          {/* File listing */}
          {inspection.files.length > 0 && (
            <div className="text-xs text-muted-foreground">
              <button
                type="button"
                onClick={() => setExpandedFiles((v) => !v)}
                className="inline-flex items-center gap-1 text-primary hover:underline"
              >
                {expandedFiles ? "Hide" : "Show"} files ({inspection.files.length})
              </button>
              {expandedFiles && (
                <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                  {inspection.files.map((f) => (
                    <li key={f.path} className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono">{f.path}</span>
                      <span className="shrink-0">{formatBytes(f.size)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* In-progress installs (from the store, incl. other pages) */}
      {Object.entries(progressMap).map(([id, p]) => (
        <div key={id} className="space-y-1 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="truncate text-foreground">{p.file}</span>
            <span className="shrink-0 text-muted-foreground">
              {formatBytes(p.received)} / {formatBytes(p.total)} · {Math.round(p.percent)}%
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${p.percent}%` }} />
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleCancel(id)}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted"
            >
              <X className="h-3 w-3" /> Cancel
            </button>
          </div>
        </div>
      ))}

      {/* Installed models */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground">
            Installed Hugging Face models ({modeInstalled.length})
          </p>
          {modeInstalled.length > 0 && (
            <button
              type="button"
              onClick={() => void fetchInstalled()}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ArrowCounterClockwise className="h-3 w-3" /> Refresh
            </button>
          )}
        </div>
        {modeInstalled.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
            <FileX className="h-4 w-4" />
            No {mode === "stt" ? "STT" : "TTS"} models installed from Hugging Face yet.
          </div>
        ) : (
          <div className="space-y-2">
            {modeInstalled.map((model) => (
              <InstalledModelRow key={model.id} model={model} onRemove={handleRemove} />
            ))}
          </div>
        )}
      </div>

      {/* Desktop-only gate note */}
      {!isTauri() && (
        <p className="text-xs text-muted-foreground">
          The Hugging Face model manager requires the desktop app (local transcription runtimes).
        </p>
      )}
    </div>
  );
}

export default HuggingFaceModelManager;
