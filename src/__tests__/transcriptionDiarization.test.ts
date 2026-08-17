import { describe, it, expect } from 'vitest';
import {
  DiarizedTranscript,
  convertDiarizedTranscriptToMarkdown,
} from '../types/transcriptionDiarization';

describe('Transcription Diarization & Document Generation', () => {
  it('converts diarized transcript segments into structured Markdown with speaker headings and timestamps', () => {
    const transcript: DiarizedTranscript = {
      mediaId: 'video-101',
      title: 'Neural Networks and Deep Learning Lecture',
      durationSeconds: 150,
      segments: [
        {
          id: 'seg-1',
          startSeconds: 0,
          endSeconds: 15,
          speaker: 'Prof. Hinton',
          text: 'Welcome everyone to our lecture on backpropagation.',
        },
        {
          id: 'seg-2',
          startSeconds: 16,
          endSeconds: 45,
          speaker: 'Prof. Hinton',
          text: 'Today we will discuss gradient descent in high-dimensional error landscapes.',
        },
        {
          id: 'seg-3',
          startSeconds: 50,
          endSeconds: 65,
          speaker: 'Student Alice',
          text: 'Does momentum help avoid local minima or saddle points?',
        },
        {
          id: 'seg-4',
          startSeconds: 66,
          endSeconds: 95,
          speaker: 'Prof. Hinton',
          text: 'Momentum primarily accelerates past saddle points and dampens oscillations.',
        },
      ],
    };

    const markdown = convertDiarizedTranscriptToMarkdown(transcript);

    expect(markdown).toContain('# Neural Networks and Deep Learning Lecture');
    expect(markdown).toContain('### Speaker: Prof. Hinton (0:00)');
    expect(markdown).toContain('Welcome everyone to our lecture on backpropagation.');
    expect(markdown).toContain('### Speaker: Student Alice (0:50)');
    expect(markdown).toContain('Does momentum help avoid local minima or saddle points?');
  });
});
