/**
 * Durable Study Plan Lesson view.
 *
 * A lesson is tied to a plan version + node + objective and persists the
 * current prompt, answer draft, hint position, style and turn state natively.
 * Restart restores the last committed state; library-backed lessons also mount
 * the scoped Socratic tutor (study authority + preflight enforced there), while
 * model-only lessons use a local unverified surface with no retrieval.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, SpinnerGap, Warning, Sparkle, ChatsCircle } from '@phosphor-icons/react';
import { Button } from '../../md3/Button';
import type { StudyPlanDetail } from '../../../types/learningPaths';
import type { LessonStyle } from '../../../types/studySource';
import {
  createStudyPlanLesson,
  getStudyPlanLesson,
  saveStudyPlanLessonCheckpoint,
  type StudyPlanLesson,
  type CreateStudyPlanLessonInput,
} from '../../../api/study-lessons';
import { StudyTutorHost } from '../tutoring/StudyTutorHost';
import { studyErrorMessage } from '../../../lib/study-plans/studyErrorMessage';

export interface LessonViewProps {
  planDetail: StudyPlanDetail;
  nodeId: string;
  objectiveIndex?: number;
  onClose: () => void;
  /** Hands off to an explicitly chosen independent assessment route. */
  onHandoff?: () => void;
}

const MAX_HINTS = 3;

export function scopeSnapshot(planDetail: StudyPlanDetail): string {
  const authority = planDetail.version.knowledgeAuthority;
  if (authority.kind !== 'library') return '';
  const docs = (planDetail.version.sourceScope?.resolvedDocuments ?? [])
    .map((doc) => `${doc.documentId}:${doc.revision}`)
    .sort();
  return docs.join('|');
}

