/**
 * Legacy Learning Paths localStorage Migration Adapter.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/04-DATA-AND-MIGRATION-PLAN.md §9.1
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T07)
 */

import { importLegacyStudyPlans } from '../../api/study-plans';
import { sha256Hex } from './sourceValidation';
import { orderStudyPlan } from './topology';
import type { StudyPlanVersionNode, PlanPrerequisite } from '../../types/learningPaths';

export const LEGACY_STORAGE_KEY = 'plethora-learning-paths';
export const LEGACY_BACKUP_KEY = 'plethora-learning-paths:backup:v1';

export interface LegacyGoal {
  id: string;
  title: string;
  description?: string;
  status: string;
  createdAt?: string;
}

export interface LegacyNode {
  id: string;
  pathId: string;
  title: string;
  conceptId?: string;
  conceptName?: string;
  sourceDocIds?: string[];
  prerequisiteNodeIds?: string[];
  estimatedMasteryStart?: number;
  targetMastery?: number;
  orderIndex?: number;
  isUserModified?: boolean;
  status?: string;
}

export interface LegacyPath {
  id: string;
  goalId: string;
  version?: number;
  title: string;
  nodes: LegacyNode[];
  status?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LegacyEnvelope {
  state: {
    goals: LegacyGoal[];
    paths: LegacyPath[];
    activePathId?: string | null;
  };
  version: number;
}

export interface LegacyPathDefect {
  pathId: string;
  nodeId?: string;
  code:
    | 'unknown_goal'
    | 'duplicate_node'
    | 'cycle'
    | 'dangling_prerequisite'
    | 'malformed_structure'
    | 'newer_version';
  message: string;
}

export interface LegacyImportPreview {
  hasData: boolean;
  rawJson?: string;
  importHash?: string;
  version?: number;
  totalGoals: number;
  totalPaths: number;
  validPaths: LegacyPath[];
  invalidPaths: Array<{ path: LegacyPath; defects: LegacyPathDefect[] }>;
  defects: LegacyPathDefect[];
  canImport: boolean;
}

export interface LegacyImportExecutionResult {
  ok: boolean;
  importedPlanId?: string;
  importedNodeCount?: number;
  isRetry?: boolean;
  backupKeyCreated: boolean;
  error?: string;
}

/**
 * Reads and inspects the legacy localStorage envelope without mutating storage.
 */
export function previewLegacyLearningPathsImport(
  storage: Storage = typeof window !== 'undefined' ? window.localStorage : ({} as Storage)
): LegacyImportPreview {
  let rawJson: string | null = null;
  try {
    rawJson = storage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    // Storage access issue
  }

  if (!rawJson) {
    return {
      hasData: false,
      totalGoals: 0,
      totalPaths: 0,
      validPaths: [],
      invalidPaths: [],
      defects: [],
      canImport: false,
    };
  }

  let envelope: any;
  try {
    envelope = JSON.parse(rawJson);
  } catch {
    return {
      hasData: true,
      rawJson,
      totalGoals: 0,
      totalPaths: 0,
      validPaths: [],
      invalidPaths: [],
      defects: [
        {
          pathId: 'root',
          code: 'malformed_structure',
          message: 'Unable to parse JSON envelope from plethora-learning-paths',
        },
      ],
      canImport: false,
    };
  }

  // Refuse newer major versions (e.g. version > 0)
  if (typeof envelope?.version === 'number' && envelope.version > 0) {
    return {
      hasData: true,
      rawJson,
      version: envelope.version,
      totalGoals: 0,
      totalPaths: 0,
      validPaths: [],
      invalidPaths: [],
      defects: [
        {
          pathId: 'root',
          code: 'newer_version',
          message: `Refusing newer version ${envelope.version} of plethora-learning-paths`,
        },
      ],
      canImport: false,
    };
  }

  if (
    !envelope ||
    typeof envelope !== 'object' ||
    !envelope.state ||
    !Array.isArray(envelope.state.goals) ||
    !Array.isArray(envelope.state.paths)
  ) {
    return {
      hasData: true,
      rawJson,
      version: envelope?.version ?? 0,
      totalGoals: 0,
      totalPaths: 0,
      validPaths: [],
      invalidPaths: [],
      defects: [
        {
          pathId: 'root',
          code: 'malformed_structure',
          message: 'Invalid envelope structure: missing state.goals or state.paths',
        },
      ],
      canImport: false,
    };
  }

  const importHash = `import_${sha256Hex(rawJson)}`;
  const goals: LegacyGoal[] = envelope.state.goals;
  const paths: LegacyPath[] = envelope.state.paths;
  const goalIds = new Set(goals.map((g) => g.id));

  const validPaths: LegacyPath[] = [];
  const invalidPaths: Array<{ path: LegacyPath; defects: LegacyPathDefect[] }> = [];
  const allDefects: LegacyPathDefect[] = [];

  for (const path of paths) {
    const pathDefects: LegacyPathDefect[] = [];

    // Check unknown goal
    if (!goalIds.has(path.goalId)) {
      pathDefects.push({
        pathId: path.id,
        code: 'unknown_goal',
        message: `Unknown goal id "${path.goalId}" referenced by path "${path.id}"`,
      });
    }

    // Check duplicate node ids and repair mismatched pathId
    const seenNodeIds = new Set<string>();
    const nodes = Array.isArray(path.nodes) ? path.nodes : [];

    for (const node of nodes) {
      if (seenNodeIds.has(node.id)) {
        pathDefects.push({
          pathId: path.id,
          nodeId: node.id,
          code: 'duplicate_node',
          message: `Duplicate node id "${node.id}" in path "${path.id}"`,
        });
      }
      seenNodeIds.add(node.id);
      // Repair mismatched path id to containing path
      if (node.pathId !== path.id) {
        node.pathId = path.id;
      }
    }

    // Check dangling prerequisites & cycles
    const versionNodes: StudyPlanVersionNode[] = nodes.map((n, idx) => ({
      nodeId: n.id,
      title: n.title || 'Untitled',
      summary: '',
      learningObjectives: ['Topic objective'],
      conceptId: n.conceptId ?? null,
      conceptLabel: n.conceptName ?? n.title ?? 'Topic',
      position: idx,
      included: true,
      locked: false,
      userAdded: false,
      userModified: Boolean(n.isUserModified),
      materialSupport: 'not-validated',
      whyHere: null,
      sourceRefIds: [],
    }));

    const prereqs: PlanPrerequisite[] = [];
    for (const n of nodes) {
      for (const pId of n.prerequisiteNodeIds || []) {
        if (!seenNodeIds.has(pId)) {
          pathDefects.push({
            pathId: path.id,
            nodeId: n.id,
            code: 'dangling_prerequisite',
            message: `Node "${n.id}" references dangling prerequisite "${pId}"`,
          });
        } else {
          prereqs.push({
            prerequisiteNodeId: pId,
            dependentNodeId: n.id,
            support: 'user',
            rationale: null,
            sourceRefIds: [],
          });
        }
      }
    }

    if (nodes.length > 0 && pathDefects.length === 0) {
      const orderRes = orderStudyPlan(versionNodes, prereqs);
      if (!orderRes.ok) {
        if (orderRes.error.code === 'dependency_cycle') {
          pathDefects.push({
            pathId: path.id,
            code: 'cycle',
            message: `Dependency cycle detected in path "${path.id}"`,
          });
        }
      }
    }

    if (pathDefects.length > 0) {
      invalidPaths.push({ path, defects: pathDefects });
      allDefects.push(...pathDefects);
    } else {
      validPaths.push(path);
    }
  }

  return {
    hasData: true,
    rawJson,
    importHash,
    version: envelope.version ?? 0,
    totalGoals: goals.length,
    totalPaths: paths.length,
    validPaths,
    invalidPaths,
    defects: allDefects,
    canImport: validPaths.length > 0,
  };
}

/**
 * Executes idempotent legacy import to SQLite via Tauri backend.
 * On success, renames plethora-learning-paths -> plethora-learning-paths:backup:v1.
 * On failure, leaves plethora-learning-paths untouched.
 */
export async function executeLegacyLearningPathsImport(
  storage: Storage = typeof window !== 'undefined' ? window.localStorage : ({} as Storage)
): Promise<LegacyImportExecutionResult> {
  const preview = previewLegacyLearningPathsImport(storage);
  if (!preview.hasData || !preview.canImport || !preview.rawJson || !preview.importHash) {
    return {
      ok: false,
      backupKeyCreated: false,
      error: preview.defects[0]?.message || 'No valid paths to import',
    };
  }

  try {
    const result = await importLegacyStudyPlans(preview.rawJson, preview.importHash);

    // Only after full successful commit:
    storage.setItem(LEGACY_BACKUP_KEY, preview.rawJson);
    storage.removeItem(LEGACY_STORAGE_KEY);

    return {
      ok: true,
      importedPlanId: result.planId,
      importedNodeCount: result.importedNodeCount,
      isRetry: result.isRetry,
      backupKeyCreated: true,
    };
  } catch (err: any) {
    // Keep original for retry
    return {
      ok: false,
      backupKeyCreated: false,
      error: err?.messageKey || err?.message || 'Legacy import failed',
    };
  }
}
