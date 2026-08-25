import { AIError } from "../errors";
import {
  APPLE_FOUNDATION_PROVIDER_ID,
  getAppleFoundationProvider,
} from "../providers/appleFoundationProvider";
import { fnv1aHash } from "../providers/types";

type ConversationTurn = {
  role: "user" | "assistant" | "system";
  content: string;
};

function formatConversationHistory(conversationHistory: ConversationTurn[]): string {
  const lines: string[] = [];
  for (const turn of conversationHistory) {
    if (turn.role === "system") continue;
    const label = turn.role === "user" ? "User" : "Assistant";
    const content = turn.content.trim();
    if (!content) continue;
    lines.push(`${label}: ${content}`);
  }
  return lines.join("\n");
}

function buildUserFacingPrompt(args: {
  conversationHistory: ConversationTurn[];
  userPrompt: string;
  documentContext?: string;
}): string {
  const parts: string[] = [];
  const documentContext = args.documentContext?.trim();
  if (documentContext) {
    parts.push(`Document context:\n${documentContext}`);
  }

  const historyText = formatConversationHistory(args.conversationHistory);
  if (historyText) {
    parts.push(`Previous conversation:\n${historyText}`);
  }

  parts.push(`Current question: ${args.userPrompt}`);
  return parts.join("\n\n");
}

export async function runAssistantAppleFmChat(args: {
  systemInstruction: string;
  conversationHistory: ConversationTurn[];
  userPrompt: string;
  documentContext?: string;
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  onChunk?: (text: string) => void;
}): Promise<{ content: string; imagesStripped?: boolean }> {
  const provider = getAppleFoundationProvider();
  const caps = await provider.getCapabilities();
  if (!caps.textGeneration) {
    throw new AIError(
      "ModelUnavailable",
      "Apple Intelligence is not available on this device. Enable Apple Foundation Models in Settings.",
      {
        code: "model_unavailable",
        providerId: APPLE_FOUNDATION_PROVIDER_ID,
      },
    );
  }

  const text = buildUserFacingPrompt(args);
  const requestId = `assistant-apple-fm-${Date.now()}-${fnv1aHash(text).slice(0, 8)}`;
  const response = await provider.generateStream(
    {
      requestId,
      systemInstruction: args.systemInstruction,
      text,
      temperature: args.temperature,
      maxOutputTokens: args.maxOutputTokens,
    },
    {
      signal: args.signal,
      onChunk: args.onChunk,
    },
  );

  return { content: response.text };
}
