/**
 * Curriculum draft preview attribution tests.
 *
 * Verifies claim-level attribution labels (verified library evidence vs
 * unverified model output vs AI supplement) and clickable exact-reference
 * chips that hand navigation to the host.
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CurriculumDraftPreview } from '../CurriculumDraftPreview';
import type { StudyPlanDetail } from '../../../types/learningPaths';
import type { StudySourceResolution } from '../../../types/studySource';

function currentResolution(jump?: unknown): StudySourceResolution {
  return {
    status: 'current',
    navigation: 'exact',
    ref: {
      schemaVersion: 1,
      id: 'ssr_1',
      documentId: 'doc_1',
      excerpt: 'Passage that supports the claim.',
      revision: 'rev_1',
      revisionKind: 'content-hash',
      excerptSha256: 'hash',
      documentTitle: 'The PDF',
      sourceType: 'pdf',
      capturedAt: '2026-11-12T00:00:00Z',
      jump: jump as never,
    },
  };
}

function basePlan(overrides: Partial<StudyPlanDetail['version']> = {}): StudyPlanDetail {
  return {
    plan: {
      id: 'sp_1', title: 'Plan', goal: 'Goal', depth: 'survey', status: 'active',
      currentVersionId: null, currentVersion: 0, draftVersionId: 'spv_1', revision: 1,
      createdAt: '2026-11-12T00:00:00Z', updatedAt: '2026-11-12T00:00:00Z',
    },
    version: {
      id: 'spv_1', planId: 'sp_1', version: 1, state: 'draft', baseVersionId: null,
      sourceScope: undefined,
      knowledgeAuthority: { kind: 'model-only' },
      nodes: [
        {
          nodeId: 'spn_1', title: 'Topic A', summary: 'Summary', learningObjectives: ['Obj'],
          conceptId: null, conceptLabel: 'A', position: 0, included: true, locked: false,
          userAdded: false, userModified: false, materialSupport: 'unsupported',
          whyHere: 'Reason', sourceRefIds: [],
        },
      ],
      prerequisites: [],
      changeSummary: null, createdBy: 'ai', createdAt: '2026-11-12T00:00:00Z', publishedAt: null,
      ...overrides,
    },
    activityByNodeId: {},
    sourceRefs: {},
  };
}

describe('CurriculumDraftPreview claim attribution', () => {
  it('labels model-only output as unverified without clickable source chips', () => {
    render(
      <CurriculumDraftPreview planDetail={basePlan()} onAccept={() => {}} onDiscard={() => {}} />
    );
    expect(screen.getByText('Unverified model output')).toBeInTheDocument();
    expect(screen.getByText('AI Knowledge Only')).toBeInTheDocument();
    expect(screen.queryByText(/source reference/)).not.toBeInTheDocument();
  });

  it('labels verified library evidence and opens exact references on click', () => {
    const onOpenSource = vi.fn();
    const planDetail = basePlan({
      sourceScope: {
        schemaVersion: 1,
        selected: { documentIds: ['doc_1'], extractIds: [], collectionIds: [], tagIds: [] },
        resolvedDocuments: [{ documentId: 'doc_1', title: 'The PDF', sourceType: 'pdf', revision: 'rev_1', revisionKind: 'content-hash', extractIds: [], isAiExcluded: false, isLocalOnly: false }],
        frozenAt: '2026-11-12T00:00:00Z',
        indexCompleteness: 'complete',
        limitations: [],
      },
      knowledgeAuthority: { kind: 'library', policy: 'source-only' },
      nodes: [
        {
          nodeId: 'spn_1', title: 'Topic A', summary: 'Summary', learningObjectives: ['Obj'],
          conceptId: null, conceptLabel: 'A', position: 0, included: true, locked: false,
          userAdded: false, userModified: false, materialSupport: 'grounded',
          whyHere: null, sourceRefIds: ['ssr_1'],
        },
      ],
    });
    render(
      <CurriculumDraftPreview
        planDetail={{ ...planDetail, sourceRefs: { ssr_1: currentResolution({ pdf: { page: 42, quote: 'Passage that supports the claim.' } }) } }}
        onAccept={() => {}}
        onDiscard={() => {}}
        onOpenSource={onOpenSource}
      />
    );
    expect(screen.getByText('Verified library evidence')).toBeInTheDocument();
    expect(screen.getByText('Library Only')).toBeInTheDocument();
    const exactChip = screen.getByRole('button', { name: 'Exact' });
    fireEvent.click(exactChip);
    expect(onOpenSource).toHaveBeenCalledWith('ssr_1');
  });

  it('shows a video timestamp reference as clickable exact navigation', () => {
    const onOpenSource = vi.fn();
    const planDetail = basePlan({
      sourceScope: {
        schemaVersion: 1,
        selected: { documentIds: ['doc_v'], extractIds: [], collectionIds: [], tagIds: [] },
        resolvedDocuments: [{ documentId: 'doc_v', title: 'Talk', sourceType: 'video', revision: 'rev_v', revisionKind: 'content-hash', extractIds: [], isAiExcluded: false, isLocalOnly: false }],
        frozenAt: '2026-11-12T00:00:00Z',
        indexCompleteness: 'complete',
        limitations: [],
      },
      knowledgeAuthority: { kind: 'library', policy: 'source-plus-model-knowledge' },
      nodes: [
        {
          nodeId: 'spn_1', title: 'Topic A', summary: 'Summary', learningObjectives: ['Obj'],
          conceptId: null, conceptLabel: 'A', position: 0, included: true, locked: false,
          userAdded: false, userModified: false, materialSupport: 'grounded',
          whyHere: null, sourceRefIds: ['ssr_v'],
        },
      ],
    });
    render(
      <CurriculumDraftPreview
        planDetail={{ ...planDetail, sourceRefs: { ssr_v: currentResolution({ video: { seconds: 125.5 } }) } }}
        onAccept={() => {}}
        onDiscard={() => {}}
        onOpenSource={onOpenSource}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Exact' }));
    expect(onOpenSource).toHaveBeenCalledWith('ssr_v');
  });

  it('marks unsupported prerequisite edges in mixed mode', () => {
    const planDetail = basePlan({
      knowledgeAuthority: { kind: 'library', policy: 'source-plus-model-knowledge' },
      nodes: [
        {
          nodeId: 'spn_1', title: 'Prereq', summary: 'Summary', learningObjectives: ['Obj'],
          conceptId: null, conceptLabel: 'A', position: 0, included: true, locked: false,
          userAdded: false, userModified: false, materialSupport: 'unsupported',
          whyHere: null, sourceRefIds: [],
        },
        {
          nodeId: 'spn_2', title: 'Dependent', summary: 'Summary', learningObjectives: ['Obj'],
          conceptId: null, conceptLabel: 'B', position: 1, included: true, locked: false,
          userAdded: false, userModified: false, materialSupport: 'unsupported',
          whyHere: null, sourceRefIds: [],
        },
      ],
      prerequisites: [
        { prerequisiteNodeId: 'spn_1', dependentNodeId: 'spn_2', support: 'unsupported', rationale: null, sourceRefIds: [] },
      ],
    });
    render(
      <CurriculumDraftPreview planDetail={planDetail} onAccept={() => {}} onDiscard={() => {}} />
    );
    expect(screen.getAllByText('AI supplement · unverified')).toHaveLength(2);
    expect(screen.getByText('Unsupported')).toBeInTheDocument();
  });
});
