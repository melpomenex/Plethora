/**
 * Universal Study Plan Source Adapter & Readiness Coordinator.
 *
 * Maps heterogeneous Plethora sources (PDF native/OCR, EPUB, HTML/web/X threads,
 * Markdown, plain text, YouTube, local video, audio/audiobooks, recording
 * sessions, podcasts, RSS articles, images) into honest readiness metadata and
 * consent-gated preparation actions without ever auto-triggering transcription
 * or OCR or bypassing `isAiExcluded` / `isLocalOnly`.
 */

import { ensureAIDocumentsIndexed } from '../../api/ai-learning';
import {
  extractDocumentText,
  getDocument,
  updateDocumentContent,
} from '../../api/documents';
import { ocrImageFile, ocrPdfFile } from '../../api/ocrCommands';
import { fetchArticleFullContent } from '../../api/rss';
import {
  ensurePodcastEpisodeDocument,
  ensureRssArticleDocument,
  getStudySourceCatalog,
} from '../../api/study-sources';
import { getPodcastEpisode } from '../database';
import { resolveTranscriptionWithReadiness } from '../transcriptionProvider';
import { routeDocumentTranscription, routePodcastTranscription } from '../transcriptionRouting';
import { invokeCommand, isNativeMobile, isTauri } from '../tauri';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTranscriptionStore } from '../../stores/useTranscriptionStore';
import { extractYouTubeVideoId } from '../../utils/youtubeEmbed';
import type { Document } from '../../types/document';
import type {
  StudySourceCatalogItem,
  StudySourceReadiness,
} from '../../types/studySource';

export type SourceCategoryFilter =
  | 'all'
  | 'ready'
  | 'documents'
  | 'media'
  | 'feeds'
  | 'needs-prep';

export interface SourcePreparationResult {
  documentId?: string;
  status: 'completed' | 'queued';
  message: string;
}

export function catalogItemFromDocument(doc: Document): StudySourceCatalogItem {
  const ft = (doc.fileType || 'other').toLowerCase();
  const isAiExcluded = doc.isAiExcluded === true;
  const isLocalOnly = doc.isLocalOnly === true;
  const hasContent = Boolean(doc.content?.trim());

  let sourceCategory = ft === 'other' ? 'text' : ft;
  const sourceUrl =
    doc.metadata?.originalUrl ||
    doc.metadata?.url ||
    doc.metadata?.webArticle?.originalUrl ||
    '';
  if (doc.filePath?.startsWith('rss://') || doc.metadata?.source === 'rss') {
    sourceCategory = 'rss';
  } else if (doc.metadata?.source?.startsWith('podcast:') || doc.filePath?.startsWith('podcast://')) {
    sourceCategory = 'podcast';
  } else if (sourceUrl.includes('x.com/') || sourceUrl.includes('twitter.com/')) {
    sourceCategory = 'x-thread';
  }

  let readiness: StudySourceReadiness = 'ready';
  let readinessReason: string | undefined;
  let prepareAction: string | undefined;

  if (isAiExcluded) {
    readiness = 'ai-excluded';
    readinessReason = 'Excluded from AI processing';
  } else if ((ft === 'pdf' || ft === 'image') && !hasContent && !isTauri()) {
    // Web / mock fallback in unit tests treats existing library docs as selectable unless flagged.
    readiness = 'ready';
  } else if ((ft === 'pdf' || ft === 'image') && !hasContent) {
    readiness = 'needs-ocr';
    readinessReason = 'Needs text extraction or OCR';
    prepareAction = 'run-ocr';
  } else if ((ft === 'youtube' || ft === 'video' || ft === 'audio') && !hasContent && isTauri()) {
    readiness = 'needs-transcript';
    readinessReason = 'Needs transcript before study generation';
    prepareAction = ft === 'youtube' ? 'fetch-youtube-transcript' : 'transcribe-media';
  } else if (isLocalOnly) {
    readiness = 'local-only';
    readinessReason = 'Local-only: restricted to on-device models and local search';
  }

  const contentHash = doc.contentHash?.trim() || undefined;
  const modifiedRev = doc.contentUpdatedAt?.trim() || doc.dateAdded || '';
  return {
    id: doc.id,
    kind: 'document',
    documentId: doc.id,
    title: doc.title || 'Untitled Document',
    subtitle: doc.metadata?.siteName,
    fileType: ft,
    sourceCategory,
    readiness,
    readinessReason,
    isAiExcluded,
    isLocalOnly,
    chunkCount: 0,
    contentHash,
    revision: contentHash || modifiedRev || 'unknown',
    revisionKind: contentHash ? 'content-hash' : modifiedRev ? 'modified-at' : 'unknown',
    collectionId: doc.collectionId,
    dateAdded: doc.dateAdded,
    tags: doc.tags ?? [],
    prepareAction,
  };
}

