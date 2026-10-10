export interface ParsedAssistantThinking {
  answer: string;
  thinking: string;
  hasThinking: boolean;
  hasPendingDelimiter: boolean;
}

const OPEN_THINK = "<think>";
const CLOSE_THINK = "</think>";

function possibleDelimiterSuffixLength(value: string, delimiter: string): number {
  const max = Math.min(value.length, delimiter.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (value.endsWith(delimiter.slice(0, length))) return length;
  }
  return 0;
}

/**
 * Separates Ollama-style thinking tags from an assistant response. Set
 * Incomplete delimiter prefixes stay buffered instead of leaking into the
 * transcript, including when a response ends before the delimiter completes.
 */
export function parseAssistantThinking(value: string): ParsedAssistantThinking {
  let answer = "";
  let thinking = "";
  let inThinking = false;
  let hasThinking = false;
  let hasPendingDelimiter = false;

  for (let index = 0; index < value.length;) {
    if (!inThinking && value.startsWith(OPEN_THINK, index)) {
      if (thinking.length > 0) thinking += "\n\n";
      inThinking = true;
      hasThinking = true;
      index += OPEN_THINK.length;
      continue;
    }

    if (inThinking && value.startsWith(CLOSE_THINK, index)) {
      inThinking = false;
      index += CLOSE_THINK.length;
      continue;
    }

    // A stray closing marker is malformed output; never display the control tag.
    if (!inThinking && value.startsWith(CLOSE_THINK, index)) {
      index += CLOSE_THINK.length;
      continue;
    }

    const delimiter = inThinking ? CLOSE_THINK : OPEN_THINK;
    const remaining = value.slice(index);
    if (delimiter.startsWith(remaining) && remaining.length < delimiter.length) {
      hasPendingDelimiter = true;
      hasThinking ||= inThinking || delimiter === OPEN_THINK;
      break;
    }

    const partialLength = possibleDelimiterSuffixLength(remaining, delimiter);
    if (partialLength > 0) {
      hasPendingDelimiter = true;
      hasThinking ||= inThinking || delimiter === OPEN_THINK;
      const visible = remaining.slice(0, -partialLength);
      if (inThinking) thinking += visible;
      else answer += visible;
      break;
    }

    if (inThinking) thinking += value[index];
    else answer += value[index];
    index += 1;
  }

  if (inThinking) hasThinking = true;
  return { answer, thinking, hasThinking, hasPendingDelimiter };
}

/** Gets answer-only content for copy, history, and prompt context. */
export function getAssistantAnswer(value: string): string {
  return parseAssistantThinking(value).answer;
}
