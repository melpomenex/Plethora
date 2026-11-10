import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { BlueprintQuotaControls } from '../BlueprintQuotaControls';
import type { AssessmentConfigV1 } from '../../../../types/assessmentQuestions';

describe('BlueprintQuotaControls', () => {
  const baseConfig: AssessmentConfigV1 = {
    schemaVersion: 1,
    mode: 'exam',
    requestedCount: 10,
    typeWeights: {
      'single-select': 4,
      'multi-select': 2,
      cloze: 2,
      'short-answer': 2,
      essay: 0,
    },
    difficultyWeights: { 1: 2, 2: 4, 3: 4, 4: 0, 5: 0 },
    topicTargets: [{ nodeId: 'n1', conceptId: 'c1', weight: 1 }],
    timeLimitSeconds: 1800,
    knowledgePolicy: 'source-only',
    excludedQuestionFingerprints: [],
    pointsByKind: {
      'single-select': 1,
      'multi-select': 1,
      cloze: 1,
      'short-answer': 2,
      essay: 8,
    },
  };

  it('renders quota controls, sliders, and live normalized preview', () => {
    const handleChange = vi.fn();
    render(<BlueprintQuotaControls config={baseConfig} onChange={handleChange} />);

    expect(screen.getByText(/Total Questions Quota: 10/i)).toBeInTheDocument();
    expect(screen.getByText('Examination')).toBeInTheDocument();
    expect(screen.getByText('Practice')).toBeInTheDocument();

    // Check type weights display and normalized preview allocation
    expect(screen.getByText(/Single Choice/i)).toBeInTheDocument();
    expect(screen.getByText('Allocated: 4 questions')).toBeInTheDocument();

    // Change quota count
    const countSlider = screen.getByLabelText('Question count slider');
    fireEvent.change(countSlider, { target: { value: '20' } });
    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedCount: 20,
      })
    );
  });

  it('switches between Exam and Practice modes', () => {
    const handleChange = vi.fn();
    render(<BlueprintQuotaControls config={baseConfig} onChange={handleChange} />);

    const practiceBtn = screen.getByText('Practice');
    fireEvent.click(practiceBtn);

    expect(handleChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'practice',
        timeLimitSeconds: null,
      })
    );
  });
});
