import type { AssistantScope } from "../../../lib/ai/assistant/scopes";
import { isAssistantScope } from "../../../lib/ai/assistant/scopes";
import { decodeAgentDraftArtifact } from "../../../lib/ai/assistant/conversations/serialize";
import type { AgentDraftArtifact } from "../../../lib/ai/assistant/conversations/types";
import type { AssistantSourceProvenance } from "./contracts";

export const MOBILE_CHAT_HISTORY_KEY = "mobile-assistant-chat-history-v1";
export const MAX_MOBILE_CHAT_HISTORY = 20;
const MAX_CHAT_MESSAGES = 200;
const MAX_TITLE_LENGTH = 72;

export interface MobileChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  provenance?: AssistantSourceProvenance;
  agentRun?: {
    proposals: Array<{
      sourceRefs: Array<{ text: string }>;
    }>;
  };
}

export interface MobileChatHistoryEntry<TMessage extends MobileChatMessage = MobileChatMessage> {
  id: string;
  title: string;
  messages: TMessage[];
  scope: AssistantScope;
  input: string;
  updatedAt: number;
  sourceTitle?: string;
  agentDraft?: AgentDraftArtifact;
}

const createChatId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `mobile-chat-${crypto.randomUUID()}`;
  }
  return `mobile-chat-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
};

const isValidMessage = (value: unknown): value is MobileChatMessage => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MobileChatMessage>;
  return (
    typeof candidate.id === "string" &&
    (candidate.role === "user" || candidate.role === "assistant" || candidate.role === "system") &&
    typeof candidate.content === "string" &&
    typeof candidate.timestamp === "number"
  );
};

export const deriveMobileChatTitle = (
  messages: readonly MobileChatMessage[],
  fallbackTitle = "Untitled chat"
): string => {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim().length > 0);
  const candidate = firstUser ?? messages.find((m) => m.role === "assistant" && m.content.trim().length > 0);
  if (!candidate) return fallbackTitle;
  const normalized = candidate.content.replace(/\s+/g, " ").trim();
  if (normalized.length <= MAX_TITLE_LENGTH) return normalized;
  return `${normalized.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
};

export const deriveMobileChatSourceTitle = (
  messages: readonly MobileChatMessage[]
): string | undefined => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const title = messages[i]?.provenance?.sourceTitle;
    if (typeof title === "string" && title.trim().length > 0) {
      return title.trim();
    }
  }
  return undefined;
};

const sanitizeMessages = <TMessage extends MobileChatMessage>(
  messages: readonly TMessage[]
): TMessage[] =>
  messages.slice(-MAX_CHAT_MESSAGES).map((message) =>
    message.agentRun
      ? {
          ...message,
          agentRun: {
            ...message.agentRun,
            restored: true,
            proposals: message.agentRun.proposals.map((proposal) => ({
              ...proposal,
              sourceRefs: proposal.sourceRefs.map(({ text: _text, ...source }) => ({
                ...source,
                text: "",
              })),
            })),
          },
        }
      : message
  );

const sortAndCapEntries = <TMessage extends MobileChatMessage>(
  entries: MobileChatHistoryEntry<TMessage>[]
): MobileChatHistoryEntry<TMessage>[] =>
  [...entries]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_MOBILE_CHAT_HISTORY);

export const readMobileChatHistory = <
  TMessage extends MobileChatMessage = MobileChatMessage
>(): MobileChatHistoryEntry<TMessage>[] => {
  try {
    const raw = localStorage.getItem(MOBILE_CHAT_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const normalized: MobileChatHistoryEntry<TMessage>[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Partial<MobileChatHistoryEntry<TMessage>>;
      if (typeof candidate.id !== "string" || !candidate.id.trim()) continue;
      const messages = Array.isArray(candidate.messages)
        ? (candidate.messages.filter(isValidMessage).slice(-MAX_CHAT_MESSAGES) as TMessage[])
        : [];
      const agentDraft = decodeAgentDraftArtifact(candidate.agentDraft) ?? undefined;
      if (messages.length === 0 && !agentDraft) continue;
      normalized.push({
        id: candidate.id,
        title:
          typeof candidate.title === "string" && candidate.title.trim().length > 0
            ? candidate.title.trim()
            : deriveMobileChatTitle(messages),
        messages,
        scope: isAssistantScope(candidate.scope) ? candidate.scope : "chat",
        input: typeof candidate.input === "string" ? candidate.input : "",
        updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
        sourceTitle:
          typeof candidate.sourceTitle === "string" && candidate.sourceTitle.trim().length > 0
            ? candidate.sourceTitle.trim()
            : deriveMobileChatSourceTitle(messages),
        agentDraft,
      });
    }
    return sortAndCapEntries(normalized);
  } catch (error) {
    console.warn("Failed to read mobile chat history:", error);
    return [];
  }
};

export const writeMobileChatHistory = <TMessage extends MobileChatMessage = MobileChatMessage>(
  entries: MobileChatHistoryEntry<TMessage>[]
): MobileChatHistoryEntry<TMessage>[] => {
  const capped = sortAndCapEntries(entries).map((entry) => ({
    ...entry,
    messages: sanitizeMessages(entry.messages),
  }));
  // If localStorage quota is tight, drop the oldest entries until it fits.
  for (let limit = capped.length; limit >= 0; limit -= 1) {
    const slice = capped.slice(0, limit);
    try {
      localStorage.setItem(MOBILE_CHAT_HISTORY_KEY, JSON.stringify(slice));
      return slice;
    } catch (error) {
      if (limit === 0) {
        console.warn("Failed to persist mobile chat history:", error);
      }
    }
  }
  return [];
};

export const saveMobileChatToHistory = <TMessage extends MobileChatMessage = MobileChatMessage>(
  draft: {
    id?: string;
    title?: string;
    messages: TMessage[];
    scope: AssistantScope;
    input: string;
    updatedAt?: number;
    sourceTitle?: string;
    agentDraft?: AgentDraftArtifact;
  },
  fallbackTitle = "Untitled chat"
): string | null => {
  const hasVisibleContent =
    draft.messages.some((message) => message.role !== "system") || Boolean(draft.agentDraft);
  if (!hasVisibleContent) return null;

  const id = draft.id?.trim() || createChatId();
  const title =
    draft.title?.trim() || deriveMobileChatTitle(draft.messages, fallbackTitle);
  const sourceTitle =
    draft.sourceTitle?.trim() || deriveMobileChatSourceTitle(draft.messages);
  const updatedAt = draft.updatedAt ?? Date.now();

  const existing = readMobileChatHistory<TMessage>().filter((entry) => entry.id !== id);
  const nextEntry: MobileChatHistoryEntry<TMessage> = {
    id,
    title,
    messages: draft.messages,
    scope: draft.scope,
    input: draft.input,
    updatedAt,
    sourceTitle,
    agentDraft: draft.agentDraft,
  };
  writeMobileChatHistory([nextEntry, ...existing]);
  return id;
};

export const deleteMobileChatFromHistory = <
  TMessage extends MobileChatMessage = MobileChatMessage
>(
  id: string
): MobileChatHistoryEntry<TMessage>[] => {
  const remaining = readMobileChatHistory<TMessage>().filter((entry) => entry.id !== id);
  return writeMobileChatHistory(remaining);
};
