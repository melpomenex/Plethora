export type TTSServiceErrorCode =
  | "validation"
  | "auth"
  | "rate_limit"
  | "network"
  | "provider";

/** A typed error shared by every TTS adapter and the synthesis pipeline. */
export class TTSServiceError extends Error {
  code: TTSServiceErrorCode;
  recoverable: boolean;

  constructor(
    message: string,
    code: TTSServiceErrorCode = "provider",
    recoverable = false,
  ) {
    super(message);
    this.name = "TTSServiceError";
    this.code = code;
    this.recoverable = recoverable;
  }
}

export function providerErrorName(id: string): string {
  switch (id) {
    case "openrouter": return "OpenRouter";
    case "elevenlabs": return "ElevenLabs";
    case "openai": return "OpenAI";
    case "openai-compatible": return "OpenAI-compatible provider";
    case "groq": return "Groq";
    case "fal": return "Fal";
    case "pocket": return "Pocket TTS";
    case "system": return "System TTS";
    default: return id || "TTS provider";
  }
}

export function mapHttpError(
  provider: string,
  status: number,
  message?: string,
): TTSServiceError {
  const name = providerErrorName(provider);
  if (status === 401 || status === 403) {
    return new TTSServiceError(
      `${name} authentication failed. Check the configured API key.`,
      "auth",
      false,
    );
  }
  if (status === 429) {
    return new TTSServiceError(
      `${name} rate limit reached. Retry in a few seconds.`,
      "rate_limit",
      true,
    );
  }
  if (status === 402) {
    return new TTSServiceError(
      `${name} account is out of credits. Add credits before trying again.`,
      "provider",
      false,
    );
  }
  if (status >= 500) {
    return new TTSServiceError(
      message || `${name} is temporarily unavailable.`,
      "provider",
      true,
    );
  }
  return new TTSServiceError(message || `${name} request failed.`, "provider", false);
}

export async function readProviderMessage(response: Response): Promise<string | undefined> {
  try {
    const payload: unknown = await response.clone().json();
    if (typeof payload === "object" && payload !== null) {
      const record = payload as Record<string, unknown>;
      if (typeof record.error === "string") return record.error;
      if (typeof record.message === "string") return record.message;
      if (typeof record.error === "object" && record.error !== null) {
        const nested = record.error as Record<string, unknown>;
        if (typeof nested.message === "string") return nested.message;
      }
    }
  } catch {
    // Some providers return plain text or an empty body on failure.
  }
  try {
    const text = await response.clone().text();
    return text.trim() || undefined;
  } catch {
    return undefined;
  }
}