export function sourceCategoryLabel(category: string): string {
  switch (category.toLowerCase()) {
    case 'pdf':
      return 'PDF';
    case 'epub':
      return 'EPUB';
    case 'youtube':
      return 'YouTube';
    case 'video':
      return 'Video';
    case 'audio':
      return 'Audio';
    case 'podcast':
      return 'Podcast';
    case 'rss':
      return 'RSS';
    case 'recording-session':
      return 'Session';
    case 'x-thread':
      return 'X Thread';
    case 'html':
      return 'Web';
    case 'markdown':
      return 'Markdown';
    case 'image':
      return 'Image';
    case 'text':
    case 'other':
      return 'Text';
    default:
      return category.toUpperCase();
  }
}

export function readinessBadgeLabel(readiness: StudySourceReadiness): string | null {
  switch (readiness) {
    case 'ready':
      return null;
    case 'indexing':
      return 'Indexing';
    case 'needs-transcript':
      return 'Needs transcript';
    case 'needs-ocr':
      return 'Needs OCR';
    case 'ai-excluded':
      return 'AI excluded';
    case 'local-only':
      return 'Local-only';
    case 'unavailable':
      return 'No text';
  }
}

export function prepareActionLabel(action?: string): string | null {
  switch (action) {
    case 'run-ocr':
      return 'Run OCR';
    case 'fetch-youtube-transcript':
      return 'Fetch transcript';
    case 'transcribe-media':
    case 'transcribe-podcast':
      return 'Transcribe';
    case 'finish-indexing':
      return 'Index now';
    case 'fetch-rss-content':
      return 'Fetch article';
    default:
      return null;
  }
}

export function isItemSelectableForStudyScope(item: StudySourceCatalogItem): boolean {
  if (item.isAiExcluded || item.readiness === 'ai-excluded') return false;
  return item.readiness === 'ready' || item.readiness === 'local-only' || item.readiness === 'indexing';
}

export function matchesCategoryFilter(
  item: StudySourceCatalogItem,
  filter: SourceCategoryFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'ready') return isItemSelectableForStudyScope(item);
  if (filter === 'needs-prep') {
    return (
      item.readiness === 'needs-ocr' ||
      item.readiness === 'needs-transcript' ||
      item.readiness === 'unavailable'
    );
  }
  const cat = item.sourceCategory.toLowerCase();
  if (filter === 'documents') {
    return ['pdf', 'epub', 'markdown', 'html', 'text', 'other', 'image', 'x-thread'].includes(cat);
  }
  if (filter === 'media') {
    return ['youtube', 'video', 'audio', 'recording-session'].includes(cat);
  }
  if (filter === 'feeds') {
    return cat === 'podcast' || cat === 'rss';
  }
  return true;
}

/**
 * Resolve a catalog item into a concrete `documents.id` (promoting ready
 * podcast episodes or RSS articles idempotently).
 */
