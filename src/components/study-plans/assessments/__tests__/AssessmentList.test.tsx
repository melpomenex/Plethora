import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssessmentList } from '../AssessmentList';
import { BlueprintService } from '../../../../lib/study-plans/assessments/blueprintService';
import type { BlueprintSummary } from '../../../../types/assessmentQuestions';

const blueprint: BlueprintSummary = {
  id: 'bp-1',
  planId: 'plan-1',
  title: 'Practice assessment',
  lifecycle: 'active',
  currentRevisionId: 'revision-1',
  currentRevision: 3,
  state: 'ready',
  mode: 'practice',
  questionCount: 4,
  updatedAt: '2026-11-01T00:00:00Z',
};

let listBlueprintCalls = 0;

beforeEach(() => {
  listBlueprintCalls = 0;
  vi.spyOn(BlueprintService, 'listBlueprints').mockImplementation(async () => {
    listBlueprintCalls += 1;
    return [blueprint];
  });
  vi.spyOn(BlueprintService, 'archiveBlueprint').mockResolvedValue();
  vi.spyOn(BlueprintService, 'deleteUnusedBlueprint').mockResolvedValue();
});

afterEach(() => {
  fireEvent.keyDown(document, { key: 'Escape' });
  cleanup();
  vi.restoreAllMocks();
});

describe('AssessmentList context menu', () => {
  it('opens actions for the clicked assessment without opening it on right-click', async () => {
    const onSelectBlueprint = vi.fn();
    render(<AssessmentList onSelectBlueprint={onSelectBlueprint} onCreateNew={vi.fn()} />);

    const card = (await screen.findByText('Practice assessment')).closest('[tabindex="0"]')!;
    fireEvent.contextMenu(card);
    expect(onSelectBlueprint).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete unused assessment' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open' }));
    expect(onSelectBlueprint).toHaveBeenCalledWith('bp-1', 'revision-1');
  });

  it('routes Archive through the existing handler and reloads the assessment list', async () => {
    render(<AssessmentList onSelectBlueprint={vi.fn()} onCreateNew={vi.fn()} />);
    const card = (await screen.findByText('Practice assessment')).closest('[tabindex="0"]')!;
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));

    await waitFor(() => {
      expect(BlueprintService.archiveBlueprint).toHaveBeenCalledWith('bp-1', 3);
      expect(listBlueprintCalls).toBe(2);
    });
  });

  it('routes Delete unused assessment through the guarded delete handler and reloads', async () => {
    const onSelectBlueprint = vi.fn();
    render(<AssessmentList onSelectBlueprint={onSelectBlueprint} onCreateNew={vi.fn()} />);
    const card = (await screen.findByText('Practice assessment')).closest('[tabindex="0"]')!;
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete unused assessment' }));

    await waitFor(() => {
      expect(BlueprintService.deleteUnusedBlueprint).toHaveBeenCalledWith('bp-1', 3);
      expect(listBlueprintCalls).toBe(2);
    });
    expect(onSelectBlueprint).not.toHaveBeenCalled();
  });

  it('keeps a localized fallback visible when a menu action fails', async () => {
    vi.mocked(BlueprintService.archiveBlueprint).mockRejectedValueOnce(new Error('Archive failed'));
    render(<AssessmentList onSelectBlueprint={vi.fn()} onCreateNew={vi.fn()} />);
    const card = (await screen.findByText('Practice assessment')).closest('[tabindex="0"]')!;
    fireEvent.contextMenu(card);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Archive' }));

    expect(await screen.findByText(/that action could not be completed/i)).toBeInTheDocument();
    expect(listBlueprintCalls).toBe(1);
  });
});
