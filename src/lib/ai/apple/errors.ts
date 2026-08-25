/**
 * Map native Apple bridge reasons onto `AIErrorCategory`.
 * Frozen with OpenSpec A — B/E/F/H must not pick a different category.
 */

import { AIError, APPLE_REASON_TO_CATEGORY } from "../errors";

export { APPLE_REASON_TO_CATEGORY };

export function appleErrorFromReason(
  reason: string,
  message: string,
  context: { providerId?: string; taskId?: string } = {}
): AIError {
  const category = APPLE_REASON_TO_CATEGORY[reason] ?? "GenerationFailed";
  return new AIError(category, message, { code: reason, ...context });
}

export function appleErrorFromUnknown(
  error: unknown,
  context: { providerId?: string; taskId?: string } = {}
): AIError {
  if (error instanceof AIError) return error;
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code: unknown }).code);
    const message =
      "message" in error && typeof (error as { message: unknown }).message === "string"
        ? (error as { message: string }).message
        : code;
    if (APPLE_REASON_TO_CATEGORY[code]) {
      return appleErrorFromReason(code, message, context);
    }
    return new AIError("GenerationFailed", message, { code, ...context, cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  const reason = Object.keys(APPLE_REASON_TO_CATEGORY).find((code) =>
    message.includes(code)
  );
  if (reason) return appleErrorFromReason(reason, message, context);
  return new AIError("GenerationFailed", message, {
    code: "inference_failed",
    ...context,
    cause: error,
  });
}
