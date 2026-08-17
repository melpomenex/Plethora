import { describe, it, expect } from 'vitest';
import { evaluateStoreReadiness } from '../storeReleaseReadiness';

describe('Store Release Readiness & Policy Compliance', () => {
  it('evaluates iOS store build compliance', () => {
    const report = evaluateStoreReadiness('ios', 'store');
    expect(report.isStoreCompliant).toBe(true);
    expect(report.selfUpdaterDisabled).toBe(true);
    expect(report.inAppAccountDeletionSupported).toBe(true);
    expect(report.dataSafetyAnswers.canUsersRequestDeletion).toBe(true);
    expect(report.policyNotes.some((n) => n.includes('Guideline 5.1.1(v)'))).toBe(true);
  });

  it('evaluates Android Play store build compliance', () => {
    const report = evaluateStoreReadiness('android', 'store');
    expect(report.isStoreCompliant).toBe(true);
    expect(report.selfUpdaterDisabled).toBe(true);
    expect(report.dataSafetyAnswers.isEncryptedInTransit).toBe(true);
    expect(report.policyNotes.some((n) => n.includes('REQUEST_INSTALL_PACKAGES'))).toBe(true);
  });

  it('permits self-updater on desktop sideload builds', () => {
    const report = evaluateStoreReadiness('desktop', 'sideload');
    expect(report.selfUpdaterDisabled).toBe(false);
  });
});
