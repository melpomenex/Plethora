import { useEffect, useState } from 'react';
import { listExamAttempts } from '../../../api/exam-sessions';
import type { AttemptSummary } from '../../../types/assessmentSessions';
import { Button } from '../../md3/Button';
import { AttemptHistory } from './AttemptHistory';

export function AttemptHistoryView({ onBack, onSelect, onResume }: {
  onBack: () => void;
  onSelect: (attemptId: string) => void;
  onResume: (attemptId: string) => void;
}) {
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
    <section className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="text" onClick={onBack}>Back to Study Plans</Button>
        <h1 className="text-xl font-semibold">Assessment history</h1>
      </div>
      {failed ? (
        <div role="alert" className="space-y-2">
          <p>Could not load saved assessments.</p>
          <Button variant="outlined" onClick={() => { setFailed(false); setRetry((value) => value + 1); }}>Retry</Button>
        </div>
      ) : attempts ? (
        <AttemptHistory attempts={attempts} onSelectAttempt={onSelect} onResumeAttempt={onResume} />
      ) : <p role="status">Loading saved assessments…</p>}
    </section>
  );
}
