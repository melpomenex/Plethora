import { useState } from 'react';
import { BookOpen } from '@phosphor-icons/react';
import { useI18n } from '../../../lib/i18n';
import { reviewStudyPassage } from '../../../lib/study-plans/reading/trailController';
import type { StudyReadingAssignment } from '../../../types/studyReading';
import { Button } from '../../md3/Button';

export function ReviewSupportingPassage({ assignment, originTabId }: {
  assignment: StudyReadingAssignment;
  originTabId?: string;
}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<'opening' | 'error' | null>(null);
  return (
    <div className="flex flex-col items-start gap-1">
      <Button size="sm" variant="tonal" disabled={status === 'opening'} onClick={() => {
        setStatus('opening');
        void reviewStudyPassage(assignment, originTabId).then(() => setStatus(null), () => setStatus('error'));
      }}>
        <BookOpen size={16} aria-hidden="true" />
        {t('studyPlans.reading.reviewPassage')}
      </Button>
      {status === 'error' && <span role="alert" className="text-xs text-error">{t('studyPlans.reading.openFailed')}</span>}
    </div>
  );
}
