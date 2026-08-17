import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CitationChips } from '../components/common/CitationChips';
import { RagCitation } from '../types/rag';

describe('CitationChips Component', () => {
  const citations: RagCitation[] = [
    {
      documentId: 'doc-100',
      chunkId: 'chunk-1',
      quote: 'Active recall strengthens synaptic connections.',
      locator: { type: 'pdf', page: 42 },
      score: 0.95,
    },
    {
      documentId: 'doc-200',
      chunkId: 'chunk-2',
      quote: 'Spacing intervals prevent retrieval exhaustion.',
      locator: { type: 'video', timestampSeconds: 154 },
      score: 0.88,
    },
  ];

  it('renders citation chips with correct page/timestamp labels', () => {
    render(<CitationChips citations={citations} />);

    expect(screen.getByText(/\[1\] p\. 42/)).toBeDefined();
    expect(screen.getByText(/\[2\] 2:34/)).toBeDefined();
  });

  it('returns null when citations array is empty', () => {
    const { container } = render(<CitationChips citations={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
