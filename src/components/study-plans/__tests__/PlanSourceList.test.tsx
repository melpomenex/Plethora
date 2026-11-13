import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PlanSourceList } from '../PlanSourceList';
import type { StudySourceResolution } from '../../../types/studySource';

const sourceOne = { status: 'current', ref: { documentTitle: 'First source', excerpt: 'First excerpt' } } as unknown as StudySourceResolution;
const sourceTwo = { status: 'current', ref: { documentTitle: 'Second source', excerpt: 'Second excerpt' } } as unknown as StudySourceResolution;
const missingSource = { status: 'missing', ref: { documentTitle: 'Missing source' } } as unknown as StudySourceResolution;

afterEach(() => {
  fireEvent.keyDown(document, { key: 'Escape' });
  cleanup();
});

describe('PlanSourceList context menu', () => {
  it('opens the clicked plan-wide source and does not offer topic unlinking', () => {
    const onOpenSource = vi.fn();
    render(
      <PlanSourceList
        sourceRefIds={['source-1', 'source-2']}
        sourceResolutions={{ 'source-1': sourceOne, 'source-2': sourceTwo }}
        onOpenSource={onOpenSource}
        isReadOnly
      />
    );

    const row = screen.getByText('Second source').closest('[tabindex="0"]')!;
    fireEvent.contextMenu(row);
    expect(onOpenSource).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Open source' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Remove link' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Open source' }));
    expect(onOpenSource).toHaveBeenCalledTimes(1);
    expect(onOpenSource).toHaveBeenCalledWith('source-2', sourceTwo);
  });

  it('removes only the clicked topic source when the draft is editable', () => {
    const onOpenSource = vi.fn();
    const onRemoveSource = vi.fn();
    render(
      <PlanSourceList
        sourceRefIds={['source-1', 'source-2']}
        sourceResolutions={{ 'source-1': sourceOne, 'source-2': sourceTwo }}
        onOpenSource={onOpenSource}
        onRemoveSource={onRemoveSource}
      />
    );

    const row = screen.getByText('Second source').closest('[tabindex="0"]')!;
    fireEvent.contextMenu(row);
    expect(screen.getByRole('menuitem', { name: 'Remove link' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove link' }));
    expect(onRemoveSource).toHaveBeenCalledTimes(1);
    expect(onRemoveSource).toHaveBeenCalledWith('source-2');
    expect(onOpenSource).not.toHaveBeenCalled();
  });

  it('omits Open source when the linked document is missing', () => {
    render(
      <PlanSourceList
        sourceRefIds={['missing']}
        sourceResolutions={{ missing: missingSource }}
        onOpenSource={vi.fn()}
        onRemoveSource={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByText('Missing source').closest('[tabindex="0"]')!);
    expect(screen.queryByRole('menuitem', { name: 'Open source' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove link' })).toBeInTheDocument();
  });
});
