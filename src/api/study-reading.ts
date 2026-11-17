import { invokeCommand } from '../lib/tauri';
import type { StudyReadingManifest, StudyReadingTrail, StudyTrailSession } from '../types/studyReading';
import type { StudySourceResolution } from '../types/studySource';
import { normalizeStudyError } from './study-plans';
import type { ChunkLocation } from './ai-learning';

async function invokeTrail(command: string, args: Record<string, unknown>): Promise<StudyReadingTrail> {
  try {
    return await invokeCommand<StudyReadingTrail>(command, args);
  } catch (error) {
    throw normalizeStudyError(error);
  }
}

export function getStudyReadingTrail(planId: string, versionId: string) {
  return invokeTrail('get_study_reading_trail', { planId, versionId });
}

export function saveStudyReadingManifest(
  planId: string,
  versionId: string,
  expectedRevision: number,
  manifest: StudyReadingManifest,
) {
  return invokeTrail('save_study_reading_manifest', { planId, versionId, expectedRevision, manifest });
}

export function saveStudyTrailSession(
  planId: string,
  versionId: string,
  expectedRevision: number,
  session: StudyTrailSession,
) {
  return invokeTrail('save_study_trail_session', { planId, versionId, expectedRevision, session });
}

export async function getStudyAttemptSources(attemptId: string): Promise<StudySourceResolution[]> {
  try {
    return await invokeCommand<StudySourceResolution[]>('get_study_attempt_sources', { attemptId });
  } catch (error) {
    throw normalizeStudyError(error);
  }
}

export interface StudyReadingChunk {
  chunkId: string;
  text: string;
  position: ChunkLocation;
}

export function getStudyReadingChunks(planId: string, versionId: string): Promise<StudyReadingChunk[]> {
  return invokeCommand('get_study_reading_chunks', { planId, versionId });
}
