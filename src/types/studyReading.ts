import type { ExactSearchHitLocation } from './searchHit';

export interface StudyReadingQuote {
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface StudyReadingSegment {
  quote: StudyReadingQuote;
  location?: ExactSearchHitLocation;
  spineIndex?: number;
  heading?: string;
}

export interface StudyReadingAssignment {
  schemaVersion: 1;
  id: string;
  topicId: string;
  documentId: string;
  documentTitle: string;
  documentRevision: string;
  format: 'epub' | 'pdf' | 'html' | 'markdown';
  segments: StudyReadingSegment[];
  objectiveIndexes: number[];
  sourceRefIds: string[];
  label?: string;
  rationale?: string;
  authored?: boolean;
}

export interface StudyReadingManifest {
  assignments: StudyReadingAssignment[];
}

export interface StudyTrailSession {
  currentAssignmentId: string | null;
  completedAssignmentIds: string[];
  skippedAssignmentIds: string[];
  topicId: string | null;
}

export interface StudyReadingTrail {
  planId: string;
  versionId: string;
  revision: number;
  manifest: StudyReadingManifest;
  session: StudyTrailSession | null;
}

export type StudyTrailNavigationStatus =
  | 'exact' | 'coarse' | 'ambiguous' | 'stale' | 'missing' | 'unsupported' | 'failed';

export interface StudyTrailNavigationResult {
  requestId: number;
  assignmentId: string;
  status: StudyTrailNavigationStatus;
}
