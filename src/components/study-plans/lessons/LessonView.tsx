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
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";
import { runTutorTurn } from '../../../lib/ai/tasks/definitions/tutorTask';
import { prepareLessonHelp } from '../../../lib/study-plans/lessonHelp';
import { GenerationPrivacySummary } from '../GenerationPrivacySummary';


export interface LessonViewProps {
  planDetail: StudyPlanDetail;
  nodeId: string;
  objectiveIndex?: number;
  onClose: () => void;
  /** Hands off to an explicitly chosen independent assessment route. */
  onHandoff?: () => void;
}

const MAX_HINTS = 3;
type HelpAction = 'hint' | 'explain';
type PreparedHelp = Awaited<ReturnType<typeof prepareLessonHelp>>;

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
  useI18n();
  const node = planDetail.version.nodes.find((n) => n.nodeId === nodeId);
  const objective = node?.learningObjectives[objectiveIndex]?.trim();
  const initialPrompt = objective && objective !== node?.title.trim()
    ? translateRecentFeature("studyPlans.lesson.objectivePrompt", { objective })
    : translateRecentFeature("studyPlans.lesson.topicPrompt", { topic: node?.title ?? nodeId });
  const authority = planDetail.version.knowledgeAuthority;
  const isModelOnly = authority.kind === 'model-only';

  const [lesson, setLesson] = useState<StudyPlanLesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [showTutor, setShowTutor] = useState(false);
  const [helpRequest, setHelpRequest] = useState<{ action: HelpAction; prepared: PreparedHelp } | null>(null);
  const [helpAction, setHelpAction] = useState<HelpAction | null>(null);
  const [approveTransfer, setApproveTransfer] = useState(false);
  const [approveCost, setApproveCost] = useState(false);
  const helpController = useRef<AbortController | null>(null);
  const savingRef = useRef(false);
  useEffect(() => () => helpController.current?.abort(), []);
  const savedPrompt = lesson?.promptText.trim();
  // Older lessons stored only the topic title. Keep their drafts and checkpoints.
  const prompt = !savedPrompt || savedPrompt === node?.title.trim() || savedPrompt === nodeId
    ? initialPrompt
    : savedPrompt;

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
        promptText: initialPrompt,
      };
      const created = await createStudyPlanLesson(input);
      setLesson(created);
      setDraft(created.answerDraft);
    } catch (e) {
      setError(studyErrorMessage(e, translateRecentFeature("studyPlans.ui.could-not-start-the-lesson.6f721045")));
    } finally {
      setLoading(false);
    }
  }, [planDetail, nodeId, objectiveIndex, initialPrompt, authority]);

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
          promptText: patch.promptText ?? (prompt === lesson.promptText ? undefined : prompt),
          answerDraft: patch.answerDraft ?? draft,
          hintCount: patch.hintCount,
          turnCount: patch.turnCount,
          turnStateJson: patch.turnStateJson,
        });
        setLesson(updated);
        setDraft(updated.answerDraft);
        setError(null);
        return true;
      } catch (e) {
        // Stale revision: the lesson moved underneath this client. Reload once.
        try {
          const fresh = await getStudyPlanLesson(lesson.id);
          setLesson(fresh);
          setDraft(fresh.answerDraft);
          setError(translateRecentFeature("studyPlans.ui.lesson-state-refreshed-from-.1f6b6801"));
        } catch {
          setError(studyErrorMessage(e, translateRecentFeature("studyPlans.ui.could-not-save-the-lesson-ch.0c94e844")));
        }
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [lesson, draft, prompt]
  );

  const handleSkip = () => {
    if (!lesson) return;
    void checkpoint({ turnCount: lesson.turnCount + 1 }, `skip_${Date.now()}`);
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
          <span>{error ?? translateRecentFeature("i18nAudit.ui.lesson-unavailable.e6931b0b")}</span>
        </div>
        <Button variant="text" size="sm" onClick={onClose}>{translateRecentFeature("common.close")}</Button>
      </div>
    );
  }

  const sourceChanged = lesson.sourceRevisionSnapshot && lesson.sourceRevisionSnapshot !== scopeSnapshot(planDetail);
  const refIds = node?.sourceRefIds ?? [];
  const sources = Object.fromEntries(refIds.flatMap((id) => {
    const resolution = planDetail.sourceRefs?.[id];
    return resolution?.status === 'current' ? [[id, resolution] as const] : [];
  }));
  const sourceRefs = Object.values(sources).map((resolution) => resolution.ref);
  const turnState = safeTurnState(lesson);
  const hints = Array.isArray(turnState.hints)
    ? turnState.hints.filter((hint): hint is string => typeof hint === 'string' && !!hint.trim()).slice(0, MAX_HINTS)
    : [];
  const explanation = typeof turnState.explanation === 'string' ? turnState.explanation : '';
  const busy = saving || helpAction !== null;
  const helpPreflight = helpRequest?.prepared.preflight;

  const requestHelp = async (action: HelpAction, confirm = false) => {
    if (savingRef.current || helpController.current || (action === 'hint' && hints.length >= MAX_HINTS)) return;
    const controller = new AbortController();
    helpController.current = controller;
    setHelpAction(action);
    setError(null);
    try {
      if (sourceChanged) throw new Error('study_generation.error.source_changed');
      const approval = confirm && helpRequest
        ? { route: helpRequest.prepared.route, transfer: approveTransfer, cost: approveCost }
        : undefined;
      const prepared = await prepareLessonHelp(planDetail.version, sources, approval);
      if (controller.signal.aborted) return;
      if (!prepared.preflight.featureAllowed) {
        setApproveTransfer(false);
        setApproveCost(false);
        setHelpRequest({ action, prepared });
        return;
      }
      setHelpRequest(null);
      const result = await runTutorTurn({
        topic: node?.title ?? nodeId,
        selectedMaterial: prepared.excerpts.join('\n\n').slice(0, 4000),
        conversation: [
          ...hints.map((text) => ({ role: 'tutor' as const, text })),
          { role: 'user', text: prompt },
        ],
        stuckCounter: 0,
        hintThread: { level: hints.length, consecutiveHints: hints.length },
        forcedMove: action,
        lessonAuthority: isModelOnly ? 'model-only' : 'library',
      }, { provider: prepared.route.provider, signal: controller.signal });
      if (controller.signal.aborted) return;
      const content = result.output.content.trim();
      if (!content || result.output.move !== action) throw new Error('Unexpected lesson help response');
      const nextHints = action === 'hint' ? [...hints, content] : hints;
      await checkpoint({
        hintCount: nextHints.length,
        turnStateJson: JSON.stringify({
          ...turnState,
          hints: nextHints,
          explanation: action === 'explain' ? content : explanation,
        }),
      }, `help_${crypto.randomUUID()}`);
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(studyErrorMessage(err, translateRecentFeature('studyPlans.lesson.helpFailed')));
      }
    } finally {
      helpController.current = null;
      if (!controller.signal.aborted) setHelpAction(null);
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-4">
      <div className="flex items-center gap-3 pb-3 border-b border-surface-200 dark:border-surface-700">
        <Button variant="text" size="iconSm" onClick={onClose} aria-label={translateRecentFeature("studyPlans.ui.close-lesson.69113ec3")}>
          <ArrowLeft size={18} />
        </Button>
        <div className="min-w-0">
          <h2 className="text-base font-bold text-surface-900 dark:text-surface-100 truncate">
            {node?.title ?? translateRecentFeature("i18nAudit.ui.lesson.e576e3fa")}
          </h2>
          <p className="text-xs text-surface-500">
            {isModelOnly ? translateRecentFeature("studyPlans.ui.ai-knowledge-only-unverified.d562ef98") : translateRecentFeature("studyPlans.ui.library-backed-pinned-author.322190e1")}{translateRecentFeature("studyPlans.ui.objective-var0.ac8c14a9", {var0: objectiveIndex + 1})}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-surface-500" htmlFor="lesson-style">{translateRecentFeature("studyPlans.ui.style.8c1182dc")}</label>
          <select
            id="lesson-style"
            value={lesson.style}
            disabled={busy}
            onChange={(e) => handleStyleChange(e.target.value as LessonStyle)}
            className="h-8 px-2 text-xs rounded border border-surface-200 dark:border-surface-700 bg-white dark:bg-surface-800"
            aria-label={translateRecentFeature("studyPlans.ui.lesson-style.6434a15e")}
          >
            <option value="guided">{translateRecentFeature("studyPlans.ui.guided-socratic.1ce2d15e")}</option>
            <option value="explain-check">{translateRecentFeature("studyPlans.ui.explain-check.83e5cb5b")}</option>
            <option value="challenge">{translateRecentFeature("studyPlans.ui.challenge-me.5eb003a5")}</option>
          </select>
        </div>
      </div>

      {sourceChanged && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
          <Warning size={16} />
          <span>{translateRecentFeature("studyPlans.ui.sources-changed-since-this-l.77dffc68")}</span>
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
          <p id="lesson-prompt" className="whitespace-pre-line font-medium text-on-surface dark:text-on-surface-dark">
            {prompt}
          </p>
        </div>

        <label className="block space-y-1 text-xs">
          <span className="font-semibold text-surface-600 dark:text-surface-300">{translateRecentFeature("studyPlans.ui.your-reasoning.41a32f8e")}</span>
          <textarea
            value={draft}
            readOnly={busy}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 resize-none"
            aria-label={translateRecentFeature("studyPlans.ui.reasoning-answer.d70c281b")}
            aria-describedby="lesson-prompt"
            placeholder={translateRecentFeature("studyPlans.ui.write-your-answer-or-reasoni.426627f7")}
          />
        </label>
      </div>

      <div aria-live="polite">
        {(hints.length > 0 || explanation) && (
          <div className="space-y-3 rounded-xl border border-border bg-surface-container-low p-4 text-sm">
            {hints.map((hint, index) => (
              <div key={index}>
                <h3 className="font-semibold">{translateRecentFeature('studyPlans.lesson.hintNumber', { number: index + 1 })}</h3>
                <p className="whitespace-pre-wrap break-words">{hint}</p>
              </div>
            ))}
            {explanation && (
              <div>
                <h3 className="font-semibold">{translateRecentFeature('studyPlans.lesson.explanation')}</h3>
                <p className="whitespace-pre-wrap break-words">{explanation}</p>
              </div>
            )}
          </div>
        )}
        {helpAction && <p role="status" className="text-sm">{translateRecentFeature(
          helpAction === 'hint' ? 'studyPlans.lesson.preparingHint' : 'studyPlans.lesson.preparingExplanation'
        )}</p>}
      </div>

      {helpRequest && helpPreflight && (
        <div className="space-y-3">
          <GenerationPrivacySummary
            preflight={helpPreflight}
            purpose="lesson"
            cloudDisclosureAccepted={approveTransfer}
            onCloudDisclosureChange={setApproveTransfer}
            costConsentAccepted={approveCost}
            onCostConsentChange={setApproveCost}
            disabled={busy}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="filled" size="sm" onClick={() => void requestHelp(helpRequest.action, true)}
              disabled={busy || (helpPreflight.sendsSourceOffDevice && !approveTransfer) || (helpPreflight.billable && !approveCost)}>
              {translateRecentFeature(helpRequest.action === 'hint' ? 'studyPlans.lesson.generateHint' : 'studyPlans.lesson.generateExplanation')}
            </Button>
            <Button variant="text" size="sm" disabled={busy} onClick={() => setHelpRequest(null)}>
              {translateRecentFeature('common.cancel')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="tonal" size="sm" onClick={handleSaveDraft} disabled={busy}>
          {saving ? <SpinnerGap size={16} className="animate-spin" /> : null}
          <span>{translateRecentFeature("studyPlans.ui.save-progress.b54c0deb")}</span>
        </Button>
        <Button
          variant="outlined"
          size="sm"
          onClick={() => void requestHelp('hint')}
          disabled={hints.length >= MAX_HINTS || busy || !!helpRequest}
        >
          <span>{translateRecentFeature("studyPlans.ui.hint-var0-var1.9fa6ddc7", {var0: hints.length, var1: MAX_HINTS})}</span>
        </Button>
        <Button variant="outlined" size="sm" onClick={() => void requestHelp('explain')} disabled={busy || !!helpRequest || !!explanation}>
          <span>{translateRecentFeature("studyPlans.ui.explain-directly.5b05b037")}</span>
        </Button>
        <Button variant="text" size="sm" onClick={handleSkip} disabled={busy}>
          <span>{translateRecentFeature("common.skip")}</span>
        </Button>
        {onHandoff && (
          <Button variant="filled" size="sm" disabled={busy} onClick={async () => {
            if (draft !== lesson.answerDraft && !await checkpoint({ answerDraft: draft }, `draft_${crypto.randomUUID()}`)) return;
            onHandoff();
          }}>
            <span>{translateRecentFeature("studyPlans.ui.practice-independently.fec1a98a")}</span>
          </Button>
        )}
        {!isModelOnly && !sourceChanged && sourceRefs.length > 0 && (
          <Button variant="filled" size="sm" disabled={busy} onClick={() => setShowTutor(true)}>
            <Sparkle size={16} />
            <span>{translateRecentFeature("studyPlans.ui.open-scoped-tutor.fec03c7f")}</span>
          </Button>
        )}
      </div>

      {!isModelOnly && sourceRefs.length === 0 && (
        <p className="text-xs text-surface-500">
          {translateRecentFeature("studyPlans.ui.no-verified-references-on-th.baffa533")}</p>
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
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
