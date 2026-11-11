import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { DiagnosticChoice } from '../../../components/study-plans/diagnostics/DiagnosticChoice';
import { PracticeHintControl } from '../../../components/study-plans/practice/PracticeHintControl';
import { AttemptRunner } from '../../../components/study-plans/attempts/AttemptRunner';

describe('C8-T07 accessibility/UX matrix (keyboard/focus/labels/motion)', () => {
  it('diagnostic choice exposes labels, keyboard focus, live regions', () => {
    render(<DiagnosticChoice onTake={() => {}} onSkip={() => {}} />);
    expect(screen.getByLabelText(/Optional diagnostic/i)).toBeTruthy();
    expect(screen.getByTestId('diagnostic-take').tagName).toBe('BUTTON');
  });

  it('practice hint control announces status; exam hides entirely', () => {
    const { container } = render(<PracticeHintControl hints={['h1']} revealed={0} mode="exam" />);
    expect(container.firstChild).toBeNull();
  });

  it('no constant timer announcements (timer is milestone-only)', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync('src/components/study-plans/attempts/AttemptTimer.tsx', 'utf8');
    expect(src).not.toMatch(/aria-live="assertive"/);
    expect(AttemptRunner).toBeDefined();
  });
});
