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
  /** Pinned Hugging Face commit SHA verified against upstream. */
  revision: string;
  /** Published SHA-256 of the primary model.safetensors weight file. */
  safetensorsSha256: string;
  /** What this checkpoint is for, for the picker. */
  noteKey?: string;
  /** Only a hint for the size line; the installer's real total wins. */
  approxBytes: number;
}

/**
 * Laya checkpoints, ordered with the typed-decision default first.
 *
 * `laya` and `laya-multilingual` are the base checkpoints;
 * `laya-typed-decisions` is fine-tuned for the typed-decision System One
 * protocol DAQE speaks, so it is the default a reader should reach for.
 */
export const LAYA_CHECKPOINTS: readonly LayaCheckpoint[] = [
  {
    runtime: "laya-decision",
    repoId: "convaiinnovations/laya-typed-decisions",
    revision: "3903ff997712bd73ccb2dc879262dac8f0d443bb",
    safetensorsSha256: "4fa56de72383a9d3efa9cfa78955733c81b9fc8067a587ca4beb82c78107a24e",
    noteKey: "daqeDownload.typedDecision",
    approxBytes: 842_609_220,
  },
  {
    runtime: "laya-decision",
    repoId: "convaiinnovations/laya-multilingual",
    revision: "7888aeecb5e80bfde9952292c18de28e974eabc4",
    safetensorsSha256: "9d628fd971b700382ac6f65920a86f149777b2e748e0c955fb3b19695aa8f204",
    noteKey: "daqeDownload.multilingual",
    approxBytes: 643_835_514,
  },
  {
    runtime: "laya-decision",
    repoId: "convaiinnovations/laya",
    revision: "fd4f9dbcf4fde222fd43174bdd4c3b08b789e4e1",
    safetensorsSha256: "891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c",
    noteKey: "daqeDownload.english",
    approxBytes: 842_609_210,
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
