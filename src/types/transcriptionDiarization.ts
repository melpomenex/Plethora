import type { Document } from './document';

export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

export interface DiarizedSegment {
  id: string;
  startSeconds: number;
  endSeconds: number;
  text: string;
  speaker: string;
  wordTimings?: WordTiming[];
}

export interface DiarizedTranscript {
  mediaId: string;
  title: string;
  durationSeconds: number;
  segments: DiarizedSegment[];
}

/**
 * Transforms a diarized transcript into a structured Markdown document representation,
 * embedding speaker headings and timestamp anchors so they can be cited and highlighted.
 */
export function convertDiarizedTranscriptToMarkdown(transcript: DiarizedTranscript): string {
  const lines: string[] = [`# ${transcript.title}`, ''];

  let currentSpeaker: string | null = null;
  let currentParagraph = '';

  for (const seg of transcript.segments) {
    const timeFormatted = formatSeconds(seg.startSeconds);
    if (seg.speaker !== currentSpeaker) {
      if (currentParagraph) {
        lines.push(currentParagraph);
        lines.push('');
        currentParagraph = '';
      }
      currentSpeaker = seg.speaker;
      lines.push(`### Speaker: ${currentSpeaker} (${timeFormatted})`);
    }

    if (currentParagraph) {
      currentParagraph += ` ${seg.text}`;
    } else {
      currentParagraph = seg.text;
    }
  }

  if (currentParagraph) {
    lines.push(currentParagraph);
    lines.push('');
  }

  return lines.join('\n');
}

function formatSeconds(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
