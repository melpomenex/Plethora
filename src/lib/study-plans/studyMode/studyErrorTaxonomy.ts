import { AIError, type AIErrorCategory } from "../../ai/errors";

export type StudyErrorActionKind =
  | "retry"
  | "open-ai-settings"
  | "inspect-source"
  | "narrow-scope"
  | "dismiss";

export interface StudyModeErrorPresentation {
  title: string;
  description: string;
  category:
    | "offline"
    | "provider-disabled"
    | "provider-unavailable"
    | "empty-response"
    | "invalid-structured-output"
    | "verification-failed"
    | "source-unavailable"
    | "context-too-large"
    | "rate-limit"
    | "timeout"
    | "consent-required"
    | "local-only"
    | "cancelled"
    | "persistence"
    | "unknown";
  actions: StudyErrorActionKind[];
  technicalDetail?: string;
}

function getRawMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  return String(err ?? "");
}

function mapAiCategory(
  category: AIErrorCategory,
  activityLabel: string,
  rawMessage: string,
): StudyModeErrorPresentation {
  switch (category) {
    case "Cancelled":
      return {
        title: `Cancelled ${activityLabel}`,
        description: "The request was cancelled before it finished.",
        category: "cancelled",
        actions: ["retry", "dismiss"],
      };
    case "FeatureDisabled":
      return {
        title: `Couldn't generate ${activityLabel}`,
        description: "AI generation is currently disabled in your settings.",
        category: "provider-disabled",
        actions: ["open-ai-settings", "dismiss"],
        technicalDetail: rawMessage,
      };
    case "PermissionDenied":
      return {
        title: `Permission or consent required`,
        description:
          "This provider requires explicit permission or cloud disclosure consent before sending source text.",
        category: "consent-required",
        actions: ["open-ai-settings", "dismiss"],
        technicalDetail: rawMessage,
      };
    case "ProviderOffline":
      return {
        title: `Couldn't reach the AI provider`,
        description:
          "The configured AI provider is offline or timed out. Check your connection or try another model.",
        category: "provider-unavailable",
        actions: ["retry", "open-ai-settings", "dismiss"],
        technicalDetail: rawMessage,
      };
    case "ModelUnavailable":
    case "ModelDownloadRequired":
    case "ModelDownloading":
    case "UnsupportedDevice":
    case "CapabilityUnavailable":
      return {
        title: `Selected model unavailable`,
        description:
          "The configured model isn't ready or doesn't support this Study Mode activity. Choose another model in AI settings.",
        category: "provider-unavailable",
        actions: ["open-ai-settings", "retry", "dismiss"],
        technicalDetail: rawMessage,
      };
    case "InputTooLarge":
      return {
        title: `Study scope is too large for this model`,
        description:
          "Try narrowing the study scope to the current section or a selected passage, then retry.",
        category: "context-too-large",
        actions: ["narrow-scope", "open-ai-settings", "dismiss"],
        technicalDetail: rawMessage,
      };
    case "QuotaExceeded":
    case "BatteryQuotaExceeded":
    case "ResourceExhausted":
    case "Busy":
      return {
        title: `AI provider is busy or rate-limited`,
        description:
          "Too many requests or provider quota reached. Wait a moment and retry, or switch models.",
        category: "rate-limit",
        actions: ["retry", "open-ai-settings", "dismiss"],
        technicalDetail: rawMessage,
      };
    case "InvalidStructuredOutput": {
      const isEmpty = /empty response|no content/i.test(rawMessage);
      return {
        title: `Couldn't generate ${activityLabel}`,
        description: isEmpty
          ? "The selected AI provider returned an empty response."
          : "The selected AI provider returned a response that didn't match the expected learning format.",
        category: isEmpty ? "empty-response" : "invalid-structured-output",
        actions: ["retry", "open-ai-settings", "dismiss"],
        technicalDetail: rawMessage,
      };
    }
    case "SafetyBlocked":
      return {
        title: `Couldn't generate ${activityLabel}`,
        description:
          "The provider blocked this request under its safety policy. You can still inspect the original source directly.",
        category: "provider-unavailable",
        actions: ["inspect-source", "open-ai-settings", "dismiss"],
        technicalDetail: rawMessage,
      };
    case "GenerationFailed":
      if (/timeout|timed out/i.test(rawMessage)) {
        return {
          title: `Request timed out`,
          description:
            "The AI provider took too long to respond. Retry or narrow your study scope.",
          category: "timeout",
          actions: ["retry", "narrow-scope", "dismiss"],
          technicalDetail: rawMessage,
        };
      }
      return {
        title: `Couldn't generate ${activityLabel}`,
        description:
          "The AI request didn't complete. Your previously generated materials are safe.",
        category: "unknown",
        actions: ["retry", "open-ai-settings", "dismiss"],
        technicalDetail: rawMessage,
      };
    default:
      return {
        title: `Couldn't generate ${activityLabel}`,
        description:
          "The AI request didn't complete. Your previously generated materials are safe.",
        category: "unknown",
        actions: ["retry", "open-ai-settings", "dismiss"],
        technicalDetail: rawMessage,
      };
  }
}

