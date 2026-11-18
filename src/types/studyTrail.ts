import type { ExactSearchHitLocation } from './searchHit';

export type StructuralClass =
  | 'instructional_prose'
  | 'worked_example'
  | 'argument'
  | 'definition'
  | 'toc'
  | 'bibliography'
  | 'index'
  | 'front_matter'
  | 'heading_only'
  | 'running_header_footer'
  | 'incidental_mention'
  | 'other';

export type InstructionalRole =
  | 'core_explanation'
  | 'prerequisite_foundation'
  | 'worked_example'
  | 'counterexample'
  | 'synthesis'
  | 'alternative_perspective'
  | 'remediation';

export type SegmentValidationStatus =
  | 'verified'
  | 'stale'
  | 'missing'
  | 'needs_ocr'
  | 'rejected'
  | 'manual';

export type SegmentReadinessStatus =
  | 'ready'
  | 'needs_ocr'
  | 'needs_transcript'
  | 'unindexed'
  | 'unavailable';

export type ObjectiveCoverageStatus =
  | 'adequately_covered'
  | 'partially_covered'
  | 'multi_segment'
  | 'insufficient'
  | 'no_match'
  | 'source_unavailable'
  | 'revision_changed';

export type StudyTrailItemStatus =
  | 'pending'
  | 'in_progress'
  | 'reading_completed'
  | 'check_passed'
  | 'check_needs_review'
  | 'skipped'
  | 'deferred';

export type FormativePromptFormat =
  | 'explain_own_words'
  | 'apply_example'
  | 'distinguish_concepts'
  | 'argument_from_premises'
  | 'identify_misconception'
  | 'source_grounded_short_answer';

export type FormativeCheckOutcome = 'understood' | 'partial' | 'needs_review';

export type AssessmentEligibilityPolicy = 'guided' | 'assessment-first' | 'open';

export interface LearningSegment {
  id: string;
  documentId: string;
  documentRevision: string;
  format: string;
  title: string;
  parentSectionLabel?: string | null;
  startLocator: ExactSearchHitLocation | Record<string, unknown>;
  endLocator: ExactSearchHitLocation | Record<string, unknown>;
  startOffset?: number | null;
  endOffset?: number | null;
  excerptPreview: string;
  wordCount: number;
  estimatedDurationSeconds: number;
  structuralClass: StructuralClass;
  instructionalRole: InstructionalRole;
  qualityScore?: number | null;
  qualityRationale?: string | null;
  validationStatus: SegmentValidationStatus;
  readinessStatus: SegmentReadinessStatus;
  generatorVersion: string;
  schemaVersion: number;
  provenance: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface LearningSegmentObjectiveLink {
  id: string;
  planId: string;
  versionId: string;
  nodeId: string;
  objectiveIndex: number;
  segmentId: string;
  coverageStatus: ObjectiveCoverageStatus;
  alignmentScore?: number | null;
  selectionRationale: string;
  isPrimary: boolean;
  isRequired: boolean;
  authoredOverride: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StudyTrailItem {
  id: string;
  planId: string;
  versionId: string;
  nodeId: string;
  objectiveIndex: number;
  segmentId?: string | null;
  trailOrder: number;
  sessionGroupId?: string | null;
  status: StudyTrailItemStatus;
  readingProgress: number;
  lastLocator?: Record<string, unknown> | null;
  isRequired: boolean;
  isRemediation: boolean;
  remediationGapId?: string | null;
  manualOrderOverride?: number | null;
  rejectedReason?: string | null;
  plannerRationale: string;
  updatedAt: string;
}

export interface FormativeMultipleChoiceQuestion {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  sourceMode: 'ai' | 'deterministic';
}

export interface FormativeCheckResult {
  id: string;
  planId: string;
  versionId: string;
  trailItemId: string;
  nodeId: string;
  objectiveIndex: number;
  promptFormat: FormativePromptFormat;
  promptText: string;
  learnerResponse: string;
  outcome: FormativeCheckOutcome;
  feedback: string;
  recommendedSegmentId?: string | null;
  createdAt: string;
}

export interface AssessmentEligibilitySummary {
  policy: AssessmentEligibilityPolicy;
  eligible: boolean;
  requiredTotal: number;
  requiredCompleted: number;
  checksPassed: number;
  blockingReasons: string[];
  testOutAvailable: boolean;
}

export interface StudyTrailOverview {
  planId: string;
  versionId: string;
  segments: LearningSegment[];
  objectiveLinks: LearningSegmentObjectiveLink[];
  trailItems: StudyTrailItem[];
  formativeChecks: FormativeCheckResult[];
  eligibility: AssessmentEligibilitySummary;
  documentTitles: Record<string, string>;
  diagnostics: string[];
}
