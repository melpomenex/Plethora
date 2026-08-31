import { invokeCommand, isTauri } from "../lib/tauri";

// Out-of-the-box NVIDIA GPU runtime for local STT
// (mirrors src-tauri/src/transcription/gpu_runtime.rs).

export interface GpuRuntimeStatus {
  nvidiaDetected: boolean;
  driverVersion?: string | null;
  supported: boolean;
  flavor?: string | null;
  installed: boolean;
  installing: boolean;
  ready: boolean;
  reason?: string | null;
  downloadSizeBytes: number;
  onDiskBytes: number;
}

export interface GpuInstallProgress {
  stage: "downloading" | "extracting" | "verifying";
  label: string;
  received: number;
  total: number;
  percent: number;
}

export interface GpuInstallFinished {
  ok: boolean;
  message: string;
}

export const getGpuRuntimeStatus = (): Promise<GpuRuntimeStatus | null> => {
  if (!isTauri()) {
    return Promise.resolve(null);
  }
  return invokeCommand<GpuRuntimeStatus>("gpu_runtime_status");
};

export const installGpuRuntime = (): Promise<void> => {
  if (!isTauri()) {
    return Promise.reject(new Error("The GPU runtime requires the desktop app"));
  }
  return invokeCommand<void>("gpu_runtime_install");
};

export const cancelGpuRuntimeInstall = (): Promise<void> => {
  if (!isTauri()) {
    return Promise.resolve();
  }
  return invokeCommand<void>("gpu_runtime_install_cancel");
};

export const uninstallGpuRuntime = (): Promise<void> => {
  if (!isTauri()) {
    return Promise.resolve();
  }
  return invokeCommand<void>("gpu_runtime_uninstall");
};

/** Rough human-readable size ("1.4 GB") matching the backend's formatter. */
export const formatGpuBytes = (bytes: number): string => {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  return `${bytes} B`;
};
