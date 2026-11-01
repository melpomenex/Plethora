/**
 * Video Extracts Components
 *
 * Components for creating, viewing, and managing video extracts
 * - timestamp-linked segments from videos for spaced repetition
 */

import { useState, useEffect, useMemo } from 'react';
import {
  BookOpen,
  Calendar,
  CheckCircle,
  Clock,
  Pencil,
  Play,
  Scissors,
  Tag as TagIcon,
  Trash,
  Warning,
  X,
} from "@phosphor-icons/react";
import {
  type VideoExtract,
  type CreateVideoExtractInput,
  formatSeconds,
  formatTimeRange,
  getTranscriptPreview,
  getRatingLabel,
} from '../../api/video-extracts';
import { useAllVideoExtracts, useCreateVideoExtract, useDeleteVideoExtract, useSetVideoExtractQueueMembership, useVideoExtractReviewCandidates } from '../../hooks/useVideoExtracts';
import { useVideoExtractReview } from '../../hooks/useVideoExtractReview';
import { useDocumentStore } from '../../stores/documentStore';
import {
  isVideoExtractFutureScheduled,
  videoExtractLifecycleKind,
  videoExtractQueueKind,
} from '../../lib/videoExtractLifecycle';
import { useToast } from '../common/Toast';
import { useI18n } from '../../lib/i18n';
import { useVideoExtractList } from '../../hooks/useVideoExtractList';
import { useDueVideoReview } from '../../hooks/useDueVideoReview';
import { useSettingsStore } from '../../stores/settingsStore';

interface CreateVideoExtractDialogProps {
  documentId: string;
  documentTitle: string;
  isOpen: boolean;
  initialStartTime?: number;
  initialEndTime?: number;
  initialTranscriptText?: string;
  onClose: () => void;
  onCreate?: (extract: VideoExtract) => void;
}

