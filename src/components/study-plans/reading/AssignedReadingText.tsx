import { useI18n } from '../../../lib/i18n';
import type { StudyReadingSegment } from '../../../types/studyReading';

export function AssignedReadingText({ segments }: { segments: StudyReadingSegment[] }) {
  const { t } = useI18n();

  return (
    <blockquote className="max-w-[72ch] space-y-3 border-s border-primary/40 ps-3 text-sm leading-relaxed text-foreground">
      {segments.map(({ quote, location }, index) => (
        <div key={index}>
          {location?.kind === 'pdf' && (
            <p className="text-xs font-medium text-muted-foreground">
              {t('viewer.page', { current: location.pageNumber })}
            </p>
          )}
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{quote.exact}</p>
        </div>
      ))}
    </blockquote>
  );
}
