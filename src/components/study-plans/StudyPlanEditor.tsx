/**
 * Main Study Plan Editor aggregate view.
 *
 * Implements specifications from:
 * - openspec/planning/study-plans-assessments-program/05-UX-SPECIFICATION.md §4.3
 * - openspec/changes/establish-persistent-study-plans/tasks.md (C1-T09)
 */

import React, { useState, useEffect, useRef, useId } from 'react';
import {
  ArrowLeft,
  FloppyDisk,
  CheckCircle,
  ArrowSquareOut,
  Warning,
  Clock,
  GitDiff,
  ListNumbers,
  FileText,
  SpinnerGap,
  Trash,
  Sparkle,
  Link,
  GraduationCap,
  PencilSimple,
} from '@phosphor-icons/react';
import { useLearningPathsStore } from '../../stores/learningPathsStore';
import type {
  StudyPlanDetail,
  StudyPlanVersionNode,
  PlanPrerequisite,
  NodeActivity,
  SaveStudyPlanDraftInput,
} from '../../types/learningPaths';
import type { StudySourceResolution } from '../../types/studySource';
import type { StudyGenerationJob } from '../../lib/study-plans/generation/types';
import {
  cancelStudyGenerationJob,
  recoverInterruptedStudyJobs,
  listStudyGenerationJobs,
} from '../../api/study-generation';
import { PlanOutline } from './PlanOutline';
import { PlanNodeEditor } from './PlanNodeEditor';
import { PlanSourceList } from './PlanSourceList';
import { PlanVersionDiff } from './PlanVersionDiff';
import { PlanVersionHistory, type PlanVersionSummary } from './PlanVersionHistory';
import { CurriculumGenerator } from './CurriculumGenerator';
import { StudyJobRecoveryList } from './StudyJobRecoveryList';
import { StudyPlanProgress } from './evidence/StudyPlanProgress';
import type { StudyPlanProgressProps } from './evidence/StudyPlanProgress';
import type { KnowledgeGapView } from '../../types/learningEvidence';
import { orderStudyPlan } from '../../lib/study-plans/topology';
import { openStudySource } from '../../lib/study-plans/openStudySource';
import { resolveAndVerifySources } from '../../lib/study-plans/addSourcesAndVerify';
import { SourceScopePicker } from './SourceScopePicker';
import { LessonView } from './lessons/LessonView';
import type { SelectedSourceScope } from '../../types/studySource';
import { useTabId } from '../common/Tabs/TabContent';
import { Button } from '../md3/Button';
import { ConfirmDialog } from '../common/ConfirmDialog';
import { studyErrorMessage } from '../../lib/study-plans/studyErrorMessage';
import { AssessmentList } from './assessments/AssessmentList';
import { WebResearchPanel } from './WebResearchPanel';
import type { AssessmentConfigV1 } from '../../types/assessmentQuestions';

export interface StudyPlanEditorProps {
  planDetail: StudyPlanDetail;
  initialNodeId?: string;
  onBack: () => void;
  onOpenSource?: (sourceRefId: string, resolution?: StudySourceResolution) => void;
  onOpenPlanHome?: () => void;
  onOpenAssessmentBuilder?: (planId: string, versionId: string, blueprintRevisionId?: string, initialConfig?: AssessmentConfigV1, initialTitle?: string) => void;
  onPrepareAssessment?: StudyPlanProgressProps['onPrepareAssessment'];
  onProposeCards?: (gap: KnowledgeGapView) => void;
  /** C7-T03 diagnostic host slot rendered inside the generation preview. */
  diagnosticSlot?: React.ReactNode;
}

type EditorTab = 'outline' | 'sources' | 'assessments' | 'diff' | 'history' | 'progress';