export function CreateVideoExtractDialog({
  documentId,
  documentTitle,
  isOpen,
  initialStartTime = 0,
  initialEndTime = 0,
  initialTranscriptText = '',
  onClose,
  onCreate,
}: CreateVideoExtractDialogProps) {
  const [startTime, setStartTime] = useState(initialStartTime);
  const [endTime, setEndTime] = useState(initialEndTime || initialStartTime + 60);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [transcriptText, setTranscriptText] = useState(initialTranscriptText);
  const [addToQueue, setAddToQueue] = useState(true);
  const [initialReviewDate, setInitialReviewDate] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const createExtract = useCreateVideoExtract();
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { t } = useI18n();

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setStartTime(initialStartTime);
      setEndTime(initialEndTime || initialStartTime + 60);
      setTitle('');
      setNotes('');
      setTags([]);
      setTagInput('');
      setTranscriptText(initialTranscriptText);
      setAddToQueue(true);
      setInitialReviewDate(new Date().toISOString().slice(0, 10));
      setError(null);
    }
  }, [isOpen, initialStartTime, initialEndTime, initialTranscriptText]);

  const handleAddTag = () => {
    const trimmed = tagInput.trim();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
      setTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleCreate = async () => {
    if (startTime < 0) {
      setError(t('videoExtract.startTimeNegative'));
      return;
    }
    if (endTime <= startTime) {
      setError(t('videoExtract.endTimeAfterStart'));
      return;
    }
    const duration = endTime - startTime;
    if (duration > 600) {
      setError(t('videoExtract.exceedsLimit'));
      return;
    }
    if (!title.trim()) {
      setError(t('videoExtract.titleRequiredError'));
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const today = new Date().toISOString().slice(0, 10);
      if (addToQueue && initialReviewDate && initialReviewDate < today) {
        setError(t('videoExtract.reviewDatePast'));
        return;
      }
      const input: CreateVideoExtractInput = {
        document_id: documentId,
        start_time: startTime,
        end_time: endTime,
        title: title.trim(),
        transcript_text: transcriptText.trim() || undefined,
        notes: notes.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        add_to_queue: addToQueue,
        initial_review_date:
          addToQueue && initialReviewDate && initialReviewDate !== today
            ? `${initialReviewDate}T00:00:00.000Z`
            : undefined,
      };

      const extract = await createExtract.mutateAsync(input);
      toast.success(t('videoExtract.created'));
      onCreate?.(extract);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('videoExtract.failedCreate'));
    } finally {
      setIsCreating(false);
    }
  };

  if (!isOpen) return null;

  const duration = endTime - startTime;
  const isLong = duration > 300;
  const isTooLong = duration > 600;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Scissors className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">
              {t("videoExtract.createVideoExtract")}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-muted rounded transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Document Context */}
        <div className="px-4 py-2 bg-muted/30 border-b border-border flex items-center gap-3">
          <BookOpen className="w-4 h-4 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{documentTitle}</div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Time Range */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t('videoExtract.timeRange')}
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="extract-start-time" className="block text-xs text-muted-foreground mb-1">
                  {t('videoExtract.startTime')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="extract-start-time"
                    type="number"
                    value={startTime}
                    onChange={(e) => setStartTime(Number(e.target.value))}
                    min={0}
                    step={1}
                    className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <span className="text-sm text-muted-foreground font-mono">
                    {formatSeconds(startTime)}
                  </span>
                </div>
              </div>
              <div>
                <label htmlFor="extract-end-time" className="block text-xs text-muted-foreground mb-1">
                  {t('videoExtract.endTime')}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="extract-end-time"
                    type="number"
                    value={endTime}
                    onChange={(e) => setEndTime(Number(e.target.value))}
                    min={0}
                    step={1}
                    className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <span className="text-sm text-muted-foreground font-mono">
                    {formatSeconds(endTime)}
                  </span>
                </div>
              </div>
            </div>

            {/* Duration Warning */}
            {duration > 0 && (
              <div className={`mt-2 flex items-center gap-2 text-sm ${
                isTooLong ? 'text-destructive' : isLong ? 'text-amber-600' : 'text-muted-foreground'
              }`}>
                {isTooLong ? (
                  <Warning className="w-4 h-4" />
                ) : isLong ? (
                  <Clock className="w-4 h-4" />
                ) : (
                  <CheckCircle className="w-4 h-4" />
                )}
                <span>
                  {t('videoExtract.duration', { duration: formatSeconds(duration) })}
                  {isTooLong && t('videoExtract.exceedsLimitWarn')}
                  {isLong && !isTooLong && t('videoExtract.longerThanRecommended')}
                  {!isLong && t('videoExtract.goodLength')}
                </span>
              </div>
            )}
          </div>

          {/* Title */}
          <div>
            <label htmlFor="extract-title" className="block text-sm font-medium text-foreground mb-2">
              {t('common.title')} <span className="text-destructive">*</span>
            </label>
            <input
              id="extract-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('videoExtract.titlePlaceholder')}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Transcript Text */}
          {transcriptText && (
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                {t('videoExtract.transcript')}
              </label>
              <div className="w-full px-3 py-2 bg-muted/50 border border-border rounded-md text-foreground text-sm max-h-32 overflow-y-auto">
                {transcriptText}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label htmlFor="extract-notes" className="block text-sm font-medium text-foreground mb-2">
              {t('videoExtract.notes')}
            </label>
            <textarea
              id="extract-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('videoExtract.notesPlaceholder')}
              rows={3}
              className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              <TagIcon className="w-4 h-4 inline mr-1" />
              {t('videoExtract.tags')}
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary rounded-md text-sm"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-destructive"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                id="extract-tag-input"
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t('videoExtract.addTag')}
                className="flex-1 px-3 py-2 bg-background border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <button
                onClick={handleAddTag}
                className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-md transition-colors"
              >
                {t('videoExtract.addBtn')}
              </button>
            </div>
          </div>

          {/* Add to Queue */}
          <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
            <input
              type="checkbox"
              id="addToQueue"
              checked={addToQueue}
              onChange={(e) => setAddToQueue(e.target.checked)}
              className="w-4 h-4 rounded border-border"
            />
            <label htmlFor="addToQueue" className="flex-1 text-sm text-foreground cursor-pointer">
              <div className="font-medium">{t('videoExtract.addToQueue')}</div>
              <div className="text-xs text-muted-foreground">
                {t('videoExtract.addToQueueDesc')}
              </div>
            </label>
          </div>

          {addToQueue && (
            <div>
              <label htmlFor="extract-review-date" className="block text-sm font-medium text-foreground mb-2">
                {t('videoExtract.startReviewingOn')}
              </label>
              <input
                id="extract-review-date"
                type="date"
                value={initialReviewDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setInitialReviewDate(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-md text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {t('videoExtract.startReviewingOnDesc')}
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive text-destructive rounded-md text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-border">
          <button
            onClick={onClose}
            disabled={isCreating}
            className="px-4 py-2 bg-card border border-border text-foreground rounded-md hover:bg-muted transition-colors disabled:opacity-50"
          >
            {t('videoExtract.cancel')}
          </button>
          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-2"
          >
            {isCreating ? (
              <>
                <span className="animate-spin">⏳</span>
                {t('videoExtract.creating')}
              </>
            ) : (
              <>
                <Scissors className="w-4 h-4" />
                {t('videoExtract.createExtractBtn')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

interface VideoExtractsListProps {
  documentId: string;
  onPlayExtract?: (extract: VideoExtract) => void;
  onEditExtract?: (extract: VideoExtract) => void;
  className?: string;
}

export function VideoExtractsList({
  documentId,
  onPlayExtract,
  onEditExtract,
  className = '',
}: VideoExtractsListProps) {
  const {
    extracts, loading, error, refresh, rate, remove, setQueued, reviewNow,
    isRating, isQueueUpdating, retryRating,
  } = useVideoExtractList(documentId);
  const candidatesQuery = useVideoExtractReviewCandidates(documentId);
  const learning = useSettingsStore((state) => state.settings.learning);
  const [reviewOpen, setReviewOpen] = useState(false);
  const { t } = useI18n();

  const reviewCandidates = useMemo(() => {
    const now = new Date();
    const candidates = candidatesQuery.data ?? [];
    const dueReviewed = candidates
      .filter((extract) => extract.review_count > 0 && extract.next_review_date && new Date(extract.next_review_date) <= now)
      .slice(0, Math.max(0, learning.reviewsPerDay));
    const newQueued = candidates
      .filter((extract) => extract.review_count === 0)
      .slice(0, Math.max(0, learning.newCardsPerDay));
    return [...dueReviewed, ...newQueued];
  }, [candidatesQuery.data, learning.newCardsPerDay, learning.reviewsPerDay]);

  if (loading) {
    return (
      <div className={`flex items-center justify-center py-8 ${className}`}>
        <div className="text-sm text-muted-foreground">{t('videoExtract.loadingExtracts')}</div>
      </div>
    );
  }

  if (error && extracts.length === 0) {
    return (
      <div className={`text-center py-8 ${className}`}>
        <p className="text-sm text-destructive">{error}</p>
        <button type="button" onClick={refresh} className="mt-3 rounded border border-border px-3 py-1.5 text-sm">
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (extracts.length === 0) {
    return (
      <div className={`text-center py-8 ${className}`}>
        <Scissors className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
        <p className="text-sm text-foreground-secondary">
          {t('videoExtract.noVideoExtracts')}
        </p>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${className}`}>
      {reviewCandidates.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2">
          <span className="text-sm text-foreground">
            {t('videoExtract.reviewReady', { count: reviewCandidates.length })}
          </span>
          <button
            type="button"
            onClick={() => setReviewOpen((open) => !open)}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          >
            {reviewOpen ? t('common.close') : t('videoExtract.reviewNow')}
          </button>
        </div>
      )}

      {reviewOpen && reviewCandidates.length > 0 && (
        <DueVideoExtractsReview
          extracts={reviewCandidates}
          onPlayExtract={onPlayExtract}
          onComplete={() => {
            setReviewOpen(false);
            void candidatesQuery.refetch();
          }}
        />
      )}

      {extracts.map((extract) => (
        <VideoExtractCard
          key={extract.id}
          extract={extract}
          sourceTitle={extract.document_title}
          onPlay={onPlayExtract}
          onEdit={onEditExtract}
          onDelete={remove}
          onToggleQueue={(id, queued) => void setQueued(id, queued)}
          onReviewNow={(id) => void reviewNow(id)}
          isQueueUpdating={isQueueUpdating}
          showRating
          onRate={rate}
          isRating={isRating(extract.id)}
          retryRating={retryRating(extract.id)}
        />
      ))}
    </div>
  );
}

interface VideoExtractLibraryListProps {
  collectionId?: string;
  onPlayExtract?: (extract: VideoExtract) => void;
  className?: string;
}

/** Library-wide video extracts grouped by their source video. */
export function VideoExtractLibraryList({
  collectionId,
  onPlayExtract,
  className = '',
}: VideoExtractLibraryListProps) {
  const query = useAllVideoExtracts(collectionId);
  const deleteMutation = useDeleteVideoExtract();
  const membership = useSetVideoExtractQueueMembership();
  const review = useVideoExtractReview();
  const documents = useDocumentStore((state) => state.documents);
  const { t } = useI18n();
  const toast = useToast();

  const groups = useMemo(() => {
    const byDocument = new Map<string, VideoExtract[]>();
    for (const extract of query.data ?? []) {
      const list = byDocument.get(extract.document_id) ?? [];
      list.push(extract);
      byDocument.set(extract.document_id, list);
    }
    return [...byDocument.entries()].map(([documentId, extracts]) => {
      const doc = documents.find((candidate) => candidate.id === documentId);
      return {
        documentId,
        title: doc?.title ?? t('videoExtract.unknownSource'),
        archived: Boolean(doc?.isArchived || doc?.isDismissed),
        extracts,
      };
    });
  }, [documents, query.data, t]);

  if (query.isLoading) {
    return <div className={`py-6 text-sm text-muted-foreground ${className}`}>{t('videoExtract.loadingExtracts')}</div>;
  }
  if (query.error) {
    return (
      <div className={`py-6 text-sm text-destructive ${className}`}>
        {query.error instanceof Error ? query.error.message : t('videoExtract.failedLoad')}
        <button type="button" className="ml-3 underline" onClick={() => void query.refetch()}>{t('common.retry')}</button>
      </div>
    );
  }
  if (groups.length === 0) {
    return (
      <div className={`py-6 text-center text-sm text-muted-foreground ${className}`}>
        {t('videoExtract.noLibraryExtracts')}
      </div>
    );
  }

  return (
    <div className={`space-y-5 ${className}`}>
      {groups.map((group) => (
        <section key={group.documentId} className="space-y-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{group.title}</span>
            {group.archived && <span className="text-xs font-normal text-muted-foreground">({t('videoExtract.archivedSource')})</span>}
          </h3>
          {group.extracts.map((extract) => (
            <VideoExtractCard
              key={extract.id}
              extract={extract}
              sourceTitle={group.title}
              onPlay={group.archived ? undefined : onPlayExtract}
              onDelete={async (id) => {
                if (!confirm(t('delete.deleteExtractConfirm'))) return;
                try {
                  await deleteMutation.mutateAsync(id);
                  toast.success(t('videoExtract.deleted'));
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : t('videoExtract.failedDelete'));
                }
              }}
              onToggleQueue={group.archived ? undefined : (id, queued) => {
                void membership.mutateAsync({ extractId: id, queued }).catch((error) => {
                  toast.error(error instanceof Error ? error.message : t('videoExtract.failedQueueUpdate'));
                });
              }}
              onReviewNow={group.archived ? undefined : (id) => {
                void membership.mutateAsync({ extractId: id, queued: true, initialReviewDate: new Date().toISOString() }).catch((error) => {
                  toast.error(error instanceof Error ? error.message : t('videoExtract.failedQueueUpdate'));
                });
              }}
              isQueueUpdating={membership.isPending}
              showRating={!group.archived}
              onRate={async (id, rating) => {
                try { await review.rate(id, rating); }
                catch (error) { toast.error(error instanceof Error ? error.message : t('videoExtract.failedRate')); }
              }}
              isRating={review.isRating(extract.id)}
              retryRating={review.retryRating(extract.id)}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

interface VideoExtractCardProps {
  extract: VideoExtract;
  sourceTitle?: string;
  onPlay?: (extract: VideoExtract) => void;
  onEdit?: (extract: VideoExtract) => void;
  onDelete?: (extractId: string) => void;
  onRate?: (extractId: string, rating: number) => void;
  onToggleQueue?: (extractId: string, queued: boolean) => void;
  onReviewNow?: (extractId: string) => void;
  showRating?: boolean;
  isRating?: boolean;
  isQueueUpdating?: boolean;
  retryRating?: number;
}

export function VideoExtractCard({
  extract,
  sourceTitle,
  onPlay,
  onEdit,
  onDelete,
  onRate,
  onToggleQueue,
  onReviewNow,
  showRating = false,
  isRating = false,
  isQueueUpdating = false,
  retryRating,
}: VideoExtractCardProps) {
  const { t } = useI18n();

  const duration = extract.end_time - extract.start_time;
  const isDue = extract.queue_status === "queued" && extract.next_review_date
    ? new Date(extract.next_review_date) <= new Date()
    : false;
  const futureScheduled = isVideoExtractFutureScheduled(extract);

  return (
    <div
      className={`p-3 bg-card border border-border rounded-lg hover:border-primary/50 transition-colors group ${
        isDue ? 'ring-1 ring-primary' : ''
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <button
          onClick={() => onPlay?.(extract)}
          className="flex-1 text-left"
        >
          <h4 className="text-sm font-medium text-foreground hover:text-primary transition-colors">
            {extract.title}
          </h4>
        </button>
        <div className="flex items-center gap-1">
          {onEdit && (
            <button
              onClick={() => onEdit(extract)}
              disabled={isRating}
              className="p-1 hover:bg-muted rounded transition-colors"
              title={t('videoExtract.editExtract')}
            >
              <Pencil className="w-3 h-3 text-muted-foreground" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(extract.id)}
              disabled={isRating}
              className="p-1 hover:bg-red-100 dark:hover:bg-red-900 rounded transition-colors"
              title={t('videoExtract.deleteExtract')}
            >
              <Trash className="w-3 h-3 text-red-500" />
            </button>
          )}
        </div>
      </div>

      {/* Time Range */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={() => onPlay?.(extract)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <Play className="w-3 h-3" />
          <span className="font-mono">{formatTimeRange(extract)}</span>
          <span>({formatSeconds(duration)})</span>
        </button>
        {extract.queue_status === "queued" && extract.next_review_date && (
          <div className={`flex items-center gap-1 text-xs ${
            isDue ? 'text-primary' : 'text-muted-foreground'
          }`}>
            <Calendar className="w-3 h-3" />
            <span>
              {isDue
                ? t('videoExtract.dueNow')
                : t('videoExtract.due', {
                    date: new Date(extract.next_review_date).toLocaleDateString(),
                  })}
            </span>
          </div>
        )}
      </div>

      {sourceTitle && (
        <div className="mb-2 text-xs text-muted-foreground">
          {t('videoExtract.source')}: {sourceTitle}
        </div>
      )}

      {/* Transcript Preview */}
      {extract.transcript_text && (
        <p className="text-xs text-muted-foreground mb-2 line-clamp-2">
          {getTranscriptPreview(extract, 150)}
        </p>
      )}

      {/* Tags — video extracts live in a separate video_extracts table (like
          RSS), so they are read-only from the shared item-tag editor's view */}
      {extract.tags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {extract.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 bg-primary/10 text-primary text-xs rounded"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <VideoExtractStatus extract={extract} />

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        {onToggleQueue && (
          <button
            type="button"
            disabled={isQueueUpdating || isRating}
            onClick={() => onToggleQueue(extract.id, extract.queue_status !== "queued")}
            className="rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
          >
            {extract.queue_status === "queued" ? t('videoExtract.removeFromQueue') : t('videoExtract.addToQueueShort')}
          </button>
        )}
        {futureScheduled && onReviewNow && (
          <button
            type="button"
            disabled={isQueueUpdating || isRating}
            onClick={() => onReviewNow(extract.id)}
            className="rounded border border-border px-2 py-0.5 text-xs text-foreground hover:bg-muted disabled:opacity-50"
          >
            {t('videoExtract.reviewNow')}
          </button>
        )}
      </div>

      {/* Review Stats */}
      {extract.review_count > 0 && (
        <div className="text-xs text-muted-foreground">
          {t('videoExtract.reviewedTimes', { count: extract.review_count })}
        </div>
      )}

      {/* Rating Buttons */}
      {showRating && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
          <span className="text-xs text-muted-foreground">{t('videoExtract.rateExtract')}</span>
          {[1, 2, 3, 4].map((r) => (
            <button
              key={r}
              onClick={() => onRate?.(extract.id, r)}
              disabled={isRating || !onRate || (retryRating !== undefined && retryRating !== r)}
              className="px-2 py-1 text-xs rounded transition-colors bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-50"
              title={getRatingLabel(r)}
            >
              {getRatingLabel(r)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VideoExtractStatus({ extract }: { extract: VideoExtract }) {
  const { t } = useI18n();
  const lifecycle = videoExtractLifecycleKind(extract);
  const queue = videoExtractQueueKind(extract);
  const lifecycleLabel = lifecycle === 'reviewed'
    ? t('videoExtract.statusReviewed')
    : lifecycle === 'seen_unreviewed'
      ? `${t('videoExtract.statusSeen')} · ${t('videoExtract.statusNotReviewed')}`
      : `${t('videoExtract.statusNew')} · ${t('videoExtract.statusNotReviewed')}`;
  const queueLabel = queue === 'not_queued'
    ? t('videoExtract.notInQueue')
    : queue === 'queued_scheduled'
      ? t('videoExtract.inQueueScheduled')
      : queue === 'needs_schedule'
        ? t('videoExtract.needsSchedule')
        : queue === 'queued_due'
          ? t('videoExtract.inQueueDue')
          : t('videoExtract.inQueueNew');
  return <div className="flex flex-wrap gap-2 text-xs text-muted-foreground" aria-live="polite"><span>{lifecycleLabel}</span><span>·</span><span>{queueLabel}</span></div>;
}

interface DueVideoExtractsReviewProps {
  extracts: VideoExtract[];
  onComplete?: () => void;
  onPlayExtract?: (extract: VideoExtract) => void;
  className?: string;
}

export function DueVideoExtractsReview({
  extracts,
  onComplete,
  onPlayExtract,
  className = '',
}: DueVideoExtractsReviewProps) {
  const { currentIndex, isRating, rate, retryRating } = useDueVideoReview(extracts, onComplete);
  const { t } = useI18n();

  if (currentIndex >= extracts.length) {
    return (
      <div className={`text-center py-8 ${className}`}>
        <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
        <p className="text-sm text-foreground-secondary">
          {t('videoExtract.noDueExtracts')}
        </p>
      </div>
    );
  }

  const current = extracts[currentIndex];
  const progress = ((currentIndex + 1) / extracts.length) * 100;

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Progress Bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm text-muted-foreground">
          {currentIndex + 1} / {extracts.length}
        </span>
      </div>

      {/* Current Extract */}
      {current && (
        <div className="p-4 bg-card border border-border rounded-lg">
          <VideoExtractCard
            extract={current}
            onPlay={onPlayExtract}
            showRating
            isRating={isRating}
            onRate={rate}
            retryRating={retryRating(current.id)}
          />
        </div>
      )}
    </div>
  );
}

export { formatSeconds, formatTimeRange };
