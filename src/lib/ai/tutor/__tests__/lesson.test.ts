import { describe, it, expect } from 'vitest';
import {
  createLessonSession,
  advanceLessonStage,
  LessonSession,
} from '../lesson';

describe('Teach Me Adaptive Socratic Tutoring', () => {
  it('initializes a lesson session with diagnostic stage', () => {
    const session = createLessonSession({
      topic: 'Virtual Memory Paging',
      conceptId: 'concept-paging',
      initialLevelHint: 'intermediate',
    });

    expect(session.topic).toBe('Virtual Memory Paging');
    expect(session.currentStage).toBe('diagnose');
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0].role).toBe('tutor');
    expect(session.isComplete).toBe(false);
  });

  it('progresses through explanation, analogy, example, and check stages', () => {
    let session = createLessonSession({ topic: 'Synaptic Plasticity' });

    session = advanceLessonStage(session);
    expect(session.currentStage).toBe('explain');

    session = advanceLessonStage(session);
    expect(session.currentStage).toBe('analogy');

    session = advanceLessonStage(session);
    expect(session.currentStage).toBe('example');

    session = advanceLessonStage(session);
    expect(session.currentStage).toBe('check');

    session = advanceLessonStage(session);
    expect(session.currentStage).toBe('evaluate');
  });

  it('routes to remediation when a misconception is detected in evaluate stage', () => {
    let session = createLessonSession({ topic: 'Paging' });
    session = { ...session, currentStage: 'evaluate' };

    session = advanceLessonStage(session, {
      isCorrect: false,
      misconception: 'Confused virtual page number with physical frame offset',
      feedback: 'Page numbers index the page table, whereas offsets index within the page.',
    });

    expect(session.currentStage).toBe('remediate');
    expect(session.detectedMisconceptions).toContain(
      'Confused virtual page number with physical frame offset'
    );
  });
});
