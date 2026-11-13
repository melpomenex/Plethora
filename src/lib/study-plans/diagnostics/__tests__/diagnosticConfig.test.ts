import { describe, expect, it } from 'vitest';
import { buildPlanDiagnosticConfig, validateDiagnosticConfig } from '../diagnosticConfig';

describe('diagnostic config (lesson 2.3)', () => {
  it('builds a 6-item no-timer diagnostic for a library plan', () => {
    const config = buildPlanDiagnosticConfig({
      version: { knowledgeAuthority: { kind: 'library', policy: 'source-only' } },
    });
    expect(config.mode).toBe('diagnostic');
    expect(config.requestedCount).toBe(6);
    expect(config.timeLimitSeconds).toBeNull();
    expect(config.knowledgePolicy).toBe('source-only');
    expect(validateDiagnosticConfig(config).ok).toBe(true);
  });

  it('uses the unverified self-check policy for model-only plans', () => {
    const config = buildPlanDiagnosticConfig({
      version: { knowledgeAuthority: { kind: 'model-only' } },
    });
    expect(config.knowledgePolicy).toBe('model-only');
    expect(validateDiagnosticConfig(config).ok).toBe(true);
  });
});
