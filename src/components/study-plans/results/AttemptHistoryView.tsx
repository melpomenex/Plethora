import { useEffect, useState } from 'react';
import { listExamAttempts } from '../../../api/exam-sessions';
import type { AttemptSummary } from '../../../types/assessmentSessions';
import { Button } from '../../md3/Button';
import { AttemptHistory } from './AttemptHistory';
import { StudyPlansScrollContainer } from '../StudyPlansScrollContainer';
import { t as translateRecentFeature, useI18n } from "../../../lib/i18n";


export function AttemptHistoryView({ onBack, onSelect, onResume }: {
  onBack: () => void;
  onSelect: (attemptId: string) => void;
  onResume: (attemptId: string) => void;
}) {
    useI18n();
    const [attempts, setAttempts] = useState<AttemptSummary[]>();
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void listExamAttempts().then(
      (result) => { if (active) setAttempts(result); },
      () => { if (active) setFailed(true); },
    );
    return () => { active = false; };
  }, [retry]);

  return (
    <StudyPlansScrollContainer data-study-plans-scroll="assessment-history">
    <section aria-label={translateRecentFeature("studyPlans.ui.assessment-history.1c6c7d5b")} className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="text" onClick={onBack}>{translateRecentFeature("studyPlans.ui.back-to-study-plans.ab06af27")}</Button>
        <h1 className="text-xl font-semibold">{translateRecentFeature("studyPlans.ui.assessment-history.1c6c7d5b")}</h1>
      </div>
      {failed ? (
        <div role="alert" className="space-y-2">
          <p>{translateRecentFeature("studyPlans.ui.could-not-load-saved-assessm.76f9461b")}</p>
          <Button variant="outlined" onClick={() => { setFailed(false); setRetry((value) => value + 1); }}>{translateRecentFeature("assistant.actions.retry")}</Button>
        </div>
      ) : attempts ? (
        <AttemptHistory attempts={attempts} onSelectAttempt={onSelect} onResumeAttempt={onResume} />
      ) : <p role="status">{translateRecentFeature("studyPlans.ui.loading-saved-assessments.d7fdd831")}</p>}
    </section>
    </StudyPlansScrollContainer>
  );
}
