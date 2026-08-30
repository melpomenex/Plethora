export interface AudioChapterBoundsInput {
  title: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

export interface AudioChapterBounds {
  title: string;
  startTime: number;
  endTime: number;
}

/**
 * Fill the missing end of audiobook chapters from the next chapter or the
 * media duration. ffmetadata legitimately omits the final chapter end (and
 * chapterless files are represented as one chapter starting at zero), but the
 * alignment engine needs finite bounds to select transcript words.
 */
export function normalizeAudioChapterBounds(
  chapters: AudioChapterBoundsInput[],
  mediaDuration = 0,
): AudioChapterBounds[] {
  const finiteDuration = Number.isFinite(mediaDuration) && mediaDuration > 0
    ? mediaDuration
    : 0;

  return chapters.map((chapter, index) => {
    const startTime = Number.isFinite(chapter.startTime) && chapter.startTime >= 0
      ? chapter.startTime
      : 0;
    const nextStart = chapters[index + 1]?.startTime;
    const inferredEnd =
      Number.isFinite(chapter.endTime) && (chapter.endTime as number) > startTime
        ? chapter.endTime as number
        : Number.isFinite(nextStart) && (nextStart as number) > startTime
          ? nextStart as number
          : finiteDuration > startTime
            ? finiteDuration
            : Number.isFinite(chapter.duration) && (chapter.duration as number) > 0
              ? startTime + (chapter.duration as number)
              : startTime + 1;

    return {
      title: chapter.title,
      startTime,
      endTime: Math.max(inferredEnd, startTime + 0.001),
    };
  });
}
