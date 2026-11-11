import { useEffect, useRef, useState } from 'react';
import { getExamAttempt } from '../../../api/exam-sessions';
import { runGradingCoordinator } from '../../../lib/study-plans/grading/gradingCoordinator';
import { findPendingGradingSubmissions } from '../../../lib/study-plans/grading/gradingJobPlanner';
import { prepareRubricGrading } from '../../../lib/study-plans/grading/gradingPreflight';
import type { StudyAiPreflight } from '../../../lib/study-plans/generation/types';
import { studyErrorMessage } from '../../../lib/study-plans/studyErrorMessage';
import type { AttemptDetail } from '../../../types/assessmentSessions';
import { Button } from '../../md3/Button';
import { GenerationPrivacySummary } from '../GenerationPrivacySummary';

export function RubricGradingControls({ detail, onUpdate }: {
  detail: AttemptDetail;
  onUpdate: (updated: AttemptDetail) => void;
}) {
  const [preflight, setPreflight] = useState<StudyAiPreflight>();
  const [approveTransfer, setApproveTransfer] = useState(false);
  const [approveCost, setApproveCost] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const activeRun = useRef<AbortController | null>(null);
  useEffect(() => () => activeRun.current?.abort(), []);

  const pending = findPendingGradingSubmissions(detail, detail.questions ?? []);
  if (!detail.attempt.submittedAt || pending.length === 0) return null;

  const inspect = async () => {
    setBusy(true);
    setError(undefined);
    setApproveTransfer(false);
    setApproveCost(false);
    try {
      setPreflight((await prepareRubricGrading(detail)).preflight);
    } catch (error: unknown) {
      setError(studyErrorMessage(error, 'AI grading is unavailable. You can review written answers manually.'));
    } finally {
      setBusy(false);
    }
  };

  const grade = async () => {
    if (!preflight || activeRun.current) return;
    const controller = new AbortController();
    activeRun.current = controller;
    setBusy(true);
    setError(undefined);
    try {
      const current = await getExamAttempt(detail.attempt.id);
      const authorized = { ...preflight, cloudDisclosureAccepted: approveTransfer, costConsentAccepted: approveCost };
      const prepared = await prepareRubricGrading(current, authorized);
      controller.signal.throwIfAborted();
      const result = await runGradingCoordinator({
        attemptDetail: current,
        questions: current.questions ?? [],
        preflight: prepared.preflight,
        preflightRoute: prepared.route,
        sourceRefs: prepared.sourceRefs,
        revalidateSources: async () => { await prepareRubricGrading(current, authorized); },
        signal: controller.signal,
      });
      onUpdate(result.latestAttemptDetail);
      if (result.latestAttemptDetail.attempt.status === 'grading-failed') {
        setError('Some written answers still need grading. You can retry or grade them manually.');
      }
    } catch (error: unknown) {
      setError(studyErrorMessage(error, 'Grading stopped. Saved grades and submitted answers remain available.'));
    } finally {
      setPreflight(undefined);
      setBusy(false);
      activeRun.current = null;
    }
  };

  return (
    <section aria-label="Written answer grading" className="mx-auto max-w-5xl space-y-3 px-4">
      {!preflight && <Button variant="outlined" onClick={inspect} disabled={busy}>Review AI grading options</Button>}
      {preflight && (
        <>
          <GenerationPrivacySummary
            preflight={preflight}
            purpose="rubric"
            cloudDisclosureAccepted={approveTransfer}
            onCloudDisclosureChange={setApproveTransfer}
            costConsentAccepted={approveCost}
            onCostConsentChange={setApproveCost}
            disabled={busy}
          />
          <div className="flex flex-wrap gap-2">
            <Button variant="filled" onClick={grade}
              disabled={busy || preflight.sendsAnswersOffDevice && !approveTransfer || preflight.billable && !approveCost}>
              Grade written answers
            </Button>
            <Button variant="text" onClick={() => busy ? activeRun.current?.abort() : setPreflight(undefined)}>Cancel</Button>
          </div>
        </>
      )}
      {busy && <p role="status" className="text-sm">Preparing or grading written answers…</p>}
      {error && <p role="alert" className="text-sm text-error">{error}</p>}
    </section>
  );
}