export const StudyPlanEditor: React.FC<StudyPlanEditorProps> = ({
  planDetail,
  initialNodeId,
  onBack,
  onOpenSource,
  onOpenPlanHome,
  onOpenAssessmentBuilder,
  onPrepareAssessment,
  onProposeCards,
  diagnosticSlot,
}) => {
  const originTabId = useTabId();
  const ignorePlanTitleBlurRef = useRef(false);
  const planTitleErrorId = useId();
  const selectPlan = useLearningPathsStore((state) => state.selectPlan);
  const renamePlanAction = useLearningPathsStore((state) => state.renamePlan);
  const saveDraftAction = useLearningPathsStore((s) => s.saveDraft);
  const publishVersionAction = useLearningPathsStore((s) => s.publishVersion);
  const discardDraftAction = useLearningPathsStore((s) => s.discardDraft);
  const setNodeActivityAction = useLearningPathsStore((s) => s.setNodeActivity);

  const [activeTab, setActiveTab] = useState<EditorTab>('outline');

  // Draft editing state
  const isDraft = planDetail.version.state === 'draft';
  const [nodes, setNodes] = useState<StudyPlanVersionNode[]>(planDetail.version.nodes);
  const [prerequisites, setPrerequisites] = useState<PlanPrerequisite[]>(
    planDetail.version.prerequisites
  );
  const assessmentConfigForTopic = (nodeId: string): AssessmentConfigV1 => {
    const node = nodes.find((item) => item.nodeId === nodeId);
    return {
      schemaVersion: 1,
      mode: 'exam',
      requestedCount: 10,
      typeWeights: { 'single-select': 4, 'multi-select': 2, cloze: 2, 'short-answer': 2, essay: 1 },
      difficultyWeights: { 1: 1, 2: 3, 3: 4, 4: 2, 5: 1 },
      topicTargets: [{ nodeId, conceptId: node?.conceptId || null, weight: 1 }],
      timeLimitSeconds: 1800,
      knowledgePolicy: 'source-only',
      excludedQuestionFingerprints: [],
      pointsByKind: { 'single-select': 1, 'multi-select': 1, cloze: 1, 'short-answer': 2, essay: 8 },
    };
  };
  const orderedStudyNodes = orderStudyPlan(nodes, prerequisites);
  const learningOrder = orderedStudyNodes.ok
    ? orderedStudyNodes.value.orderedNodes
    : [...nodes].filter((node) => node.included).sort((a, b) => a.position - b.position);
  const unfinishedNodes = learningOrder.filter((node) => {
    const activity = planDetail.activityByNodeId[node.nodeId] ?? 'not-started';
    return activity !== 'completed' && activity !== 'skipped';
  });
  const nextStudyNode = unfinishedNodes.find((node) =>
    node.sourceRefIds.some((refId) => planDetail.sourceRefs[refId]?.status !== 'missing')
  ) ?? unfinishedNodes[0];
  const isContinuingTopic = nextStudyNode &&
    planDetail.activityByNodeId[nextStudyNode.nodeId] === 'in-progress';
  const nextStudySourceRefId = nextStudyNode?.sourceRefIds.find(
    (refId) => planDetail.sourceRefs[refId]?.status !== 'missing'
  );
  const nextStudySourceTitle = nextStudySourceRefId
    ? planDetail.sourceRefs[nextStudySourceRefId]?.ref?.documentTitle
    : undefined;
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(
    planDetail.version.nodes.find((node) => node.nodeId === initialNodeId)?.nodeId ??
    planDetail.version.nodes[0]?.nodeId ?? null
  );

  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState<string | null>(null);
  const [isEditingPlanTitle, setIsEditingPlanTitle] = useState(false);
  const [planTitleDraft, setPlanTitleDraft] = useState(planDetail.plan.title);
  const [isRenamingPlanTitle, setIsRenamingPlanTitle] = useState(false);
  const [planTitleError, setPlanTitleError] = useState<string | null>(null);

  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);
  const [showPublishDiffModal, setShowPublishDiffModal] = useState(false);
  const [lockConflictsAcknowledged, setLockConflictsAcknowledged] = useState(false);

  // Curriculum generator & interrupted jobs state
  const [isGeneratorOpen, setIsGeneratorOpen] = useState(false);
  const [recoveryJob, setRecoveryJob] = useState<StudyGenerationJob>();
  const [isVerifyPanelOpen, setIsVerifyPanelOpen] = useState(false);
  const [verifyScope, setVerifyScope] = useState<SelectedSourceScope>({
    documentIds: [],
    extractIds: [],
    collectionIds: [],
    tagIds: [],
  });
  const [isVerifying, setIsVerifying] = useState(false);
  const [showLessonModal, setShowLessonModal] = useState(false);
  const draftVersionId = planDetail.plan.draftVersionId;
  const [interruptedJobs, setInterruptedJobs] = useState<StudyGenerationJob[]>([]);

  useEffect(() => {
    let active = true;
    if (!draftVersionId || isGeneratorOpen) return;
    void recoverInterruptedStudyJobs()
      .then(() => listStudyGenerationJobs(draftVersionId))
      .then((jobs) => {
        if (active) setInterruptedJobs(jobs.filter((job) => job.kind === 'curriculum' &&
          (job.status === 'interrupted' || job.status === 'failed')));
      })
      .catch(() => {
        if (active) setInterruptedJobs([]);
      });
    return () => { active = false; };
  }, [draftVersionId, isGeneratorOpen]);

  useEffect(() => {
    if (initialNodeId && planDetail.version.nodes.some((node) => node.nodeId === initialNodeId)) {
      setSelectedNodeId(initialNodeId);
      setActiveTab('outline');
    }
  }, [initialNodeId, planDetail.version.nodes]);

  // Sync state if planDetail props change from store
  useEffect(() => {
    setNodes(planDetail.version.nodes);
    setPrerequisites(planDetail.version.prerequisites);
    setIsDirty(false);
  }, [planDetail.version.id, planDetail.version.state, planDetail.plan.revision]);

  useEffect(() => {
    if (!isEditingPlanTitle) setPlanTitleDraft(planDetail.plan.title);
  }, [isEditingPlanTitle, planDetail.plan.id, planDetail.plan.title]);

  useEffect(() => {
    if (!isEditingPlanTitle) ignorePlanTitleBlurRef.current = false;
  }, [isEditingPlanTitle]);

  const handleNodesChange = (updatedNodes: StudyPlanVersionNode[]) => {
    setNodes(updatedNodes);
    setIsDirty(true);
    setSaveSuccessNotice(null);
    setErrorBanner(null);
  };

  const handlePrerequisitesChange = (updatedPrereqs: PlanPrerequisite[]) => {
    setPrerequisites(updatedPrereqs);
    setIsDirty(true);
    setSaveSuccessNotice(null);
    setErrorBanner(null);
  };

  const handleRenamePlanTitle = async () => {
    if (isRenamingPlanTitle) return;
    const title = planTitleDraft.trim();
    if (!title) {
      setPlanTitleError('Enter a title for this plan.');
      return;
    }
    if (title === planDetail.plan.title) {
      setIsEditingPlanTitle(false);
      setPlanTitleError(null);
      return;
    }

    setIsRenamingPlanTitle(true);
    setPlanTitleError(null);
    setErrorBanner(null);
    try {
      await renamePlanAction({
        planId: planDetail.plan.id,
        title,
        expectedTitle: planDetail.plan.title,
        expectedPlanRevision: planDetail.plan.revision,
      });
      setPlanTitleDraft(title);
      setIsEditingPlanTitle(false);
      setSaveSuccessNotice('Plan title updated.');
    } catch (err: unknown) {
      setErrorBanner(studyErrorMessage(err, 'Could not rename the plan. Your title is still here.'));
    } finally {
      setIsRenamingPlanTitle(false);
    }
  };

  const handleNodeUpdate = (updatedNode: StudyPlanVersionNode) => {
    const updated = nodes.map((n) => (n.nodeId === updatedNode.nodeId ? updatedNode : n));
    handleNodesChange(updated);
  };

  const handleStartLesson = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setShowLessonModal(true);
  };

  const handleOpenSource = (refId: string, resolution = planDetail.sourceRefs[refId]) => {
    if (onOpenSource) {
      onOpenSource(refId, resolution);
      return;
    }
    if (!resolution) {
      setErrorBanner('The saved source reference is unavailable.');
      return;
    }
    void openStudySource(resolution, {
      allowCoarseNavigationOnStale: true,
      returnContext: { originPlanId: planDetail.plan.id, originTabId: originTabId ?? undefined },
    }).then((result) => {
      if (result.success === false) setErrorBanner(result.message);
    }, () => setErrorBanner('Could not open the source.'));
  };

  const handleVerifySources = async () => {
    if (isVerifying) return;
    setIsVerifying(true);
    setErrorBanner(null);
    try {
      const updated = await resolveAndVerifySources(
        planDetail.plan.id,
        planDetail.plan.revision,
        verifyScope
      );
      setIsVerifyPanelOpen(false);
      setSaveSuccessNotice('Sources added. The draft is now Library Only; ground each topic with verified references before publishing.');
      void selectPlan(updated.plan.id, updated.version.id)
        .catch(() => setErrorBanner('Could not reload the saved draft.'));
    } catch (err: unknown) {
      setErrorBanner(studyErrorMessage(err, 'Could not verify sources. Check your selection and try again.'));
    } finally {
      setIsVerifying(false);
    }
  };

  const handleActivityChange = async (nodeId: string, activity: NodeActivity) => {    try {
      await setNodeActivityAction(
        planDetail.plan.id,
        nodeId,
        activity,
        planDetail.plan.revision
      );
    } catch (err: any) {
      setErrorBanner(studyErrorMessage(err, 'Could not update topic activity.'));
    }
  };

  const handleBeginLearning = async () => {
    if (!nextStudyNode) return;
    setSelectedNodeId(nextStudyNode.nodeId);
    if ((planDetail.activityByNodeId[nextStudyNode.nodeId] ?? 'not-started') !== 'in-progress') {
      await handleActivityChange(nextStudyNode.nodeId, 'in-progress');
    }
    if (nextStudySourceRefId) {
      handleOpenSource(nextStudySourceRefId);
    } else {
      setActiveTab('sources');
    }
  };

  const handleSaveDraft = async () => {
    if (!isDraft) return;

    // Validate DAG before saving
    const dagResult = orderStudyPlan(nodes, prerequisites);
    if (!dagResult.ok) {
      setErrorBanner(
        dagResult.error.code === 'dependency_cycle' ? 'Remove the circular prerequisite before saving.' : 'Check that the prerequisite links point to included topics.'
      );
      return;
    }

    setIsSaving(true);
    setErrorBanner(null);

    const input: SaveStudyPlanDraftInput = {
      planId: planDetail.plan.id,
      expectedDraftRevision: planDetail.plan.revision,
      nodes,
      prerequisites,
    };

    try {
      await saveDraftAction(input);
      setIsDirty(false);
      setSaveSuccessNotice('Draft saved successfully.');
    } catch (err: any) {
      setErrorBanner(studyErrorMessage(err, 'Could not save the draft. Your edits are still here.'));
    } finally {
      setIsSaving(false);
    }
  };

  const handlePublishClick = () => {
    // Validate DAG first
    const dagResult = orderStudyPlan(nodes, prerequisites);
    if (!dagResult.ok) {
      setErrorBanner(
        dagResult.error.code === 'dependency_cycle' ? 'Remove the circular prerequisite before publishing.' : 'Check that the prerequisite links point to included topics.'
      );
      return;
    }

    setErrorBanner(null);
    setShowPublishDiffModal(true);
  };

  const handleConfirmPublish = async () => {
    setIsPublishing(true);
    setErrorBanner(null);

    try {
      const saved = isDirty
        ? await saveDraftAction({
          planId: planDetail.plan.id,
          expectedDraftRevision: planDetail.plan.revision,
          nodes,
          prerequisites,
        })
        : planDetail;

      await publishVersionAction(
        saved.plan.id,
        saved.version.id,
        saved.plan.revision
      );

      setShowPublishDiffModal(false);
      setIsDirty(false);
      setSaveSuccessNotice('Plan version published successfully.');
    } catch (err: any) {
      setErrorBanner(studyErrorMessage(err, 'Could not publish the plan. Your draft remains available.'));
    } finally {
      setIsPublishing(false);
    }
  };

  const handleConfirmDiscard = async () => {
    setShowDiscardConfirm(false);
    setErrorBanner(null);
    try {
      await discardDraftAction(planDetail.plan.id, planDetail.plan.revision);
      setSaveSuccessNotice('Draft discarded.');
    } catch (err: any) {
      setErrorBanner(studyErrorMessage(err, 'Could not discard the draft.'));
    }
  };

  const selectedNode = nodes.find((n) => n.nodeId === selectedNodeId) || nodes[0] || null;

  // Build version summaries
  const versionHistoryList: PlanVersionSummary[] = [
    {
      id: planDetail.version.id,
      version: planDetail.version.version,
      state: planDetail.version.state,
      createdBy: planDetail.version.createdBy,
      createdAt: planDetail.version.createdAt,
      publishedAt: planDetail.version.publishedAt,
      nodeCount: planDetail.version.nodes.length,
    },
  ];

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain max-w-6xl mx-auto p-6 space-y-6">
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-surface-200 dark:border-surface-700">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Button
            variant="text"
            size="iconSm"
            onClick={onBack}
            aria-label="Back to study plans list"
          >
            <ArrowLeft size={18} />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span
                className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                  isDraft
                    ? 'border-amber-500/30 text-amber-600 dark:text-amber-400 bg-amber-500/10'
                    : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10'
                }`}
              >
                {isDraft ? 'Draft v' + planDetail.version.version : 'Published v' + planDetail.plan.currentVersion}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-surface-300 dark:border-surface-600 text-surface-600 dark:text-surface-400">
                {planDetail.plan.depth}
              </span>
              {isDirty && (
                <span className="text-[10px] font-bold text-amber-500 dark:text-amber-400">
                  ● Unsaved changes
                </span>
              )}
          </div>

            {isEditingPlanTitle ? (
              <>
                <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100">
                  <input
                    autoFocus
                    type="text"
                    maxLength={120}
                    value={planTitleDraft}
                    aria-label="Plan title"
                    aria-invalid={Boolean(planTitleError)}
                    aria-describedby={planTitleError ? planTitleErrorId : undefined}
                    disabled={isRenamingPlanTitle}
                    onChange={(event) => {
                      setPlanTitleDraft(event.target.value);
                      setPlanTitleError(null);
                    }}
                    onBlur={() => {
                      if (ignorePlanTitleBlurRef.current) {
                        ignorePlanTitleBlurRef.current = false;
                        return;
                      }
                      void handleRenamePlanTitle();
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        event.currentTarget.blur();
                      } else if (event.key === 'Escape') {
                        event.preventDefault();
                        ignorePlanTitleBlurRef.current = true;
                        setPlanTitleDraft(planDetail.plan.title);
                        setPlanTitleError(null);
                        setIsEditingPlanTitle(false);
                      }
                    }}
                    className="w-full max-w-[32rem] rounded-md border border-primary/60 bg-surface-50 px-2 py-1 text-xl font-bold text-surface-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:bg-surface-800 dark:text-surface-100"
                  />
                </h1>
                {planTitleError && (
                  <span id={planTitleErrorId} role="alert" className="mt-1 block text-xs font-normal text-error">
                    {planTitleError}
                  </span>
                )}
              </>
            ) : (
              <h1 className="text-xl font-bold text-surface-900 dark:text-surface-100">
                <button
                  type="button"
                  onClick={() => {
                    setPlanTitleDraft(planDetail.plan.title);
                    setPlanTitleError(null);
                    setIsEditingPlanTitle(true);
                  }}
                  aria-label={`Rename plan: ${planDetail.plan.title}`}
                  title="Click to edit plan title"
                  className="group inline-flex max-w-full items-baseline gap-1.5 rounded-sm text-left hover:text-primary dark:hover:text-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <span className="break-words">{planDetail.plan.title}</span>
                  <PencilSimple
                    size={14}
                    aria-hidden="true"
                    className="shrink-0 self-center text-surface-500 opacity-70 transition-opacity group-hover:opacity-100"
                  />
                </button>
              </h1>
            )}
            <p className="text-xs text-surface-500 line-clamp-1">{planDetail.plan.goal}</p>
        </div>
      </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 flex-wrap self-end sm:self-center">
          {onOpenPlanHome && (
            <Button
              variant="outlined"
              size="sm"
              onClick={onOpenPlanHome}
              aria-label="Open plan home"
            >
              <ListNumbers size={16} />
              <span>Plan Home</span>
            </Button>
          )}
          {isDraft && (
            <>
              {planDetail.version.knowledgeAuthority.kind !== 'library' && (
                <Button
                  variant="outlined"
                  size="sm"
                  onClick={() => setIsVerifyPanelOpen((open) => !open)}
                  disabled={isVerifying}
                  aria-label={isVerifyPanelOpen ? 'Close verification' : 'Add sources and verify'}
                >
                  <Link size={16} />
                  <span>{isVerifyPanelOpen ? 'Close verification' : 'Add sources and verify'}</span>
                </Button>
              )}
              {selectedNodeId && (
                <Button
                  variant="outlined"
                  size="sm"
                  onClick={() => handleStartLesson(selectedNodeId)}
                  disabled={isVerifying}
                  aria-label="Start lesson for the selected topic"
                >
                  <Sparkle size={16} />
                  <span>Start lesson</span>
                </Button>
              )}
              {planDetail.plan.currentVersion > 0 && (
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => setShowDiscardConfirm(true)}
                >
                  <Trash size={16} />
                  <span>Discard Draft</span>
                </Button>
              )}

              <Button
                variant="outlined"
                size="sm"
                onClick={() => { setRecoveryJob(undefined); setIsGeneratorOpen(true); }}
                aria-label="Regenerate curriculum"
              >
                <Sparkle size={16} />
                <span>Regenerate</span>
              </Button>

              <Button
                variant="tonal"
                size="sm"
                disabled={!isDirty || isSaving}
                onClick={handleSaveDraft}
              >
                {isSaving ? <SpinnerGap size={16} className="animate-spin" /> : <FloppyDisk size={16} />}
                <span>{isSaving ? 'Saving…' : 'Save Draft'}</span>
              </Button>

              <Button
                variant="filled"
                size="sm"
                onClick={handlePublishClick}
                disabled={isPublishing}
              >
                <CheckCircle size={16} />
                <span>Review &amp; Publish</span>
              </Button>
            </>
          )}
          {onOpenAssessmentBuilder && (
            <Button
              variant="outlined"
              size="sm"
              onClick={() => setActiveTab('assessments')}
              aria-label="Open assessments for this study plan"
            >
              <GraduationCap size={16} />
              <span>Assessments</span>
            </Button>
          )}
      </div>
    </div>

      {isVerifyPanelOpen && (
        <section aria-label="Add sources and verify" className="rounded-xl border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 p-4 space-y-3">
          <div className="text-xs text-surface-600 dark:text-surface-300">
            Select library material to ground this plan. The draft switches to <strong>Library Only</strong> (source-only).
            Publishing still requires every grounded topic to carry current, verified references.
          </div>
          <SourceScopePicker selectedScope={verifyScope} onChange={setVerifyScope} maxDocuments={24} />
          <div className="flex justify-end gap-2">
            <Button variant="text" size="sm" onClick={() => setIsVerifyPanelOpen(false)} disabled={isVerifying}>
              Cancel
            </Button>
            <Button variant="filled" size="sm" onClick={handleVerifySources} disabled={isVerifying}>
              {isVerifying ? <SpinnerGap size={16} className="animate-spin" /> : <CheckCircle size={16} />}
              <span>{isVerifying ? 'Verifying…' : 'Switch to Library Only'}</span>
            </Button>
          </div>
        </section>
      )}

      {showLessonModal && selectedNodeId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto"
          onClick={(event) => {
            if (event.target === event.currentTarget) setShowLessonModal(false);
          }}
        >
          <div className="bg-surface dark:bg-surface-dark rounded-3xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <LessonView
              planDetail={planDetail}
              nodeId={selectedNodeId}
              onClose={() => setShowLessonModal(false)}
              onHandoff={() => {
                setShowLessonModal(false);
                setActiveTab('assessments');
              }}
            />
          </div>
        </div>
      )}

      {!isDraft && (
        nextStudyNode ? (
          <section
            aria-labelledby="study-plan-next-step"
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-primary-500/30 bg-primary-500/5"
          >
            <div className="min-w-0">
              <h2 id="study-plan-next-step" className="text-sm font-semibold text-surface-900 dark:text-surface-100">
                {isContinuingTopic ? 'Continue with' : 'Start with'} {nextStudyNode.title}
              </h2>
              <p className="mt-1 text-xs text-surface-600 dark:text-surface-300">
                {nextStudySourceRefId
                  ? isContinuingTopic
                    ? `Continue with ${nextStudySourceTitle || 'its first linked source'}, then select Completed below when you finish.`
                    : `Open ${nextStudySourceTitle || 'its first linked source'} to study. The topic will be marked In progress; select Completed below when you finish.`
                  : 'This topic has no linked source. Browse the plan’s source material to choose where to begin.'}
              </p>
            </div>
            <Button
              variant="filled"
              size="sm"
              onClick={() => void handleBeginLearning()}
              aria-label={nextStudySourceRefId
                ? `Open a source and start ${nextStudyNode.title}`
                : 'Browse plan source material'}
              className="flex-shrink-0"
            >
              <ArrowSquareOut size={16} />
              <span>{nextStudySourceRefId ? 'Open source' : 'Browse sources'}</span>
            </Button>
          </section>
        ) : (
          <div role="status" className="flex items-start gap-2 p-4 rounded-xl border border-emerald-500/25 bg-emerald-500/5 text-sm">
            <CheckCircle size={18} weight="fill" className="mt-0.5 text-emerald-600 dark:text-emerald-400" />
            <div>
              <p className="font-semibold text-surface-900 dark:text-surface-100">No topics left to start</p>
              <p className="mt-1 text-xs text-surface-600 dark:text-surface-300">
                Select any topic to review its sources or update its progress.
              </p>
            </div>
          </div>
        )
      )}

      {/* Interrupted Jobs Recovery Banner */}
      {interruptedJobs.length > 0 && (
        <StudyJobRecoveryList
          jobs={interruptedJobs}
          onResumeJob={(job) => { setRecoveryJob(job); setIsGeneratorOpen(true); }}
          onCancelJob={async (job) => {
            try {
              await cancelStudyGenerationJob(job.id, job.cancellationEpoch ?? 0);
              setInterruptedJobs((prev) => prev.filter((j) => j.id !== job.id));
            } catch (err: any) {
              setErrorBanner(studyErrorMessage(err, 'Could not discard the generation job.'));
            }
          }}
        />
      )}

      {/* Notifications */}
      {errorBanner && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-600 dark:text-red-400 flex items-center justify-between gap-2"
        >
          <div className="flex items-center gap-2">
            <Warning size={16} className="flex-shrink-0" />
            <span>{errorBanner}</span>
        </div>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="text-red-600 dark:text-red-400 font-bold hover:underline"
          >
            Dismiss
          </button>
      </div>
      )}

      {saveSuccessNotice && (
        <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-600 dark:text-emerald-400 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} weight="fill" />
            <span>{saveSuccessNotice}</span>
        </div>
          <button
            type="button"
            onClick={() => setSaveSuccessNotice(null)}
            className="text-emerald-600 dark:text-emerald-400 font-bold hover:underline"
          >
            Dismiss
          </button>
      </div>
      )}

      {/* Navigation tabs */}
      <div
        role="tablist"
        aria-label="Editor sections"
        className="flex items-center gap-1 border-b border-surface-200 dark:border-surface-700 text-xs font-semibold"
      >
        <button
          role="tab"
          aria-selected={activeTab === 'outline'}
          onClick={() => setActiveTab('outline')}
          className={`flex items-center gap-1.5 px-4 py-2 border-b-2 transition-colors ${
            activeTab === 'outline'
              ? 'border-primary-500 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
          }`}
        >
          <ListNumbers size={16} />
          <span>Curriculum Outline</span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'sources'}
          onClick={() => setActiveTab('sources')}
          className={`flex items-center gap-1.5 px-4 py-2 border-b-2 transition-colors ${
            activeTab === 'sources'
              ? 'border-primary-500 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
          }`}
        >
          <FileText size={16} />
          <span>Source Material</span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'assessments'}
          onClick={() => setActiveTab('assessments')}
          className={`flex items-center gap-1.5 px-4 py-2 border-b-2 transition-colors ${
            activeTab === 'assessments'
              ? 'border-primary-500 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
          }`}
        >
          <GraduationCap size={16} />
          <span>Assessments</span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'diff'}
          onClick={() => setActiveTab('diff')}
          className={`flex items-center gap-1.5 px-4 py-2 border-b-2 transition-colors ${
            activeTab === 'diff'
              ? 'border-primary-500 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
          }`}
        >
          <GitDiff size={16} />
          <span>Version Diff</span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'history'}
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-1.5 px-4 py-2 border-b-2 transition-colors ${
            activeTab === 'history'
              ? 'border-primary-500 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
          }`}
        >
          <Clock size={16} />
          <span>Version History</span>
        </button>

        <button
          role="tab"
          aria-selected={activeTab === 'progress'}
          onClick={() => setActiveTab('progress')}
          className={`flex items-center gap-1.5 px-4 py-2 border-b-2 transition-colors ${
            activeTab === 'progress'
              ? 'border-primary-500 text-primary-600 dark:text-primary-400'
              : 'border-transparent text-surface-500 hover:text-surface-800 dark:hover:text-surface-200'
          }`}
        >
          <CheckCircle size={16} />
          <span>Evidence &amp; Gaps</span>
        </button>
    </div>

      {/* Main Tab Panels */}
      {activeTab === 'outline' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left: Outline column */}
          <div className="lg:col-span-5 space-y-4">
            <h3 className="text-xs font-bold text-surface-500 uppercase tracking-wider">
              Topics ({nodes.filter((n) => n.included).length})
            </h3>
            <PlanOutline
              nodes={nodes}
              prerequisites={prerequisites}
              selectedNodeId={selectedNodeId}
              activityByNodeId={planDetail.activityByNodeId}
              onSelectNode={setSelectedNodeId}
              onChangeNodes={handleNodesChange}
              onChangeNode={handleNodeUpdate}
              onStartLesson={handleStartLesson}
              isReadOnly={!isDraft}
            />
        </div>

          {/* Right: Selected Node Editor */}
          <div className="lg:col-span-7">
            {selectedNode ? (
              <PlanNodeEditor
                node={selectedNode}
                allNodes={nodes}
                prerequisites={prerequisites}
                activity={planDetail.activityByNodeId[selectedNode.nodeId] || 'not-started'}
                sourceResolutions={planDetail.sourceRefs}
                onChangeNode={handleNodeUpdate}
                onChangePrerequisites={handlePrerequisitesChange}
                onChangeActivity={(act) => handleActivityChange(selectedNode.nodeId, act)}
                onOpenSource={handleOpenSource}
                isReadOnly={!isDraft}
              />
            ) : (
              <div className="py-12 text-center text-xs text-surface-500">
                Select a topic from the outline to inspect or edit.
            </div>
            )}
        </div>
      </div>
      )}

      {activeTab === 'sources' && (
        <div className="max-w-3xl space-y-4">
          <h3 className="text-sm font-bold text-surface-900 dark:text-surface-100">
            Source Material
          </h3>
          {planDetail.version.knowledgeAuthority.kind === 'model-only' ? (
            <WebResearchPanel
              planId={planDetail.plan.id}
              planVersionId={planDetail.version.id}
            />
          ) : (
            <PlanSourceList
              sourceRefIds={Object.keys(planDetail.sourceRefs)}
              sourceResolutions={planDetail.sourceRefs}
              onOpenSource={handleOpenSource}
              isReadOnly={true}
            />
          )}
      </div>
      )}

      {activeTab === 'assessments' && (
        <AssessmentList
          planId={planDetail.plan.id}
          topics={nodes.filter((node) => node.included).map((node) => ({ nodeId: node.nodeId, title: node.title }))}
          onCreateNew={() => onOpenAssessmentBuilder?.(planDetail.plan.id, planDetail.version.id)}
          onCreateForTopic={(nodeId) => onOpenAssessmentBuilder?.(
            planDetail.plan.id,
            planDetail.version.id,
            undefined,
            assessmentConfigForTopic(nodeId),
            `${planDetail.plan.title} — ${nodes.find((node) => node.nodeId === nodeId)?.title || 'Topic'} Assessment`,
          )}
          onSelectBlueprint={(blueprintId, revisionId) => onOpenAssessmentBuilder?.(
            planDetail.plan.id,
            planDetail.version.id,
            revisionId || blueprintId,
          )}
        />
      )}

      {activeTab === 'diff' && (
        <div className="max-w-3xl space-y-4">
          <h3 className="text-sm font-bold text-surface-900 dark:text-surface-100">
            Changes from Baseline
          </h3>
          <PlanVersionDiff
            diff={planDetail.version.changeSummary}
            lockConflictsAcknowledged={lockConflictsAcknowledged}
            onAcknowledgeLockConflicts={() =>
              setLockConflictsAcknowledged(!lockConflictsAcknowledged)
            }
          />
      </div>
      )}

      {activeTab === 'history' && (
        <div className="max-w-3xl space-y-4">
          <h3 className="text-sm font-bold text-surface-900 dark:text-surface-100">
            Version Timeline
          </h3>
          <PlanVersionHistory
            versions={versionHistoryList}
            activeVersionId={planDetail.version.id}
            onSelectVersion={() => {}}
            canCreateDraft={!isDraft}
          />
      </div>
      )}

      {activeTab === 'progress' && (
        <div className="max-w-3xl space-y-4">
          <h3 className="text-sm font-bold text-surface-900 dark:text-surface-100">
            Demonstrated Evidence &amp; Gaps
          </h3>
          <StudyPlanProgress
            planId={planDetail.plan.id}
            nodeTitles={Object.fromEntries(nodes.map((n) => [n.nodeId, n.title]))}
            onPrepareAssessment={isDraft ? undefined : onPrepareAssessment}
            onOpenSource={(refId) => {
              if (refId) handleOpenSource(refId);
            }}
            onOpenLesson={(nodeId) => {
              setSelectedNodeId(nodeId);
              setShowLessonModal(true);
            }}
            onProposeCards={onProposeCards}
          />
      </div>
      )}

      {/* Discard Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDiscardConfirm}
        onClose={() => setShowDiscardConfirm(false)}
        onConfirm={handleConfirmDiscard}
        title="Discard Active Draft?"
        message="This will remove your uncommitted draft changes and restore the current published version. This action cannot be undone."
        confirmLabel="Discard Draft"
        variant="danger"
      />

      {/* Publish Diff Modal */}
      {showPublishDiffModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="publish-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
        >
          <div className="w-full max-w-xl p-6 rounded-2xl bg-surface-0 dark:bg-surface-850 shadow-2xl border border-surface-200 dark:border-surface-700 space-y-4">
            <h2 id="publish-dialog-title" className="text-lg font-bold text-surface-900 dark:text-surface-100">
              Publish Version {planDetail.plan.currentVersion + 1}
            </h2>
            <p className="text-xs text-surface-500">
              Publishing will seal this version as immutable head. All topics and prerequisite order
              will be committed to SQLite.
            </p>

            <PlanVersionDiff
              diff={planDetail.version.changeSummary}
              lockConflictsAcknowledged={lockConflictsAcknowledged}
              onAcknowledgeLockConflicts={() =>
                setLockConflictsAcknowledged(!lockConflictsAcknowledged)
              }
            />

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-surface-200 dark:border-surface-700">
              <Button
                variant="text"
                size="sm"
                onClick={() => setShowPublishDiffModal(false)}
                disabled={isPublishing}
              >
                Cancel
              </Button>
              <Button
                variant="filled"
                size="sm"
                disabled={isPublishing}
                onClick={handleConfirmPublish}
              >
                {isPublishing && <SpinnerGap size={16} className="animate-spin" />}
                <span>{isPublishing ? 'Publishing…' : 'Confirm & Publish'}</span>
              </Button>
          </div>
        </div>
      </div>
      )}
      {/* Curriculum Generator Modal */}
      {isGeneratorOpen && (
        <CurriculumGenerator
          planDetail={planDetail}
          isOpen={isGeneratorOpen}
          recoveryJob={recoveryJob}
          onOpenSource={(refId) => handleOpenSource(refId)}
          diagnosticSlot={diagnosticSlot}
          onClose={() => {
            setIsGeneratorOpen(false);
            void selectPlan(planDetail.plan.id).catch(() => setErrorBanner('Could not reload the saved draft.'));
          }}
          onSuccess={(updatedDetail) => {
            setIsGeneratorOpen(false);
            setNodes(updatedDetail.version.nodes);
            setPrerequisites(updatedDetail.version.prerequisites);
            setSaveSuccessNotice('Curriculum updated successfully.');
            void selectPlan(updatedDetail.plan.id, updatedDetail.version.id)
              .catch(() => setErrorBanner('Could not reload the saved draft.'));
          }}
        />
      )}
    </div>
  );
};
