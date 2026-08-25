/**
 * Map native Windows bridge reasons onto `AIErrorCategory`.
 */

import { AIError, WINDOWS_REASON_TO_CATEGORY } from "../errors";

export { WINDOWS_REASON_TO_CATEGORY };

export function windowsErrorFromReason(
  reason: string,
  message: string,
  context: { providerId?: string; taskId?: string } = {}
): AIError {
  const category = WINDOWS_REASON_TO_CATEGORY[reason] ?? "GenerationFailed";
  return new AIError(category, message, { code: reason, ...context });
}

export function windowsErrorFromUnknown(
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
    if (WINDOWS_REASON_TO_CATEGORY[code]) {
      return windowsErrorFromReason(code, message, context);
    }
    return new AIError("GenerationFailed", message, { code, ...context, cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  const reason = Object.keys(WINDOWS_REASON_TO_CATEGORY).find((code) => message.includes(code));
  if (reason) return windowsErrorFromReason(reason, message, context);
  return new AIError("GenerationFailed", message, {
    code: "inference_failed",
    ...context,
    cause: error,
  });
}
