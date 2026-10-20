/**
 * Release-evidence recording/validation (V1.3, V3.x, V4.3).
 *
 * The rules are deliberately strict: a cell can only resolve to `pass` when
 * there is current, release-commit-matching evidence at every required
 * execution layer, covering every required stage. Mock/emulator evidence can
 * never satisfy a physical-device or real-provider requirement, and a stale
 * capability revision invalidates the record.
 */

import type {
  AiLearningFeatureId,
  QualificationCell,
  QualificationCellState,
  QualificationLayer,
} from "./fixtures";

export type EvidenceOutcome = "pass" | "fail" | "unsupported";

export interface EvidenceMetric {
  readonly name: string;
  readonly value: number;
  /** Required: "ms", "MiB", "percent", "count", … */
  readonly unit: string;
}

export interface EvidenceRecord {
  readonly id: string;
  readonly cellId: string;
  readonly feature: AiLearningFeatureId;
  readonly platform: string;
  /** Release commit/build identity the evidence was captured against. */
  readonly commit: string;
  readonly buildHash?: string;
  readonly appVersion: string;
  readonly osVersion: string;
  readonly runtimeVersion: string;
  readonly modelVersion?: string;
  /** Capability/model/index revision observed during the run. */
  readonly capabilityRevision: string;
  readonly layer: QualificationLayer;
  readonly fixtureHashes: readonly string[];
  readonly outcome: EvidenceOutcome;
  readonly exercisedStages: readonly string[];
  readonly redactedEvidencePath: string;
  readonly command: string;
  readonly host: string;
  readonly owner: string;
  readonly blockerId?: string;
  readonly metrics?: readonly EvidenceMetric[];
  readonly capturedAt: number;
}

export interface EvidenceContext {
  readonly releaseCommit: string;
  readonly capabilityRevision: string;
  /** Stages a feature's production path must actually exercise for completion. */
  readonly requiredStages?: Readonly<Partial<Record<AiLearningFeatureId, readonly string[]>>>;
  readonly requiredFixtureHashes?: readonly string[];
}

export const DEFAULT_REQUIRED_STAGES: Readonly<
  Partial<Record<AiLearningFeatureId, readonly string[]>>
> = {
  "learn-this": ["generation", "validation", "preview", "persistence"],
  "library-rag": ["retrieval", "generation", "validation", "navigation"],
  "socratic-tutor": ["generation", "validation", "preview"],
  "occlusion-assist": ["preflight", "generation", "validation", "preview"],
  "semantic-index": ["preflight", "retrieval", "persistence"],
  "answer-assessment": ["generation", "validation", "persistence"],
  "knowledge-relationships": ["retrieval", "generation", "validation", "preview", "persistence"],
  "extract-worthiness": ["preflight", "generation", "validation", "preview"],
  "learning-agent": ["preflight", "retrieval", "generation", "validation", "persistence"],
  "active-recall": ["generation", "validation", "preview"],
};

const LAYER_STRENGTH: Record<QualificationLayer, number> = {
  unit: 0,
  "mock-integration": 1,
  emulator: 2,
  "desktop-real-provider": 3,
  "physical-device": 3,
};

export function validateEvidenceRecord(
  record: EvidenceRecord,
  context: EvidenceContext
): string[] {
  const problems: string[] = [];

  if (!record.redactedEvidencePath.trim()) {
    problems.push(`${record.id}: missing redacted evidence path`);
  }
  if (!record.command.trim()) problems.push(`${record.id}: missing reproduction command`);
  if (!record.host.trim()) problems.push(`${record.id}: missing host identity`);
  if (!record.owner.trim()) problems.push(`${record.id}: missing owner`);
  if (record.outcome === "pass") {
    if (record.commit !== context.releaseCommit) {
      problems.push(`${record.id}: commit ${record.commit} is not the release commit`);
    }
    if (record.capabilityRevision !== context.capabilityRevision) {
      problems.push(`${record.id}: stale capability revision`);
    }
    const required = context.requiredStages?.[record.feature] ??
      DEFAULT_REQUIRED_STAGES[record.feature] ??
      [];
    const missing = required.filter((stage) => !record.exercisedStages.includes(stage));
    if (missing.length > 0) {
      problems.push(`${record.id}: missing required stages ${missing.join(", ")}`);
    }
    if (context.requiredFixtureHashes) {
      for (const hash of context.requiredFixtureHashes) {
        if (!record.fixtureHashes.includes(hash)) {
          problems.push(`${record.id}: missing fixture hash ${hash}`);
        }
      }
    }
    for (const metric of record.metrics ?? []) {
      if (!metric.unit) problems.push(`${record.id}: metric ${metric.name} has no unit`);
      if (!Number.isFinite(metric.value)) {
        problems.push(`${record.id}: metric ${metric.name} is not finite`);
      }
    }
  }
  if (record.outcome === "fail" && !record.blockerId) {
    problems.push(`${record.id}: failed evidence needs a blocker id`);
  }
  if (record.outcome === "unsupported" && !record.blockerId) {
    problems.push(`${record.id}: unsupported evidence needs a graceful-degradation reference`);
  }
  return problems;
}

/**
 * Resolve a cell from its records. A pass requires one valid passing record at
 * EVERY required layer; a lower layer never substitutes a higher one.
 */
export function resolveCellState(
  cell: QualificationCell,
  records: readonly EvidenceRecord[],
  context: EvidenceContext
): QualificationCellState {
  if (cell.intent === "none") return "unsupported";
  const cellRecords = records.filter((record) => record.cellId === cell.id);
  if (cellRecords.some((record) => record.outcome === "fail")) {
    return "fail";
  }

  for (const layer of cell.requiredLayers) {
    const atLayer = cellRecords.filter((record) => record.layer === layer);
    if (atLayer.length === 0) {
      // An emulator record cannot satisfy a physical-device requirement; it
      // also cannot satisfy a desktop real-provider requirement.
      return "pending";
    }
    const validPass = atLayer.some(
      (record) =>
        record.outcome === "pass" &&
        validateEvidenceRecord(record, context).length === 0
    );
    if (!validPass) return "pending";
  }

  return "pass";
}

/** True when a record's layer can satisfy a required layer. */
export function layerSatisfies(
  provided: QualificationLayer,
  required: QualificationLayer
): boolean {
  if (provided === required) return true;
  // Real-provider and physical-device are both "real execution" but for
  // different form factors; they are not interchangeable.
  if (required === "physical-device") return provided === "physical-device";
  if (required === "desktop-real-provider") return provided === "desktop-real-provider";
  return LAYER_STRENGTH[provided] >= LAYER_STRENGTH[required];
}

export interface EvidenceManifest {
  readonly schemaVersion: "ai-learning-evidence-v1";
  readonly releaseCommit: string;
  readonly capabilityRevision: string;
  readonly records: readonly EvidenceRecord[];
}

export function validateEvidenceManifest(
  manifest: EvidenceManifest,
  context: EvidenceContext = {
    releaseCommit: manifest.releaseCommit,
    capabilityRevision: manifest.capabilityRevision,
  }
): string[] {
  const problems: string[] = [];
  if (manifest.schemaVersion !== "ai-learning-evidence-v1") {
    problems.push("unknown evidence schema version");
  }
  const ids = new Set<string>();
  for (const record of manifest.records) {
    if (ids.has(record.id)) problems.push(`duplicate evidence id ${record.id}`);
    ids.add(record.id);
    problems.push(...validateEvidenceRecord(record, context));
  }
  return problems;
}
