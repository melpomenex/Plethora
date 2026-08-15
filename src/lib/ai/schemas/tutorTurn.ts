/**
 * `TutorTurn` — structured envelope of a Socratic tutoring turn
 * (design D24 / ai-socratic-tutoring spec).
 */

import {
  checkBoolean,
  checkNumber,
  checkString,
  isRecord,
  valid,
  type ValidationOutcome,
} from "./common";

export const TUTOR_MOVES = ["question", "hint", "explain", "wrap-up"] as const;
export type TutorMove = (typeof TUTOR_MOVES)[number];

export const MAX_HINT_LEVEL = 3;

export interface TutorCardPromotion {
  question: string;
  answer: string;
}

export interface TutorTurn {
  move: TutorMove;
  content: string;
  /** Hint strength 0–3; only meaningful for `hint` moves. */
  hintLevel: number;
  stuckDetected: boolean;
  /** Card candidate the user may promote through the standard preview flow. */
  promoteToCard?: TutorCardPromotion;
}

export const TUTOR_TURN_SCHEMA = {
  name: "TutorTurn",
  nativeName: "tutorTurn",
  json: JSON.stringify({
    move: TUTOR_MOVES.join("|"),
    content: "string",
    hintLevel: "0-3",
    stuckDetected: "boolean",
    promoteToCard: { question: "string", answer: "string" },
  }),
} as const;

export function validateTutorTurn(output: unknown): ValidationOutcome<TutorTurn> {
  const errors: string[] = [];
  if (!isRecord(output)) {
    return { ok: false, errors: ["root: expected object"] };
  }

  // Near-miss normalization (device report: "promoteToCard: expected object"
  // — the model emitted the concept as a plain string). The promotion is
  // optional value-add: an unusable shape is dropped, never fatal.
  const source: Record<string, unknown> = { ...output };
  if (source.promoteToCard !== undefined) {
    const candidate = source.promoteToCard;
    const usable =
      isRecord(candidate) &&
      typeof candidate.question === "string" &&
      candidate.question.trim() !== "" &&
      typeof candidate.answer === "string" &&
      candidate.answer.trim() !== "";
    if (!usable) delete source.promoteToCard;
  }
  if (typeof source.hintLevel === "string" && /^-?\d+$/.test(source.hintLevel.trim())) {
    source.hintLevel = Number(source.hintLevel.trim());
  }

  const move = checkStringEnum(source.move, TUTOR_MOVES, "move", errors);
  const content = checkString(source.content, "content", errors, { maxLength: 4000 });
  const hintLevel = checkNumber(source.hintLevel, "hintLevel", errors, {
    min: 0,
    max: MAX_HINT_LEVEL,
    integer: true,
  });
  const stuckDetected = checkBoolean(source.stuckDetected, "stuckDetected", errors);

  let promoteToCard: TutorCardPromotion | undefined;
  if (source.promoteToCard !== undefined) {
    const candidate = source.promoteToCard as Record<string, unknown>;
    const question = checkString(candidate.question, "promoteToCard.question", errors, {
      maxLength: 2000,
    });
    const answer = checkString(candidate.answer, "promoteToCard.answer", errors, {
      maxLength: 2000,
    });
    if (question !== undefined && answer !== undefined) {
      promoteToCard = { question, answer };
    }
  }

  if (
    errors.length > 0 ||
    move === undefined ||
    content === undefined ||
    hintLevel === undefined ||
    stuckDetected === undefined
  ) {
    return { ok: false, errors: errors.length > 0 ? errors : ["root: missing required fields"] };
  }
  return valid({ move, content, hintLevel, stuckDetected, promoteToCard });
}

function checkStringEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  errors: string[]
): T | undefined {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    errors.push(`${path}: expected one of [${allowed.join("|")}]`);
    return undefined;
  }
  return value as T;
}
