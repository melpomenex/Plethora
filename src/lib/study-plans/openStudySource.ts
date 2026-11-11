/**
 * Canonical Study Source Navigation Adapter.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §5.1
 * - openspec/changes/establish-persistent-study-plans/
 *
 * Behavior:
 * 1. Rehydrates/resolves stored study source ref; never treats chunk id as durable.
 * 2. PDF uses page + quote/hint; EPUB uses CFI/range + quote; HTML/Markdown re-resolves quote;
 *    YouTube/audio use seconds/segment.
 * 3. Local video with extractId opens DocumentViewer with focusedVideoExtractId, not generic initialJump.
 * 4. Returns explicit outcome { success, navigation } or { success: false, reason, message }.
 * 5. Refuses when running on an unsupported platform (non-Tauri/browser).
 */

import { createElement } from 'react';
import { Scissors } from '@phosphor-icons/react';
import { isTauri } from '../tauri';
import { getDocument } from '../../api/documents';
import { useDocumentStore } from '../../stores/documentStore';
import { useTabsStore } from '../../stores/tabsStore';
import { DocumentViewer } from '../../components/tabs/TabRegistry';
import { openDocumentAtLocation } from '../../utils/openDocumentAtLocation';
import type { StudySourceRefV1, StudySourceResolution } from '../../types/studySource';

export type StudySourceNavigationQuality = 'exact' | 'coarse' | 'unavailable';

export type OpenStudySourceFailureReason =
  | 'missing'
  | 'stale'
  | 'ambiguous'
  | 'unsupported'
  | 'unsupported_platform';

export type OpenStudySourceOutcome =
  | { success: true; navigation: 'exact' | 'coarse' }
  | {
      success: false;
      reason: OpenStudySourceFailureReason;
      message: string;
    };

export interface OpenStudySourceOptions {
  allowCoarseNavigationOnStale?: boolean;
  returnContext?: {
    originPlanId?: string;
    originTabId?: string;
  };
}

/**
 * Open the source cited in a study plan or assessment.
 */
export async function openStudySource(
  input: StudySourceRefV1 | StudySourceResolution,
  options?: OpenStudySourceOptions
): Promise<OpenStudySourceOutcome> {
  if (!isTauri()) {
    return {
      success: false,
      reason: 'unsupported_platform',
      message: 'Study Plans navigation requires native application support',
    };
  }

  const ref: StudySourceRefV1 = 'ref' in input ? input.ref : input;
  const inputStatus = 'status' in input ? input.status : undefined;

  if (inputStatus === 'missing') {
    return { success: false, reason: 'missing', message: 'The saved source is unavailable.' };
  }

  if (inputStatus === 'unsupported') {
    return {
      success: false,
      reason: 'unsupported',
      message: 'Unsupported source type for navigation',
    };
  }

  if (inputStatus === 'ambiguous') {
    return {
      success: false,
      reason: 'ambiguous',
      message: 'Multiple matching locations found for source excerpt',
    };
  }

  // Fetch document
  let doc = useDocumentStore.getState().documents.find((d) => d.id === ref.documentId);
  if (!doc) {
    try {
      doc = (await getDocument(ref.documentId)) ?? undefined;
    } catch {
      return {
        success: false,
        reason: 'missing',
        message: 'Source document could not be found',
      };
    }
  }

  if (!doc) {
    return {
      success: false,
      reason: 'missing',
      message: 'Source document could not be found',
    };
  }

  const currentRevision = doc.contentHash || doc.dateModified;
  const isStale =
    inputStatus === 'stale' ||
    Boolean(ref.revision && currentRevision && ref.revision !== currentRevision);

  if (isStale && !options?.allowCoarseNavigationOnStale) {
    return {
      success: false,
      reason: 'stale',
      message: 'Source document revision has changed since capture',
    };
  }

  // Handle local video specifically (UX §5.1 item 3)
  const isVideo = doc.fileType === 'video' || ref.sourceType === 'video';
  if (isVideo && ref.extractId && !isStale) {
    useTabsStore.getState().addTab({
      title: doc.title || ref.documentTitle || 'Video',
      icon: createElement(Scissors, { className: 'w-4 h-4 text-muted-foreground' }),
      type: 'document-viewer',
      content: DocumentViewer,
      closable: true,
      data: {
        documentId: doc.id,
        focusedVideoExtractId: ref.extractId,
        hideRatingOrbs: true,
        ...(options?.returnContext
          ? {
              originPlanId: options.returnContext.originPlanId,
              originTabId: options.returnContext.originTabId,
            }
          : {}),
      },
    });

    return {
      success: true,
      navigation: isStale ? 'coarse' : 'exact',
    };
  }

  const jump = isStale || ('navigation' in input && input.navigation !== 'exact') ? undefined : ref.jump;
  const opened = await openDocumentAtLocation(
    doc.id,
    {
      initialJump: jump,
      highlightQuery: isStale ? undefined : ref.excerpt,
    },
    useTabsStore.getState().addTab,
    options?.returnContext
      ? {
          reviewReturn: true,
          originTabId: options.returnContext.originTabId,
        }
      : undefined
  );

  if (!opened) {
    return {
      success: false,
      reason: 'missing',
      message: 'Could not open document viewer for source',
    };
  }

  return {
    success: true,
    navigation: jump ? 'exact' : 'coarse',
  };
}