/**
 * Maps any Study Mode generation/verification error into a concise, actionable
 * user-facing presentation while keeping raw internal errors secondary.
 */
export function classifyStudyModeError(
  error: unknown,
  options?: {
    activityLabel?: string;
    isOffline?: boolean;
    localOnlyPreferred?: boolean;
  },
): StudyModeErrorPresentation {
  const activityLabel = options?.activityLabel ?? "learning material";
  const rawMessage = getRawMessage(error).trim();

  if (error instanceof AIError) {
    return mapAiCategory(error.category, activityLabel, rawMessage);
  }

  if (options?.isOffline && !options?.localOnlyPreferred) {
    return {
      title: `You're offline`,
      description:
        "New AI generation requires a connection or a local on-device model. Existing saved materials remain available.",
      category: "offline",
      actions: ["retry", "open-ai-settings", "dismiss"],
      technicalDetail: rawMessage || undefined,
    };
  }

  if (/verification failed|source grounding|citation/i.test(rawMessage)) {
    return {
      title: `Couldn't verify ${activityLabel} against the source`,
      description:
        "The generated response didn't match the authorized source text closely enough to save safely.",
      category: "verification-failed",
      actions: ["retry", "inspect-source", "dismiss"],
      technicalDetail: rawMessage,
    };
  }

  if (/no extractable|source content unavailable|no passage|empty passage/i.test(rawMessage)) {
    return {
      title: `Source text isn't available for this scope`,
      description:
        "Switch to a section with extractable text or open the original source to select a passage.",
      category: "source-unavailable",
      actions: ["inspect-source", "narrow-scope", "dismiss"],
      technicalDetail: rawMessage,
    };
  }

  if (/empty response|body had no content/i.test(rawMessage)) {
    return {
      title: `Couldn't generate ${activityLabel}`,
      description: "The selected AI provider returned an empty response.",
      category: "empty-response",
      actions: ["retry", "open-ai-settings", "dismiss"],
      technicalDetail: rawMessage,
    };
  }

  if (/structured output|failed validation|json/i.test(rawMessage)) {
    return {
      title: `Couldn't generate ${activityLabel}`,
      description:
        "The model's response couldn't be structured cleanly. Retry or try another model.",
      category: "invalid-structured-output",
      actions: ["retry", "open-ai-settings", "dismiss"],
      technicalDetail: rawMessage,
    };
  }

  if (/timeout|timed out|abort/i.test(rawMessage)) {
    return {
      title: `Request timed out`,
      description: "The AI provider took too long to respond. Retry or narrow your study scope.",
      category: "timeout",
      actions: ["retry", "narrow-scope", "dismiss"],
      technicalDetail: rawMessage,
    };
  }

  if (/rate limit|429|quota|too many requests/i.test(rawMessage)) {
    return {
      title: `AI provider rate limit reached`,
      description: "Wait a moment and retry, or switch to another model in AI settings.",
      category: "rate-limit",
      actions: ["retry", "open-ai-settings", "dismiss"],
      technicalDetail: rawMessage,
    };
  }

  if (/no provider|not configured|api key|disabled/i.test(rawMessage)) {
    return {
      title: `AI provider not configured`,
      description:
        "Configure an AI provider in Settings to generate new Study Mode materials. Saved materials remain accessible.",
      category: "provider-disabled",
      actions: ["open-ai-settings", "dismiss"],
      technicalDetail: rawMessage,
    };
  }

  if (/local-only|on-device|ondevice/i.test(rawMessage)) {
    return {
      title: `Local-only model unavailable`,
      description:
        "Study Mode is set to prefer local models, and no compatible on-device model is ready.",
      category: "local-only",
      actions: ["open-ai-settings", "retry", "dismiss"],
      technicalDetail: rawMessage,
    };
  }

  if (/consent|disclosure/i.test(rawMessage)) {
    return {
      title: `Cloud disclosure consent required`,
      description: "Approve cloud AI usage in AI settings before sending this scope to a cloud provider.",
      category: "consent-required",
      actions: ["open-ai-settings", "dismiss"],
      technicalDetail: rawMessage,
    };
  }

  return {
    title: `Couldn't generate ${activityLabel}`,
    description:
      "Something went wrong while generating this activity. Your existing materials were preserved.",
    category: "unknown",
    actions: ["retry", "open-ai-settings", "dismiss"],
    technicalDetail: rawMessage || undefined,
  };
}
