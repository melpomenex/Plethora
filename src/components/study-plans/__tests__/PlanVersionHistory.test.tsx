import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlanVersionHistory, type PlanVersionSummary } from '../PlanVersionHistory';

const versions: PlanVersionSummary[] = [
  {
    id: 'version-current',
    version: 3,
    state: 'published',
    createdBy: 'user',
    createdAt: '2026-11-03T00:00:00Z',
    publishedAt: '2026-11-04T00:00:00Z',
    nodeCount: 4,
  },
  {
    id: 'version-old',
    version: 2,
    state: 'superseded',
    createdBy: 'user',
    createdAt: '2026-10-03T00:00:00Z',
    publishedAt: '2026-10-04T00:00:00Z',
    nodeCount: 3,
  },
];

afterEach(() => {
  fireEvent.keyDown(document, { key: 'Escape' });
  cleanup();
});

describe('PlanVersionHistory context menu', () => {
  it('does not open an empty menu for a current-only history with no copy action', () => {
    render(
      <PlanVersionHistory
        versions={[versions[0]]}
        activeVersionId="version-current"
        onSelectVersion={vi.fn()}
      />
    );

    const row = screen.getByText('Version 3').closest('[tabindex="0"]')!;
    fireEvent.contextMenu(row);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('offers View and Copy to draft only for an actionable historical version', () => {
    const onSelectVersion = vi.fn();
    const onCopyToDraft = vi.fn();
    render(
      <PlanVersionHistory
        versions={versions}
        activeVersionId="version-current"
        onSelectVersion={onSelectVersion}
        onCopyToDraft={onCopyToDraft}
        canCreateDraft
      />
    );

    const historicalRow = screen.getByText('Version 2').closest('[tabindex="0"]')!;
    fireEvent.contextMenu(historicalRow);
    expect(onSelectVersion).not.toHaveBeenCalled();
    expect(onCopyToDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'View' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy to draft' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy to draft' }));
    expect(onCopyToDraft).toHaveBeenCalledWith('version-old');
    expect(onSelectVersion).not.toHaveBeenCalled();
    expect(versions[1].state).toBe('superseded');

    fireEvent.contextMenu(historicalRow);
    fireEvent.click(screen.getByRole('menuitem', { name: 'View' }));
    expect(onSelectVersion).toHaveBeenCalledWith('version-old');
  });

  it('hides Copy to draft when the current plan state does not permit creating a draft', () => {
    render(
      <PlanVersionHistory
        versions={versions}
        activeVersionId="version-current"
        onSelectVersion={vi.fn()}
        onCopyToDraft={vi.fn()}
        canCreateDraft={false}
      />
    );

    fireEvent.contextMenu(screen.getByText('Version 2').closest('[tabindex="0"]')!);
    expect(screen.getByRole('menuitem', { name: 'View' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Copy to draft' })).not.toBeInTheDocument();
  });
});
