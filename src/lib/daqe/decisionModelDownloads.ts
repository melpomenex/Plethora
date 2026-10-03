/**
 * Downloading a decision model's weights.
 *
 * ## Only Laya, and that is a fact about the models rather than a gap here
 *
 * Jev, Clef and the OpenRouter decision models are *services* — somebody else's
 * weights, reachable over an API. There is nothing to fetch. Laya (Convai
 * Innovations, Apache 2.0) publishes weights, so it is the one route where
 * "download" means anything.
 *
 * ## Why a fixed checkpoint list rather than a repo input
 *
 * `src-tauri/src/models/hf/security.md` fails closed on artifacts whose integrity
 * is not pinned: ONNX is parsed by a bundled runtime, so an unverified download
 * is untrusted input to an interpreter. A free-text Hugging Face id would let a
 * user route around that gate by typing any repository. The list below is the
 * set that ships with a pinned digest; the installer re-verifies before install
 * either way, but the list means nobody *has* to discover a repo by hand.
 *
 * The install path is the repository's existing one — the same
 * `useHfModelStore.install` that installs speech models, with the same resume,
 * retry, cancellation, SHA-256 verification and licence capture. This module adds
 * no downloader.
 */

import type { HfRuntime, InstalledHfModel } from "../../api/hfModels";

export interface LayaCheckpoint {
  /** Stable id used as the install/progress key. */
  runtime: HfRuntime;
  /** Hugging Face repo, `org/name`. */
  repoId: string;
  /** What this checkpoint is for, for the picker. */
  noteKey?: string;
  /** Only a hint for the size line; the installer's real total wins. */
  approxBytes: number;
}

/**
 * Laya checkpoints, smallest first.
 *
 * `laya` and `laya-multilingual` are the base checkpoints; `laya-typed-decision`
 * is the one fine-tuned for the typed-decision protocol DAQE speaks, so it is the
 * default a reader should reach for.
 */
export const LAYA_CHECKPOINTS: readonly LayaCheckpoint[] = [
  {
    runtime: "laya-decision",
    repoId: "convaiinnovations/laya-typed-decision",
    noteKey: "daqeDownload.typedDecision",
    approxBytes: 808_000_000,
  },
  {
    runtime: "laya-decision",
    repoId: "convaiinnovations/laya-multilingual",
    noteKey: "daqeDownload.multilingual",
    approxBytes: 647_000_000,
  },
  {
    runtime: "laya-decision",
    repoId: "convaiinnovations/laya",
    noteKey: "daqeDownload.english",
    approxBytes: 808_000_000,
  },
] as const;

/** The checkpoint a reader should get by default. */
export const DEFAULT_LAYA_CHECKPOINT = LAYA_CHECKPOINTS[0];

/** The id the installer's progress events are keyed by for a checkpoint. */
export function layaInstallId(checkpoint: LayaCheckpoint): string {
  return `${checkpoint.runtime}:${checkpoint.repoId}`;
}

/** Whether an installed model is a Laya checkpoint. */
export function isLayaModel(model: Pick<InstalledHfModel, "runtime">): boolean {
  return model.runtime === "laya-decision";
}

/**
 * Install a checkpoint through the existing Hugging Face installer.
 *
 * `runtime` and `artifactKind` are passed explicitly rather than inferred, so the
 * installer cannot pick a speech artifact out of a transformers repo: the
 * detection heuristic for `sherpa-onnx-*` would otherwise be a coin flip on a
 * repo that ships both, and choosing wrong means installing hundreds of megabytes
 * of something that cannot answer a `score` question.
 */
export async function installLayaCheckpoint(input: {
  checkpoint: LayaCheckpoint;
  install: (repoInput: string, runtime: HfRuntime, artifactKind: string) => Promise<InstalledHfModel>;
}): Promise<InstalledHfModel | null> {
  const { checkpoint, install } = input;
  try {
    return await install(checkpoint.repoId, checkpoint.runtime, "laya-decision");
  } catch {
    // A failed install must not take the settings panel down with it. The store
    // records the error and the UI shows it; returning null says "nothing landed".
    return null;
  }
}

/**
 * Whether a downloaded checkpoint can actually be served.
 *
 * A checkpoint without a tokenizer is inert, and a reader who has just installed
 * one should be told why nothing happens rather than left debugging a silent
 * no-op. The installer's artifact detection already refuses weight-only repos, so
 * this is a second line for the case where the install succeeded but the
 * directory is incomplete.
 */
export function isLayaUsable(model: Pick<InstalledHfModel, "artifact_files"> | null): boolean {
  if (!model) return false;
  const paths = (model.artifact_files ?? []).map((file) => file.path ?? "");
  const hasWeights = paths.some((p) => p.endsWith(".safetensors") || p.endsWith(".bin"));
  const hasTokenizer = paths.some((p) => p.includes("tokenizer"));
  return hasWeights && hasTokenizer;
}