export const LessonView: React.FC<LessonViewProps> = ({
  planDetail,
  nodeId,
  objectiveIndex = 0,
  onClose,
  onHandoff,
}) => {
  const node = planDetail.version.nodes.find((n) => n.nodeId === nodeId);
  const authority = planDetail.version.knowledgeAuthority;
  const isModelOnly = authority.kind === 'model-only';

  const [lesson, setLesson] = useState<StudyPlanLesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [showTutor, setShowTutor] = useState(false);
  const savingRef = useRef(false);

  const ensureLesson = useCallback(async () => {
    try {
      const input: CreateStudyPlanLessonInput = {
        planId: planDetail.plan.id,
        planVersionId: planDetail.version.id,
        nodeId,
        objectiveIndex,
        style: 'guided',
        knowledgeAuthorityJson: JSON.stringify(authority),
        sourceRevisionSnapshot: scopeSnapshot(planDetail),
        promptText: node?.title ?? nodeId,
      };
      const created = await createStudyPlanLesson(input);
      setLesson(created);
      setDraft(created.answerDraft);
    } catch (e) {
      setError(studyErrorMessage(e, 'Could not start the lesson.'));
    } finally {
      setLoading(false);
    }
  }, [planDetail, nodeId, objectiveIndex, node, authority]);

  useEffect(() => {
    void ensureLesson();
  }, [ensureLesson]);

  const checkpoint = useCallback(
    async (patch: Partial<StudyPlanLesson>, requestId: string) => {
      if (!lesson || savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      try {
        const updated = await saveStudyPlanLessonCheckpoint({
          lessonId: lesson.id,
          expectedRevision: lesson.revision,
          turnRequestId: requestId,
          style: patch.style,
          promptText: patch.promptText,
          answerDraft: patch.answerDraft ?? draft,
          hintCount: patch.hintCount,
          turnCount: patch.turnCount,
          turnStateJson: patch.turnStateJson,
        });
        setLesson(updated);
        setDraft(updated.answerDraft);
        setError(null);
      } catch (e) {
        // Stale revision: the lesson moved underneath this client. Reload once.
        try {
          const fresh = await getStudyPlanLesson(lesson.id);
          setLesson(fresh);
          setDraft(fresh.answerDraft);
          setError('Lesson state refreshed from the latest checkpoint.');
        } catch {
          setError(studyErrorMessage(e, 'Could not save the lesson checkpoint.'));
        }
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [lesson, draft]
  );

  const handleRevealHint = () => {
    if (!lesson || lesson.hintCount >= MAX_HINTS) return;
    void checkpoint({ hintCount: lesson.hintCount + 1 }, `hint_${Date.now()}`);
  };

  const handleSkip = () => {
    if (!lesson) return;
    void checkpoint({ turnCount: lesson.turnCount + 1 }, `skip_${Date.now()}`);
  };

  const handleExplain = () => {
    if (!lesson) return;
    void checkpoint(
      { turnStateJson: JSON.stringify({ ...safeTurnState(lesson), explained: true }) },
      `explain_${Date.now()}`
    );
  };

  const handleSaveDraft = () => {
    if (!lesson) return;
    void checkpoint({ answerDraft: draft }, `draft_${Date.now()}`);
  };

  const handleStyleChange = (style: LessonStyle) => {
    void checkpoint({ style }, `style_${Date.now()}`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-10">
        <SpinnerGap size={20} className="animate-spin text-primary-500" />
      </div>
    );
  }

  if (!lesson) {
    return (
      <div className="p-6 space-y-3 text-sm">
        <div className="flex items-center gap-2 text-red-600 dark:text-red-400">
          <Warning size={16} />
          <span>{error ?? 'Lesson unavailable.'}</span>
        </div>
        <Button variant="text" size="sm" onClick={onClose}>Close</Button>
      </div>
    );
  }

  const sourceChanged = lesson.sourceRevisionSnapshot && lesson.sourceRevisionSnapshot !== scopeSnapshot(planDetail);
  const refIds = node?.sourceRefIds ?? [];
  const sourceRefs = refIds
    .map((id) => planDetail.sourceRefs?.[id]?.ref)
    .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref));

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-surface-200 dark:border-surface-700">
        <Button variant="text" size="iconSm" onClick={onClose} aria-label="Close lesson">
          <ArrowLeft size={18} />
        </Button>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-surface-900 dark:text-surface-100 truncate">
            {node?.title ?? 'Lesson'}
          </h2>
          <p className="text-xs text-surface-500">
            {isModelOnly ? 'AI Knowledge Only · unverified' : 'Library-backed · pinned authority'} · objective {objectiveIndex + 1}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-surface-500" htmlFor="lesson-style">Style</label>
          <select
            id="lesson-style"
            value={lesson.style}
            onChange={(e) => handleStyleChange(e.target.value as LessonStyle)}
            className="h-8 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
            aria-label="Lesson style"
          >
            <option value="guided">Guided Socratic</option>
            <option value="explain-check">Explain + Check</option>
            <option value="challenge">Challenge Me</option>
          </select>
        </div>
      </div>

      {sourceChanged && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
          <Warning size={16} />
          <span>Sources changed since this lesson started. Review the pinned references or start a new lesson.</span>
        </div>
      )}

      {error && (
        <div role="status" className="text-xs text-surface-500 rounded-xl border border-surface-200 dark:border-surface-700 p-3">
          {error}
        </div>
      )}

      <div className="rounded-xl border border-surface-200 dark:border-surface-700 p-4 space-y-3">
        <div className="flex items-start gap-2 text-sm">
          <ChatsCircle size={18} className="text-primary-500 flex-shrink-0 mt-0.5" />
          <p className="text-on-surface dark:text-on-surface-dark">
            {lesson.promptText || node?.title || 'Focus question'}
          </p>
        </div>

        <label className="block space-y-1 text-xs">
          <span className="font-semibold text-surface-600 dark:text-surface-300">Your reasoning</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 resize-none"
            aria-label="Reasoning answer"
            placeholder="Write your answer or reasoning here…"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="tonal" size="sm" onClick={handleSaveDraft} disabled={saving}>
          {saving ? <SpinnerGap size={16} className="animate-spin" /> : null}
          <span>Save progress</span>
        </Button>
        <Button
          variant="outlined"
          size="sm"
          onClick={handleRevealHint}
          disabled={!lesson || lesson.hintCount >= MAX_HINTS || saving}
        >
          <span>Hint ({lesson.hintCount}/{MAX_HINTS})</span>
        </Button>
        <Button variant="outlined" size="sm" onClick={handleExplain} disabled={saving}>
          <span>Explain directly</span>
        </Button>
        <Button variant="text" size="sm" onClick={handleSkip} disabled={saving}>
          <span>Skip</span>
        </Button>
        {onHandoff && (
          <Button variant="filled" size="sm" onClick={onHandoff}>
            <span>Practice independently</span>
          </Button>
        )}
        {!isModelOnly && sourceRefs.length > 0 && (
          <Button variant="filled" size="sm" onClick={() => setShowTutor(true)}>
            <Sparkle size={16} />
            <span>Open scoped tutor</span>
          </Button>
        )}
      </div>

      {!isModelOnly && sourceRefs.length === 0 && (
        <p className="text-xs text-surface-500">
          No verified references on this topic yet — the scoped tutor is unavailable until sources are attached.
        </p>
      )}

      {showTutor && (
        <StudyTutorHost
          open={showTutor}
          planId={planDetail.plan.id}
          planVersionId={planDetail.version.id}
          nodeId={nodeId}
          conceptId={node?.conceptId ?? null}
          sourceRefs={sourceRefs}
          objectives={node?.learningObjectives ?? []}
          topic={node?.title}
          onClose={() => setShowTutor(false)}
        />
      )}
    </div>
  );
};

function safeTurnState(lesson: StudyPlanLesson): Record<string, unknown> {
  try {
    const parsed = JSON.parse(lesson.turnStateJson || '{}');
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}
