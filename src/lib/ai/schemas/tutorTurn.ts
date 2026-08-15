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

  const move = checkStringEnum(output.move, TUTOR_MOVES, "move", errors);
  const content = checkString(output.content, "content", errors, { maxLength: 4000 });
  const hintLevel = checkNumber(output.hintLevel, "hintLevel", errors, {
    min: 0,
    max: MAX_HINT_LEVEL,
    integer: true,
  });
  const stuckDetected = checkBoolean(output.stuckDetected, "stuckDetected", errors);

  let promoteToCard: TutorCardPromotion | undefined;
  if (output.promoteToCard !== undefined) {
    if (!isRecord(output.promoteToCard)) {
      errors.push("promoteToCard: expected object");
    } else {
      const question = checkString(output.promoteToCard.question, "promoteToCard.question", errors, {
        maxLength: 2000,
      });
      const answer = checkString(output.promoteToCard.answer, "promoteToCard.answer", errors, {
        maxLength: 2000,
      });
      if (question !== undefined && answer !== undefined) {
        promoteToCard = { question, answer };
      }
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
