import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { buildStudyTutorContext, buildStudyTutorMaterial } from '../studyTutorContext';
import { checkStudyTutorPrivacy } from '../studyTutorPrivacy';
import { StudyTutorHost } from '../StudyTutorHost';
import { TutorSheet } from '../../../tutor/TutorSheet';
import { TutorSession } from '../../../../lib/ai/tutor/session';

function ref(id: string, doc: string) {
  return { id, documentId: doc, excerpt: 'x', revision: 'r', documentTitle: 't', sourceType: 'pdf' } as never;
}

describe('C7-T04 source-scoped Study tutor', () => {
  it('builds context from current refs; empty/missing/unauthorized refuse', () => {
    const ctx = buildStudyTutorContext({
      planId: 'p',
      planVersionId: 'v',
      nodeId: 'n',
      sourceRefs: [ref('s1', 'd1'), ref('s2', 'd1')],
      objectives: ['O'],
    });
    expect(ctx.sourceDocumentIds).toEqual(['d1']);
    expect(ctx.sourceRefIds).toEqual(['s1', 's2']);
    expect(buildStudyTutorMaterial(ctx, { s1: 'excerpt one' })).toMatch(/excerpt one/);

    expect(() => buildStudyTutorContext({ planId: 'p', planVersionId: 'v', nodeId: 'n', sourceRefs: [] })).toThrow();
    expect(() =>
      buildStudyTutorContext({ planId: '', planVersionId: 'v', nodeId: 'n', sourceRefs: [ref('s1', 'd1')] }),
    ).toThrow();
    expect(() =>
      buildStudyTutorContext({
        planId: 'p',
        planVersionId: 'v',
        nodeId: 'n',
        sourceRefs: [ref('s1', 'd1')],
        authorizedDocumentIds: new Set(['d2']),
      }),
    ).toThrow();
  });

  it('privacy fails closed on excluded/local-only/remote without consent', () => {
    expect(() =>
      checkStudyTutorPrivacy({ documents: [{ documentId: 'd1', isAiExcluded: true }], generationSendsOffDevice: false }),
    ).toThrow('source_ai_excluded');
    expect(() =>
      checkStudyTutorPrivacy({ documents: [{ documentId: 'd1', isLocalOnly: true }], generationSendsOffDevice: true }),
    ).toThrow('privacy_denied');
    expect(() =>
      checkStudyTutorPrivacy({ documents: [{ documentId: 'd1' }], generationSendsOffDevice: true, cloudDisclosureAccepted: false }),
    ).toThrow('privacy_denied');
    expect(() =>
      checkStudyTutorPrivacy({ documents: [{ documentId: 'd1' }], generationSendsOffDevice: false, billable: true, costConsentAccepted: false }),
    ).toThrow('cost_consent_required');
    expect(() =>
      checkStudyTutorPrivacy({ documents: [{ documentId: 'd1' }], generationSendsOffDevice: true, cloudDisclosureAccepted: true }),
    ).not.toThrow();
  });

  it('Study Tutor opens with scoped retrieval; every retrieval filters documentIds; no global fallback', async () => {
    const seen: Array<{ filters?: { documentIds?: string[] } }> = [];
    const retrieveImpl = vi.fn(async (_q: string, opts: { k?: number; filters?: { documentIds?: string[] } }) => {
      seen.push({ filters: opts.filters });
      return { results: [], mode: 'lexicalOnly' } as never;
    });
    const startSpy = vi.spyOn(TutorSession, 'start').mockImplementation(async (config, runtime) => {
      await runtime.retrieve?.('drift query', { k: 3 });
      const session = { getTranscript: () => [], getPolicyState: () => ({ hintThread: { level: 0, consecutiveHints: 0 }, tutorTurnCount: 0, stuckCounter: 0, forcedExplain: false, ended: false }), limits: { maxSessionTurns: 20 }, ended: false } as never;
      return session as never;
    });

    render(
      <TutorSheet
        open
        material="material"
        topic="stable-topic"
        studyContext={{
          planId: 'p',
          planVersionId: 'v',
          nodeId: 'n',
          conceptId: 'c',
          gapId: 'g',
          sourceDocumentIds: ['OS-PDF', 'OS-VIDEO'],
          sourceRefIds: ['s1'],
          objectives: ['O'],
          misconception: null,
          evidenceSummary: 'e',
        }}
        retrieveImpl={retrieveImpl}
        onClose={() => {}}
      />,
    );
    await waitFor(() => expect(startSpy).toHaveBeenCalledTimes(1));
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) {
      expect(s.filters?.documentIds).toEqual(['OS-PDF', 'OS-VIDEO']);
    }
    // No prompt-text document id accepted as scoping: filters are actual arrays from context.
    startSpy.mockRestore();
  });

  it('missing source refuses with no transcript; non-Study callers retain defaults', async () => {
    render(
      <StudyTutorHost
        open
        planId="p"
        planVersionId="v"
        nodeId="n"
        sourceRefs={[]}
        onClose={() => {}}
      />,
    );
    expect(screen.getByTestId('study-tutor-refused')).toBeTruthy();

    // Non-Study host: no studyContext passes {} runtime (unchanged default).
    const startSpy = vi.spyOn(TutorSession, 'start').mockImplementation(async (_c, runtime) => {
      expect(runtime.retrieve).toBeUndefined();
      return { getTranscript: () => [], getPolicyState: () => ({ hintThread: { level: 0, consecutiveHints: 0 }, tutorTurnCount: 0, stuckCounter: 0, forcedExplain: false, ended: false }), limits: { maxSessionTurns: 20 }, ended: false } as never;
    });
    render(<TutorSheet open material="m" topic="t" onClose={() => {}} />);
    await waitFor(() => expect(startSpy).toHaveBeenCalled());
    startSpy.mockRestore();
  });
});
