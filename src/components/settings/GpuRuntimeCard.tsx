import { useEffect } from "react";
import { CheckCircle, CircleNotch, Download, Lightning, Trash, Warning, X } from "@phosphor-icons/react";
import {
  cancelGpuRuntimeInstall,
  formatGpuBytes,
  installGpuRuntime,
  uninstallGpuRuntime,
} from "../../api/gpuRuntime";
import { useGpuRuntimeStore } from "../../stores/useGpuRuntimeStore";
import { useToastStore, ToastType } from "../common/Toast";

/**
 * GPU runtime status card for local STT (desktop, inside the compute-device
 * block of AudioTranscriptionSettings). Shows one of:
 *  - ready (CUDA flavor + driver) with a remove action
 *  - install progress (weighted % + bytes + cancel)
 *  - an install offer with the one-time download size disclosure
 *  - an honest "not supported here" reason (e.g. driver too old)
 * Renders nothing when there is no NVIDIA GPU or outside Tauri.
 */
export function GpuRuntimeCard() {
  const status = useGpuRuntimeStore((s) => s.status);
  const installProgress = useGpuRuntimeStore((s) => s.installProgress);
  const installError = useGpuRuntimeStore((s) => s.installError);
  const refresh = useGpuRuntimeStore((s) => s.refresh);
  const setInstallError = useGpuRuntimeStore((s) => s.setInstallError);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!status || (!status.nvidiaDetected && !status.installed)) {
    return null;
  }

  const handleInstall = async () => {
    setInstallError(null);
    try {
      await installGpuRuntime();
    } catch (error) {
      // Background failures also arrive via gpu-runtime://install-finished;
      // this covers a rejected promise without an event.
      setInstallError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleCancel = async () => {
    await cancelGpuRuntimeInstall();
  };

  const handleRemove = async () => {
    try {
      await uninstallGpuRuntime();
      await refresh();
    } catch (error) {
      useToastStore.getState().addToast({
        type: ToastType.Error,
        title: "Could not remove the GPU runtime",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const flavorLabel =
    status.flavor === "cuda-13" ? "CUDA 13" : status.flavor === "cuda-12" ? "CUDA 12" : "CUDA";

  // ── Ready ────────────────────────────────────────────────────────────────
  if (status.ready) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <CheckCircle className="h-3.5 w-3.5 shrink-0" />
          GPU acceleration ready ({flavorLabel}
          {status.driverVersion ? ` · driver ${status.driverVersion}` : ""}) — local
          transcription runs on your NVIDIA GPU.
        </p>
        <button
          type="button"
          onClick={() => void handleRemove()}
          className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          title={`Remove the GPU runtime (${formatGpuBytes(status.onDiskBytes)} on disk)`}
        >
          <Trash className="h-3 w-3" />
          Remove
        </button>
      </div>
    );
  }

  // ── Installing ───────────────────────────────────────────────────────────
  if (status.installing || installProgress) {
    const percent = installProgress?.percent ?? 0;
    const label = installProgress?.label ?? "starting";
    const stage = installProgress?.stage ?? "downloading";
    const bytes =
      installProgress && installProgress.total > 0
        ? `${formatGpuBytes(installProgress.received)} / ${formatGpuBytes(installProgress.total)}`
        : "";
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 text-xs font-medium text-primary">
          <span className="flex items-center gap-1.5">
            <CircleNotch className="h-3.5 w-3.5 animate-spin" />
            {stage === "downloading"
              ? `Downloading GPU runtime — ${label}`
              : stage === "extracting"
                ? `Extracting ${label}…`
                : `Verifying ${label}…`}
          </span>
          <span className="flex items-center gap-2">
            {bytes && <span className="font-mono text-[10px] text-muted-foreground">{bytes}</span>}
            <span>{percent}%</span>
            <button
              type="button"
              onClick={() => void handleCancel()}
              className="flex items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${Math.max(percent, 2)}%` }}
          />
        </div>
      </div>
    );
  }

  // ── Not supported here (e.g. driver too old) ─────────────────────────────
  if (!status.supported) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
        <Warning className="h-3.5 w-3.5 shrink-0" />
        {status.reason ?? "GPU acceleration is not available on this machine."} Local
        transcription runs on CPU.
      </p>
    );
  }

  // ── Offer (supported NVIDIA, runtime not installed) ──────────────────────
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lightning className="h-3.5 w-3.5 shrink-0 text-primary" />
          NVIDIA GPU detected — accelerate local transcription ({flavorLabel}
          {status.driverVersion ? ` · driver ${status.driverVersion}` : ""}).
        </p>
        <button
          type="button"
          onClick={() => void handleInstall()}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Download className="h-3.5 w-3.5" />
          Install GPU runtime
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground/80">
        One-time download of ~{formatGpuBytes(status.downloadSizeBytes)}: CUDA libraries, the
        GPU build of the speech engine, and its full-precision (fp32) model — GPU transcription
        measures ~3× faster than CPU with it. The download starts automatically the first time
        local GPU transcription runs; transcription keeps working on CPU in the meantime.
      </p>
      {installError && (
        <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <Warning className="h-3.5 w-3.5 shrink-0" />
          {installError}
        </p>
      )}
    </div>
  );
}
