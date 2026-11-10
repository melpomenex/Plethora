import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { SourceScopePicker } from '../SourceScopePicker';
import * as docApi from '../../../api/documents';
import type { SelectedSourceScope } from '../../../types/studySource';

vi.mock('../../../api/documents', () => ({
  getDocuments: vi.fn(),
}));

describe('SourceScopePicker', () => {
  const mockDocs = [
    { id: 'doc_1', title: 'Calculus Early Transcendentals' },
    { id: 'doc_2', title: 'Linear Algebra Done Right' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders documents and toggles selection', async () => {
    vi.mocked(docApi.getDocuments).mockResolvedValue(mockDocs as any);
    const onChange = vi.fn();
    const selectedScope: SelectedSourceScope = {
      documentIds: [],
      extractIds: [],
      collectionIds: [],
      tagIds: [],
    };

    render(
      <SourceScopePicker
        selectedScope={selectedScope}
        onChange={onChange}
        maxDocuments={24}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('Calculus Early Transcendentals')).toBeInTheDocument();
    });

    // Click on Calculus
    fireEvent.click(screen.getByText('Calculus Early Transcendentals'));
    expect(onChange).toHaveBeenCalledWith({
      documentIds: ['doc_1'],
      extractIds: [],
      collectionIds: [],
      tagIds: [],
    });
  });

  it('enforces maxDocuments bound with alert notice', async () => {
    vi.mocked(docApi.getDocuments).mockResolvedValue(mockDocs as any);
    const onChange = vi.fn();
    const selectedScope: SelectedSourceScope = {
      documentIds: ['doc_1'],
      extractIds: [],
      collectionIds: [],
      tagIds: [],
    };

    render(
      <SourceScopePicker
        selectedScope={selectedScope}
        onChange={onChange}
        maxDocuments={1} // Cap at 1 for test
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/maximum 1 source documents reached/i);
    });

    // Clicking doc_2 while at limit should not add it
    fireEvent.click(screen.getByText('Linear Algebra Done Right'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders empty library notice when library has no documents', async () => {
    vi.mocked(docApi.getDocuments).mockResolvedValue([]);
    const onChange = vi.fn();

    render(
      <SourceScopePicker
        selectedScope={{ documentIds: [], extractIds: [], collectionIds: [], tagIds: [] }}
        onChange={onChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/no material in library/i)).toBeInTheDocument();
    });
  });
});
