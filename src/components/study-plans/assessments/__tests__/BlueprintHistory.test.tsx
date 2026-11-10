import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { BlueprintHistory, type BlueprintRevisionSummary } from '../BlueprintHistory';

describe('BlueprintHistory Component (C3-T09)', () => {
  const mockRevisions: BlueprintRevisionSummary[] = [
    {
      id: 'abr_2',
      blueprintId: 'ab_1',
      revision: 2,
      state: 'draft',
      mode: 'exam',
      questionCount: 5,
      requestedCount: 10,
      createdAt: '2026-11-10T21:00:00Z',
      publishedAt: null,
      shortfallAccepted: false,
    },
    {
      id: 'abr_1',
      blueprintId: 'ab_1',
      revision: 1,
      state: 'ready',
      mode: 'exam',
      questionCount: 10,
      requestedCount: 10,
      createdAt: '2026-11-10T20:00:00Z',
      publishedAt: '2026-11-10T20:05:00Z',
      shortfallAccepted: false,
    },
  ];

  it('renders revision list and status badges', () => {
    const handleSelect = vi.fn();
    render(
      <BlueprintHistory
        revisions={mockRevisions}
        currentRevisionId="abr_2"
        onSelectRevision={handleSelect}
      />
    );

    expect(screen.getByText('Revision 2')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.getByText('Revision 1')).toBeInTheDocument();
    expect(screen.getByText(/Ready \/ Published/i)).toBeInTheDocument();
  });

  it('calls onSelectRevision when inspect/view button is clicked', () => {
    const handleSelect = vi.fn();
    render(
      <BlueprintHistory
        revisions={mockRevisions}
        currentRevisionId="abr_2"
        onSelectRevision={handleSelect}
      />
    );

    const inspectButtons = screen.getAllByRole('button', { name: /inspect/i });
    expect(inspectButtons.length).toBe(1); // One is "Viewing", one is "Inspect"
    fireEvent.click(inspectButtons[0]);

    expect(handleSelect).toHaveBeenCalledWith('abr_1');
  });

  it('calls onCopyAsDraft when copy button is clicked on ready revision', () => {
    const handleSelect = vi.fn();
    const handleCopy = vi.fn();
    render(
      <BlueprintHistory
        revisions={mockRevisions}
        currentRevisionId="abr_2"
        onSelectRevision={handleSelect}
        onCopyAsDraft={handleCopy}
      />
    );

    const copyButton = screen.getByRole('button', { name: /copy as new draft/i });
    expect(copyButton).toBeInTheDocument();
    fireEvent.click(copyButton);

    expect(handleCopy).toHaveBeenCalledWith('abr_1');
  });

  it('handles empty revision list gracefully', () => {
    const handleSelect = vi.fn();
    render(
      <BlueprintHistory
        revisions={[]}
        currentRevisionId={null}
        onSelectRevision={handleSelect}
      />
    );

    expect(screen.getByText(/No revision history available/i)).toBeInTheDocument();
  });
});
