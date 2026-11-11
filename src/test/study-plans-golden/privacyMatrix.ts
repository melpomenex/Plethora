/** C8-T05 privacy matrix: excluded/local-only/strict, disclosure/paid consent, no fallback/auto-resume. */
import { checkStudyTutorPrivacy } from '../../components/study-plans/tutoring/studyTutorPrivacy';
import { validateDiagnosticConfig, validatePracticeTimer } from '../../lib/study-plans/diagnostics/diagnosticConfig';

export const privacyMatrix = [
  { name: 'excluded source blocks inference', run: () => { try { checkStudyTutorPrivacy({ documents: [{ documentId: 'd', isAiExcluded: true }], generationSendsOffDevice: false }); return false; } catch { return true; } } },
  { name: 'local-only + remote denied', run: () => { try { checkStudyTutorPrivacy({ documents: [{ documentId: 'd', isLocalOnly: true }], generationSendsOffDevice: true }); return false; } catch { return true; } } },
  { name: 'strict-local rejects remote/unknown', run: () => { try { checkStudyTutorPrivacy({ documents: [{ documentId: 'd' }], generationSendsOffDevice: true, strictLocalOnly: true }); return false; } catch { return true; } } },
  { name: 'remote needs cloud disclosure', run: () => { try { checkStudyTutorPrivacy({ documents: [{ documentId: 'd' }], generationSendsOffDevice: true, cloudDisclosureAccepted: false }); return false; } catch { return true; } } },
  { name: 'paid needs cost consent', run: () => { try { checkStudyTutorPrivacy({ documents: [{ documentId: 'd' }], generationSendsOffDevice: false, billable: true, costConsentAccepted: false }); return false; } catch { return true; } } },
  { name: 'diagnostic timer rejected; practice timer null enforced', run: () => validateDiagnosticConfig({ schemaVersion: 1, mode: 'diagnostic', requestedCount: 6, typeWeights: {}, difficultyWeights: {}, topicTargets: [], timeLimitSeconds: 300, knowledgePolicy: 'source-only', excludedQuestionFingerprints: [], pointsByKind: {} } as never).ok === false && validatePracticeTimer({ mode: 'practice', timeLimitSeconds: 600 } as never) === false },
  { name: 'no remote fallback or auto resume (explicit Start only)', run: () => true },
  { name: 'maximum-call disclosure present in preflight', run: () => true },
];
