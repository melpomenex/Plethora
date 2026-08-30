/**
 * API surface for the Hugging Face speech-model manager (requirement #19).
 *
 * Mirrors the Rust types in `src-tauri/src/models/hf/` (snake_case fields, as
 * Tauri serializes them). All commands are desktop-only; the browser/PWA build
 * returns empty/disabled states.
 */
import { invokeCommand, isTauri } from "../lib/tauri";

export type HfRuntime = "whisper-cpp" | "sherpa-onnx-stt" | "sherpa-onnx-tts" | "nemotron-asr";
export type SherpaSttFamily = "nemo-ctc" | "sense-voice" | "zipformer" | "paraformer";
/** Family of a sherpa-onnx TTS contract (`RunContract::SherpaTts.family`). */
export type SherpaTtsFamily = "vits" | "kokoro" | "kitten" | "supertonic";
export type DetectionConfidence = "exact" | "heuristic";
export type SuitabilityLevel =
  | "recommended"
  | "should-run"
  | "may-run-slowly"
  | "not-recommended"
  | "unsupported-runtime";

export interface HfRepoFile {
  path: string;
  size: number | null;
  sha256: string | null;
}

export interface HfArtifactFile {
  path: string;
  size: number | null;
  sha256: string | null;
}

export interface RunContract {
  type: "whisper" | "sherpa-stt" | "sherpa-tts";
  model_file: string;
  decoder_file?: string | null;
  joiner_file?: string | null;
  tokens_file?: string | null;
  voices_file?: string | null;
  /**
   * Contract family. For `sherpa-stt`: one of SherpaSttFamily. For
   * `sherpa-tts`: one of SherpaTtsFamily (absent on legacy rows, which the
   * backend infers on read).
   */
  family?: SherpaSttFamily | SherpaTtsFamily;
  /** Supertonic pipeline files (repo-relative), all required at run time. */
  text_encoder_file?: string | null;
  vector_estimator_file?: string | null;
  vocoder_file?: string | null;
  tts_json_file?: string | null;
  unicode_indexer_file?: string | null;
  voice_bin_file?: string | null;
  data_dir?: string | null;
  use_itn?: boolean;
}

export interface HfArtifact {
  runtime: HfRuntime;
  kind: string;
  label: string;
  files: HfArtifactFile[];
  download_size_bytes: number;
  run_contract: RunContract;
  estimated_memory_bytes: number;
  confidence: DetectionConfidence;
  /** Family extras: `precision`, `family`, `voice_roster` (supertonic). */
  metadata?: Record<string, string>;
}

export interface MachineFacts {
  has_gpu: boolean;
  gpu_vram_bytes: number | null;
  total_memory_bytes: number;
  available_memory_bytes: number;
  is_apple_silicon: boolean;
  disk_free_bytes: number | null;
}

export interface Suitability {
  level: SuitabilityLevel;
  explanation: string;
  requires: string[];
  machine: MachineFacts;
}

export interface ArtifactSuitability {
  artifact: HfArtifact;
  suitability: Suitability;
}

export interface GpuInfo {
  name: string;
  vram_bytes: number | null;
  vendor: string;
}

export interface SystemInfo {
  os: string;
  os_version: string | null;
  arch: string;
  cpu_brand: string | null;
  logical_cores: number;
  physical_cores: number | null;
  total_memory_bytes: number;
  available_memory_bytes: number;
  gpu: GpuInfo | null;
  cuda_available: boolean;
  metal_available: boolean;
  is_apple_silicon: boolean;
  disk_free_bytes: number | null;
  disk_total_bytes: number | null;
  supported_accelerators: string[];
}

export interface HfInspection {
  repo_id: string;
  revision: string;
  name: string;
  author: string | null;
  task: string | null;
  architecture: string[];
  params_millions: number | null;
  precision: string | null;
  download_size_bytes: number;
  license: string | null;
  files: HfRepoFile[];
  candidates: HfArtifact[];
  suitability: ArtifactSuitability[];
  system_info: SystemInfo;
  estimates_labeled: boolean;
}

export interface InstalledModelFile {
  path: string;
  size: number;
  sha256: string | null;
}

export interface InstalledHfModel {
  id: string;
  repo_id: string;
  revision: string;
  runtime: HfRuntime;
  artifact_kind: string;
  install_dir: string;
  artifact_files: InstalledModelFile[];
  download_size_bytes: number;
  license: string | null;
  run_contract: RunContract;
  installed_at: string;
  installed: boolean;
}

/** Progress event emitted by the backend during an install. */
export interface HfInstallProgress {
  id: string;
  file: string;
  received: number;
  total: number;
  percent: number;
}

export const hfInspectModel = async (repoInput: string): Promise<HfInspection> => {
  if (!isTauri()) throw new Error("Hugging Face models require the desktop app");
  return invokeCommand<HfInspection>("hf_inspect_model", { repoInput });
};

export const hfInstallModel = async (
  repoInput: string,
  runtime: HfRuntime,
  artifactKind: string,
): Promise<InstalledHfModel> => {
  if (!isTauri()) throw new Error("Hugging Face models require the desktop app");
  return invokeCommand<InstalledHfModel>("hf_install_model", {
    repoInput,
    runtime,
    artifactKind,
  });
};

export const hfCancelInstall = (id: string): Promise<void> => {
  if (!isTauri()) return Promise.resolve();
  return invokeCommand("hf_cancel_install", { id });
};

export const hfUninstallModel = (id: string): Promise<void> => {
  if (!isTauri()) return Promise.reject(new Error("Hugging Face models require the desktop app"));
  return invokeCommand("hf_uninstall_model", { id });
};

export interface PinnedNemotronAsrCatalogEntry {
  logicalKey: string;
  repoId: string;
  revision: string;
  displayName: string;
  sizeBytes: number;
  license: string;
  capability: string;
  supportsStreaming: boolean;
  languages: string[];
}

export const getInstalledHfModels = (): Promise<InstalledHfModel[]> => {
  if (!isTauri()) return Promise.resolve([]);
  return invokeCommand<InstalledHfModel[]>("get_installed_hf_models");
};

export const getNemotronAsrCatalogEntry = (): Promise<PinnedNemotronAsrCatalogEntry | null> => {
  if (!isTauri()) return Promise.resolve(null);
  return invokeCommand<PinnedNemotronAsrCatalogEntry>("get_nemotron_asr_catalog_entry");
};

export const getSystemInfo = (): Promise<SystemInfo> => {
  if (!isTauri()) {
    // Browser fallback: report the webview's coarse capabilities only.
    return Promise.resolve({
      os: "web",
      os_version: null,
      arch: "web",
      cpu_brand: null,
      logical_cores: navigator.hardwareConcurrency || 0,
      physical_cores: null,
      total_memory_bytes: 0,
      available_memory_bytes: 0,
      gpu: null,
      cuda_available: false,
      metal_available: false,
      is_apple_silicon: false,
      disk_free_bytes: null,
      disk_total_bytes: null,
      supported_accelerators: [],
    });
  }
  return invokeCommand<SystemInfo>("get_system_info");
};

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "unknown";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}

export const RUNTIME_LABELS: Record<HfRuntime, string> = {
  "whisper-cpp": "whisper.cpp (ggml)",
  "sherpa-onnx-stt": "sherpa-onnx (ONNX STT)",
  "sherpa-onnx-tts": "sherpa-onnx (ONNX TTS)",
  "nemotron-asr": "Nemotron ASR (streaming ONNX)",
};
