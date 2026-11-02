import { AIError } from "./errors";
import { t } from "../i18n";
import type { CompletionFailureKind } from "./tasks/completion";

export interface LibraryGenerationFailureContext {
  stage: "generation";
  evidenceCount: number;
  retrievalMode: "semantic" | "lexicalOnly";
  failureKind?: CompletionFailureKind;
  attemptCount?: number;
}

export function libraryGenerationFailureContext(
  error: unknown
): LibraryGenerationFailureContext | undefined {
  if (
    !(error instanceof AIError) ||
    !error.generation?.evidenceCount ||
    error.category === "Cancelled"
  )
    return undefined;
  return {
    ...error.generation,
    failureKind: error.completion?.terminalFailureKind,
    attemptCount: error.completion?.attemptCount,
  };
}

/** Safe, localized generation copy; retrieval and unknown errors keep their existing path. */
export function libraryGenerationFailureMessage(error: unknown): string | null {
  if (
    !(error instanceof AIError) ||
    !error.generation?.evidenceCount ||
    error.category === "Cancelled"
  )
    return null;
  const kind = error.completion?.terminalFailureKind;
  if (error.category === "SafetyBlocked") return t("qaGeneration.refusal");
  if (
    kind === "provider-error" ||
    kind === "timeout" ||
    error.category !== "InvalidStructuredOutput"
  )
    return t("qaGeneration.provider");
  if (error.completion?.outputLimitObserved) return t("qaGeneration.outputLimit");
  if (kind === "empty-response") return t("qaGeneration.empty");
  return t("qaGeneration.unusable");
}
