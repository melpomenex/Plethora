import { StudyApiError } from '../../api/study-plans';
import { t } from '../i18n';

const SAFE_REASON_HINTS: Record<string, string> = {
  'study_source.stale.excerpt_not_in_source': 'Indexed passages no longer match the live source text.',
  'study_source.stale.revision_changed': 'Selected sources changed after indexing; re-indexing may be required.',
  'study_source.stale.chunk_not_found': 'Indexed source chunks were missing.',
  'study_source.stale.chunk_mismatch': 'Indexed chunk hash differed from the live source.',
  'study_source.ambiguous.multiple_matches': 'Retrieved passage matched multiple locations in the source.',
  'study_source.unsupported.jump_kind_mismatch': 'Retrieved locator format did not match the source type.',
  'study_source.missing.document': 'One or more selected source documents no longer exist.',
};

function formatDiagnosticHints(missingByKind?: Record<string, number>): string | undefined {
  if (!missingByKind) return undefined;
  const hints: string[] = [];
  for (const [key, count] of Object.entries(missingByKind)) {
    if (count > 0 && SAFE_REASON_HINTS[key]) {
      hints.push(SAFE_REASON_HINTS[key]);
    }
  }
  return hints.length > 0 ? hints.slice(0, 2).join(' ') : undefined;
}

export function studyErrorMessageForKey(messageKey: string): string | undefined {
  const translated = t(messageKey);
  return translated === messageKey ? undefined : translated;
}

export function studyErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof StudyApiError) {
    const base = studyErrorMessageForKey(error.messageKey) ?? fallback;
    const hint = formatDiagnosticHints(error.details?.missingByKind);
    return hint ? `${base} (${hint})` : base;
  }

  if (typeof error === "string") {
    return studyErrorMessageForKey(error) ?? fallback;
  }

  if (error && typeof error === "object") {
    const candidate = error as {
      messageKey?: unknown;
      message?: unknown;
      details?: { missingByKind?: Record<string, number> };
    };
    if (typeof candidate.messageKey === "string") {
      const translated = studyErrorMessageForKey(candidate.messageKey);
      if (translated) {
        const hint = formatDiagnosticHints(candidate.details?.missingByKind);
        return hint ? `${translated} (${hint})` : translated;
      }
    }
    if (typeof candidate.message === "string") {
      return studyErrorMessageForKey(candidate.message) ?? fallback;
    }
  }

  return fallback;
}
