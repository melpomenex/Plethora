/**
 * Curriculum Generation Schemas & Bounds.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/02-SHARED-CONTRACTS.md §3.3
 * - openspec/changes/generate-source-grounded-study-curricula/tasks.md (C2-T01)
 */

export const CURRICULUM_LIMITS = {
  SCHEMA_VERSION: 1,
  MIN_TOPICS_PER_BATCH: 3,
  MAX_TOPICS_PER_BATCH: 8,
  MAX_TOTAL_GENERATED_NODES: 24,
  MIN_OBJECTIVES_PER_TOPIC: 1,
  MAX_OBJECTIVES_PER_TOPIC: 6,
  MAX_SOURCES_PER_TOPIC: 8,
  MAX_SOURCES_PER_EDGE: 8,
  TITLE_MIN: 1,
  TITLE_MAX: 160,
  SUMMARY_MAX: 1000,
  OBJECTIVE_MIN: 1,
  OBJECTIVE_MAX: 240,
  CONCEPT_NAME_MIN: 1,
  CONCEPT_NAME_MAX: 160,
  WHY_HERE_MAX: 500,
  RATIONALE_MIN: 1,
  RATIONALE_MAX: 500,
  MAX_EDGES_PER_BATCH: 48,
  HANDLE_REGEX: /^[a-zA-Z0-9_-]{1,64}$/,
} as const;

export const CURRICULUM_DECOMPOSE_SCHEMA = {
  name: 'CurriculumDecomposeBatchOutput',
  nativeName: 'curriculumDecomposeBatchOutput',
  schemaVersion: 1,
  json: JSON.stringify({
    schemaVersion: 1,
    topics: [
      {
        handle: 'string',
        title: 'string',
        summary: 'string',
        learningObjectives: ['string'],
        conceptName: 'string',
        materialSupport: 'grounded',
        sourceHandles: ['string'],
        whyHere: 'string',
      },
    ],
  }),
} as const;

export const CURRICULUM_PREREQUISITE_SCHEMA = {
  name: 'CurriculumPrerequisiteOutput',
  nativeName: 'curriculumPrerequisiteOutput',
  schemaVersion: 1,
  json: JSON.stringify({
    schemaVersion: 1,
    edges: [
      {
        prerequisiteHandle: 'string',
        dependentHandle: 'string',
        rationale: 'string',
        sourceHandles: ['string'],
        support: 'inferred',
      },
    ],
  }),
} as const;