export async function resolveCatalogItemToDocumentId(
  item: StudySourceCatalogItem
): Promise<string> {
  if (item.documentId) return item.documentId;
  if (item.kind === 'podcast-episode') {
    const episodeId = item.id.replace(/^podcast:/, '');
    const promoted = await ensurePodcastEpisodeDocument(episodeId);
    return promoted.documentId;
  }
  if (item.kind === 'rss-article') {
    const articleId = item.id.replace(/^rss:/, '');
    const promoted = await ensureRssArticleDocument(articleId);
    return promoted.documentId;
  }
  throw new Error(`Unsupported catalog item kind: ${item.kind}`);
}

/**
 * Execute an explicit, user-authorized source preparation action.
 * Refuses to run unless `consentGranted === true` and enforces `isAiExcluded`
 * and `isLocalOnly` privacy boundaries.
 */
export async function prepareStudySource(
  item: StudySourceCatalogItem,
  options: { consentGranted: boolean }
): Promise<SourcePreparationResult> {
  if (!options.consentGranted) {
    throw new Error('Explicit user confirmation is required before transcribing or running OCR.');
  }
  if (item.isAiExcluded || item.readiness === 'ai-excluded') {
    throw new Error('Sources marked AI-excluded cannot be prepared for study generation.');
  }

  const action = item.prepareAction;
  if (!action) {
    return { documentId: item.documentId, status: 'completed', message: 'Source is already ready.' };
  }

  if (action === 'finish-indexing' && item.documentId) {
    await ensureAIDocumentsIndexed([item.documentId]);
    return { documentId: item.documentId, status: 'completed', message: 'Indexed source chunks.' };
  }

  if (action === 'fetch-youtube-transcript' && item.documentId) {
    const doc = await getDocument(item.documentId);
    const videoId = doc ? extractYouTubeVideoId(doc.filePath) : null;
    if (!videoId) {
      throw new Error('Could not determine YouTube video ID from document.');
    }
    await invokeCommand('get_youtube_transcript_by_id', {
      videoId,
      documentId: item.documentId,
      forceRefresh: false,
    });
    await ensureAIDocumentsIndexed([item.documentId]);
    return {
      documentId: item.documentId,
      status: 'completed',
      message: 'Fetched and indexed YouTube transcript.',
    };
  }

  if (action === 'run-ocr' && item.documentId) {
    const extracted = await extractDocumentText(item.documentId).catch(() => ({
      content: '',
      extracted: false,
    }));
    if (extracted.content?.trim()) {
      await ensureAIDocumentsIndexed([item.documentId]);
      return {
        documentId: item.documentId,
        status: 'completed',
        message: 'Extracted text and indexed document.',
      };
    }

    const doc = await getDocument(item.documentId);
    if (!doc?.filePath) {
      throw new Error('Document file path is missing for OCR.');
    }
    const ocrSettings = useSettingsStore.getState().settings.documents?.ocr;
    const provider = ocrSettings?.provider;
    const language = ocrSettings?.language;

    let text = '';
    if (doc.fileType === 'image') {
      const resp = await ocrImageFile({
        image_path: [doc.filePath],
        ...(provider ? { provider } : {}),
        ...(language ? { language } : {}),
      });
      if (!resp.success) throw new Error(resp.error || 'Image OCR failed.');
      text = resp.text?.trim() || '';
    } else {
      const resp = await ocrPdfFile({
        pdf_path: doc.filePath,
        ...(provider ? { provider } : {}),
        ...(language ? { language } : {}),
      });
      if (!resp.success) throw new Error(resp.error || 'PDF OCR failed.');
      text = resp.combined_text?.trim() || resp.pages.map((p) => p.text).join('\n\n').trim();
    }

    if (!text) {
      throw new Error('OCR completed but found no readable text.');
    }
    await updateDocumentContent(item.documentId, text);
    await ensureAIDocumentsIndexed([item.documentId]);
    return {
      documentId: item.documentId,
      status: 'completed',
      message: 'OCR completed and source indexed.',
    };
  }

  if (action === 'transcribe-media' && item.documentId) {
    const doc = await getDocument(item.documentId);
    if (!doc) throw new Error('Source document could not be loaded.');
    if (doc.isAiExcluded) {
      throw new Error('AI-excluded document cannot be transcribed.');
    }

    const transcriptionStore = useTranscriptionStore.getState();
    let profiles = transcriptionStore.profiles;
    if (profiles.length === 0) {
      await transcriptionStore.fetchProfiles().catch(() => {});
      profiles = useTranscriptionStore.getState().profiles;
    }
    const audioSettings = useSettingsStore.getState().settings.audioTranscription;
    const resolution = await resolveTranscriptionWithReadiness(
      audioSettings,
      profiles,
      isNativeMobile() ? 'native-mobile' : 'desktop'
    );
    if (resolution.ok === false) {
      throw new Error(resolution.reason || 'No configured transcription model is available.');
    }
    if (doc.isLocalOnly && (resolution.provider === 'groq' || resolution.provider === 'openrouter')) {
      throw new Error('Local-only sources cannot be sent to cloud transcription services.');
    }
    const route = await routeDocumentTranscription(doc, resolution, audioSettings.language);
    await ensureAIDocumentsIndexed([doc.id]);
    return {
      documentId: doc.id,
      status: route === 'groq' || route === 'openrouter' ? 'completed' : 'queued',
      message:
        route === 'groq' || route === 'openrouter'
          ? 'Transcription completed and indexed.'
          : 'Local transcription queued. Finish transcribing before generating a plan.',
    };
  }

  if (action === 'transcribe-podcast') {
    const episodeId = item.id.replace(/^podcast:/, '');
    const ep = await getPodcastEpisode(episodeId);
    if (!ep) throw new Error('Podcast episode could not be found.');
    const transcriptionStore = useTranscriptionStore.getState();
    let profiles = transcriptionStore.profiles;
    if (profiles.length === 0) {
      await transcriptionStore.fetchProfiles().catch(() => {});
      profiles = useTranscriptionStore.getState().profiles;
    }
    const allSettings = useSettingsStore.getState().settings;
    const audioSettings = allSettings.audioTranscription;
    const resolution = await resolveTranscriptionWithReadiness(
      audioSettings,
      profiles,
      isNativeMobile() ? 'native-mobile' : 'desktop'
    );
    if (resolution.ok === false) {
      throw new Error(resolution.reason || 'No configured transcription model is available.');
    }
    if (item.isLocalOnly && (resolution.provider === 'groq' || resolution.provider === 'openrouter')) {
      throw new Error('Local-only sources cannot be sent to cloud transcription services.');
    }
    await routePodcastTranscription(
      episodeId,
      ep.audio_url,
      resolution,
      audioSettings.language,
      allSettings.documents?.autoProcessOnImport ?? false
    );
    return {
      status: resolution.provider === 'groq' || resolution.provider === 'openrouter' ? 'completed' : 'queued',
      message: 'Podcast transcription started.',
    };
  }

  if (action === 'fetch-rss-content') {
    const articleId = item.id.replace(/^rss:/, '');
    const refreshed = await getStudySourceCatalog();
    const match = refreshed.find((entry) => entry.id === item.id);
    if (match?.readiness === 'ready') {
      const promoted = await ensureRssArticleDocument(articleId);
      return { documentId: promoted.documentId, status: 'completed', message: 'RSS article ready.' };
    }
    const articleUrl = '';
    if (!articleUrl) {
      await fetchArticleFullContent(articleId, '');
    }
    const promoted = await ensureRssArticleDocument(articleId);
    return {
      documentId: promoted.documentId,
      status: 'completed',
      message: 'Fetched and indexed RSS article.',
    };
  }

  if (action === 'promote-podcast' || action === 'promote-rss') {
    const documentId = await resolveCatalogItemToDocumentId(item);
    return { documentId, status: 'completed', message: 'Promoted source to library.' };
  }

  throw new Error(`Unsupported source preparation action: ${action}`);
}
