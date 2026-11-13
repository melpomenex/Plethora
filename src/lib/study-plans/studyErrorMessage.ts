import { StudyApiError } from '../../api/study-plans';
import { t } from '../i18n';

export function studyErrorMessageForKey(messageKey: string): string | undefined {
  const translated = t(messageKey);
  return translated === messageKey ? undefined : translated;
}

export function studyErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof StudyApiError) {
    return studyErrorMessageForKey(error.messageKey) ?? fallback;
  }

  if (typeof error === "string") {
    return studyErrorMessageForKey(error) ?? fallback;
  }

  if (error && typeof error === "object") {
    const candidate = error as { messageKey?: unknown; message?: unknown };
    if (typeof candidate.messageKey === "string") {
      const translated = studyErrorMessageForKey(candidate.messageKey);
      if (translated) return translated;
    }
    if (typeof candidate.message === "string") {
      return studyErrorMessageForKey(candidate.message) ?? fallback;
    }
  }

  return fallback;
}
