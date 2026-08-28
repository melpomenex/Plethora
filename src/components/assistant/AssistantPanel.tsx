import { useState, useRef, useEffect, useMemo, useCallback, type ReactNode } from "react";
import DOMPurify from "dompurify";
import {
  CaretDown,
  CaretLeft,
  CaretRight,
  ChatCircle,
  Check,
  CircleNotch,
  Code,
  Copy,
  Cpu,
  Eye,
  Gear,
  Globe,
  Images,
  Lightning,
  PaperPlaneTilt,
  ShareNetwork,
  SidebarSimple,
  Sparkle,
  TextT,
  X,
  Quotes,
  Pencil,
  Trash,
  FileText,
  ChatCircleText,
  ArrowsClockwise,
  Waves,
  Brain,
  Lightbulb,
} from "@phosphor-icons/react";
import { compressImage, readFileAsDataUrl } from "../../utils/imageCompression";
import { supportsVision } from "../../utils/visionCapability";
import { chatWithContext, type LLMMessage, type LLMMessageContentPart, type LLMProvider } from "../../api/llm";
import { resolveRequestPolicy } from "../../api/llm/policy";
import { callAppMCPTool, getAppMCPTools, type MCPTool } from "../../api/mcp";
import { renderMarkdown } from "../../utils/markdown";
import { useDocumentStore, useSettingsStore, useLLMProvidersStore, useReviewStore, useTabsStore } from "../../stores";
import { useStudyDeckStore } from "../../stores/studyDeckStore";
import { ReviewTab, SettingsTab } from "../tabs/TabRegistry";
import { ShareMessageDialog } from "./ShareMessageDialog";
import { copyToClipboard, generateSingleMessageMarkdown, type ConversationMessage } from "../../api/integrations";
import { useI18n } from "../../lib/i18n";
import { useContextMenu, ContextMenu, ContextMenuItem, ContextMenuItemType } from "../common/ContextMenu";
import { useToast } from "../common/Toast";
import { createExtract, patchDocumentExtractCount } from "../../api/extracts";
import { getAssistantContextErrorMessage, type ResolvedAssistantContext } from "../../utils/assistantContext";
import {
  APPLE_FM_ASSISTANT_PROVIDER,
  getStoredAssistantProvider,
  isAppleFmAssistantProvider,
  persistAssistantProvider,
  type AssistantProviderId,
} from "../../utils/assistantProvider";
import { runAssistantAppleFmChat } from "../../lib/ai/assistant/assistantAppleFmChat";
import { appleFmAvailability } from "../../lib/ai/apple/foundation";
import { getAppleIntelligenceSnapshot, isAppleOsPlatform } from "../../lib/ai/apple/capabilities";
import { providerRequiresApiKey, type ConfiguredLLMProvider } from "../../utils/llmProviderUtils";
import { invokeCommand, isTauri } from "../../lib/tauri";
import { useDocumentSections } from "../../hooks/useDocumentSections";
import { SectionMentionPopup } from "../common/SectionMentionPopup";
import { SectionMentionCard } from "../common/SectionMentionCard";
import {
  buildSelectionFocusedContext,
  buildSectionsSnapshot,
  createSelectionSection,
  describeSectionDiagnostic,
  hashSectionContent,
  normalizeSectionTitleForMatch,
  resolvePromptSectionMentions,
  resolveSectionFocusedContext,
  type SectionNode,
  type SectionSourceReference,
} from "../../utils/sectionIndex";
import { useDocumentOutlineStore } from "../../stores/documentOutlineStore";
import { extractDocumentText, getDocument } from "../../api/documents";
import { createDocumentQaRequestContent, loadDocumentQaText } from "../../features/documentQa/sectionContextRequest";
import { ChatFlashcardCollection } from "./ChatFlashcardCollection";
import {
  buildFlashcardToolInstruction,
  getFlashcardArtifactDeckName,
  nonFlashcardToolCalls,
  toolCallsToFlashcardArtifacts,
  type ChatFlashcardArtifact,
} from "../../features/assistant/chatFlashcardArtifacts";
import {
  buildTwentyRulesSystemPrompt,
  getTwentyRulesReminderMarkdown,
  isTwentyRulesCommand,
  stripTwentyRulesCommand,
} from "../../lib/ai/knowledgeFormulation";
import {
  ASSISTANT_MESSAGE_FLASHCARD_DISPLAY_KEY,
  buildAssistantMessageFlashcardRequest,
  canCreateFlashcardsFromMessage,
  getFlashcardIneligibilityReason,
  captureDocumentContext,
  type CapturedDocumentContext,
  ASSISTANT_MESSAGE_FLASHCARD_UNAVAILABLE_KEY,
} from "../../features/assistant/assistantMessageFlashcards";

export interface AssistantContext {
  type: "document" | "web" | "video" | "general";
  content?: string;
  url?: string;
  documentId?: string;
  selection?: string;
  contextWindowTokens?: number;
  position?: {
    pageNumber?: number;
    scrollPercent?: number;
    currentTime?: number;
  };
  metadata?: {
    title?: string;
    duration?: number;
    videoId?: string;
  };
  status?: "ready" | "loading" | "unavailable";
  statusMessage?: string;
  source?: string;
  /** Authoritative viewer-supplied sections (for example timed audiobook chapters). */
  sections?: SectionNode[];
  resolveForPrompt?: (prompt: string) => Promise<ResolvedAssistantContext>;
}

export interface AttachedImage {
  id: string;
  dataUrl: string;
  fileName?: string;
  fileSize?: number;
  width?: number;
  height?: number;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  images?: AttachedImage[];
  toolCalls?: ToolCall[];
  sourceContext?: SectionSourceReference;
}

interface ToolCall {
  name: string;
  parameters: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "success" | "error";
}

export type AssistantPosition = "left" | "right";

interface AssistantPanelProps {
  context?: AssistantContext;
  onToolCall?: (tool: string, params: Record<string, unknown>) => Promise<unknown>;
  className?: string;
  onInputHoverChange?: (isHovered: boolean) => void;
  onWidthChange?: (width: number) => void;
  position?: AssistantPosition;
  onPositionChange?: (position: AssistantPosition) => void;
  selectedProvider?: AssistantProviderId;
  onProviderChange?: (provider: AssistantProviderId) => void;
  appendContextMessages?: boolean;
  /** Fill the host width and disable the desktop drag handle (used by mobile sheets). */
  fillContainer?: boolean;
}

const ASSISTANT_POSITION_KEY = "assistant-panel-position";
const ASSISTANT_WIDTH_KEY = "assistant-panel-width";
const ASSISTANT_CONVERSATIONS_KEY = "assistant-panel-conversations-v1";

/**
 * Split-pane layout constants, shared with the reader hosts so the assistant
 * and the reader each retain a minimum usable width during resize (#17).
 */
export const ASSISTANT_MIN_WIDTH = 300;
export const ASSISTANT_MAX_WIDTH = 800;
export const READER_MIN_WIDTH = 320;
const MAX_STORED_MESSAGES = 200;
const MAX_ATTACHED_IMAGES = 4;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB raw file limit
const CARD_CREATION_TOOL_NAMES = new Set(["create_qa_card", "create_cloze_card", "batch_create_cards"]);
const ATTACHABLE_TOOL_NAMES = new Set([...CARD_CREATION_TOOL_NAMES, "create_extract"]);

const getDocumentDeckName = (title?: string): string | undefined => {
  const trimmed = title?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\s*\([^)]*\)\s*$/, "").trim() || trimmed;
};

interface StoredConversation {
  messages: Message[];
  input: string;
  updatedAt: number;
}

type StoredConversationMap = Record<string, StoredConversation>;

const isValidMessage = (value: unknown): value is Message => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Message>;
  return (
    typeof candidate.id === "string" &&
    (candidate.role === "user" || candidate.role === "assistant" || candidate.role === "system") &&
    typeof candidate.content === "string" &&
    typeof candidate.timestamp === "number" &&
    (candidate.images === undefined || Array.isArray(candidate.images))
  );
};

const getConversationKey = (ctx?: AssistantContext): string => {
  if (!ctx) return "general";
  if (ctx.type === "document") return `document:${ctx.documentId || "unknown"}`;
  if (ctx.type === "video") {
    return `video:${ctx.documentId || ctx.metadata?.videoId || ctx.metadata?.title || "unknown"}`;
  }
  if (ctx.type === "web") return `web:${ctx.url || ctx.metadata?.title || "unknown"}`;
  return "general";
};

const readStoredConversations = (): StoredConversationMap => {
  try {
    const raw = localStorage.getItem(ASSISTANT_CONVERSATIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const normalized: StoredConversationMap = {};
    Object.entries(parsed as Record<string, unknown>).forEach(([key, value]) => {
      if (!value || typeof value !== "object") return;
      const candidate = value as Partial<StoredConversation>;
      const messages = Array.isArray(candidate.messages)
        ? candidate.messages.filter(isValidMessage).slice(-MAX_STORED_MESSAGES)
        : [];
      normalized[key] = {
        messages,
        input: typeof candidate.input === "string" ? candidate.input : "",
        updatedAt: typeof candidate.updatedAt === "number" ? candidate.updatedAt : Date.now(),
      };
    });
    return normalized;
  } catch (error) {
    console.warn("Failed to parse stored assistant conversations:", error);
    return {};
  }
};

const writeStoredConversations = (conversations: StoredConversationMap) => {
  try {
    localStorage.setItem(ASSISTANT_CONVERSATIONS_KEY, JSON.stringify(conversations));
  } catch (error) {
    console.warn("Failed to persist assistant conversation:", error);
  }
};

const getUserInputHistory = (messages: Message[]): string[] => {
  const seen = new Set<string>();
  const history: string[] = [];

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const content = message.content.trim();
    if (!content || seen.has(content)) continue;
    seen.add(content);
    history.push(content);
  }

  return history;
};

const isCaretOnFirstLine = (textarea: HTMLTextAreaElement) => {
  const caret = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  if (caret !== selectionEnd) return false;
  return !textarea.value.slice(0, caret).includes("\n");
};

const isCaretOnLastLine = (textarea: HTMLTextAreaElement) => {
  const caret = textarea.selectionStart;
  const selectionEnd = textarea.selectionEnd;
  if (caret !== selectionEnd) return false;
  return !textarea.value.slice(caret).includes("\n");
};

/** Memoized markdown renderer — avoids re-running renderMarkdown on unrelated re-renders. */
function MemoizedMarkdown({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  const safeHtml = useMemo(() => DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['strong', 'em', 'p', 'br', 'code', 'pre', 'a', 'img', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'hr', 'div', 'span', 'sub', 'sup'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'target', 'rel', 'data-language'],
  }), [html]);
  return (
    <div
      className="assistant-markdown leading-relaxed"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}

export function AssistantPanel({
  context,
  onToolCall: _onToolCall,
  className = "",
  onInputHoverChange,
  onWidthChange,
  position: externalPosition,
  onPositionChange,
  selectedProvider: externalSelectedProvider,
  onProviderChange,
  appendContextMessages = true,
  fillContainer = false,
}: AssistantPanelProps) {
  const { t } = useI18n();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem(ASSISTANT_WIDTH_KEY);
    return saved ? parseInt(saved) : 400;
  });
  const [position, setPosition] = useState<AssistantPosition>(() => {
    if (externalPosition) return externalPosition;
    const saved = localStorage.getItem(ASSISTANT_POSITION_KEY);
    return saved === "left" ? "left" : "right";
  });

  const [isResizing, setIsResizing] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [flashcardGeneratingMessageId, setFlashcardGeneratingMessageId] = useState<string | null>(null);
  const toolExecutionContextRef = useRef<CapturedDocumentContext>({});
  const assistantContextMenu = useContextMenu("assistant-panel-context-menu");
  const toast = useToast();
  const [availableTools, setAvailableTools] = useState<MCPTool[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<AssistantProviderId>(() =>
    getStoredAssistantProvider("openai"),
  );
  const assistantUseAppleFoundation = useSettingsStore(
    (s) => s.settings.ai.assistantUseAppleFoundation === true,
  );
  const [appleFmAvailable, setAppleFmAvailable] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const inputContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Section # mention support - new tree UX
  const [showSectionPopup, setShowSectionPopup] = useState(false);
  const [sectionQuery, setSectionQuery] = useState("");
  const [sectionCursorIndex, setSectionCursorIndex] = useState(0);
  const [selectedSectionNodes, setSelectedSectionNodes] = useState<SectionNode[]>([]);
  const [assistantFullContent, setAssistantFullContent] = useState("");
  // The `#` section index costs a full-document text fetch plus a synchronous
  // tree build — on an EPUB that is the whole book, and doing it on document
  // open froze Scroll Mode. Nothing needs it until the user touches the input,
  // so arm it on first focus instead.
  const [sectionsArmed, setSectionsArmed] = useState(false);

  const SECTION_REGEX = /#{([^}]+)}/g;

  // Use external provider if provided
  const effectiveProvider = externalSelectedProvider ?? selectedProvider;
  const [isInputHovered, setIsInputHovered] = useState(false);
  const contextWindowTokens = useSettingsStore((state) => state.settings.ai.maxTokens);
  const aiControls = useSettingsStore((state) => state.settings.ai.aiControls);

  useEffect(() => {
    if (!isAppleOsPlatform()) return;
    let cancelled = false;
    void (async () => {
      try {
        const [snap, avail] = await Promise.all([
          getAppleIntelligenceSnapshot(),
          appleFmAvailability(),
        ]);
        if (cancelled) return;
        const ready =
          snap.foundationModels.status === "available" || avail.status === "available";
        setAppleFmAvailable(ready);
      } catch {
        if (!cancelled) setAppleFmAvailable(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const studyDecks = useStudyDeckStore((state) => state.decks);
  const storedDocumentTitle = useDocumentStore((state) => {
    const documentId = context?.documentId;
    if (!documentId) return undefined;
    return state.documents.find((document) => document.id === documentId)?.title
      ?? (state.currentDocument?.id === documentId ? state.currentDocument.title : undefined);
  });
  const assistantDocumentTitle = context?.metadata?.title ?? storedDocumentTitle;

  // Repair successful card batches from builds that attached document_id but
  // omitted the title tag/deck. Conversations persist their tool-call status,
  // so reopening the audiobook can restore the document-bound deck; that deck
  // immediately includes the already-saved cards by document ownership.
  useEffect(() => {
    const documentId = context?.documentId;
    const deckName = getDocumentDeckName(assistantDocumentTitle);
    const explicitDeckNames = new Set<string>();
    let hasSavedDocumentCards = false;
    for (const message of messages) {
      for (const call of message.toolCalls ?? []) {
        if (!CARD_CREATION_TOOL_NAMES.has(call.name) || call.status !== "success") continue;
        hasSavedDocumentCards = true;
        // Explicit `deck:` tags on saved cards materialize their decks in the
        // same save path — a deck referenced at creation must be visible in
        // Deck Manager immediately (issue #44 bug 10).
        const tags = call.parameters?.tags;
        if (!Array.isArray(tags)) continue;
        for (const tag of tags) {
          if (typeof tag === "string" && tag.toLowerCase().startsWith("deck:")) {
            const name = tag.slice(5).trim();
            if (name) explicitDeckNames.add(name);
          }
        }
      }
    }
    if (documentId && deckName && hasSavedDocumentCards) {
      useStudyDeckStore.getState().addDeck(deckName, [deckName], documentId, "all");
    }
    if (explicitDeckNames.size > 0) {
      useStudyDeckStore.getState().ensureDecksExist([...explicitDeckNames]);
    }
  }, [assistantDocumentTitle, context?.documentId, messages]);

  // Model selection UI states and store subscription
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  // Whole-library RAG scope: when true, messages route through the Ask
  // library task (retrieve top-k chunks across the semantic index + grounded
  // validated answer + citations) instead of the single-document
  // chatWithContext path.
  const [useWholeLibraryScope, setUseWholeLibraryScope] = useState(false);
  const configuredProvidersList = useLLMProvidersStore((state) => state.providers);

  // Document sections for # mentions
  const {
    tree: documentSectionTree,
    flat: documentSectionFlat,
  } = useDocumentSections({
    documentId: context?.documentId,
    content: sectionsArmed ? assistantFullContent || context?.content || "" : "",
    useStoreOutline: true,
  });
  const assistantSectionTree = context?.sections?.length ? context.sections : documentSectionTree;
  const assistantSectionFlat = context?.sections?.length ? context.sections : documentSectionFlat;

  // The user's live text selection in the source document is offered as the
  // first `#` mention entry when one exists (spec: "asking about a certain
  // portion of text"). It carries exactly the selected text as context.
  const selectionSection = useMemo(() => {
    if (context?.type !== "document" || !context.selection?.trim()) return null;
    return createSelectionSection(context.selection, context.documentId);
  }, [context?.type, context?.selection, context?.documentId]);

  // Load full document content for section parsing when documentId changes.
  // While the fetch is in flight the section catalog is empty — the popup
  // must say "loading" rather than a false "no sections available".
  const [sectionTextLoading, setSectionTextLoading] = useState(false);
  useEffect(() => {
    if (!context?.documentId || !sectionsArmed || context.sections?.length) {
      setAssistantFullContent("");
      setSectionTextLoading(false);
      return;
    }
    let mounted = true;
    setSectionTextLoading(true);
    loadDocumentQaText(context.documentId, { getDocument, extractDocumentText })
      .then((content) => {
        if (mounted) {
          setAssistantFullContent(content);
          setSectionTextLoading(false);
        }
      })
      .catch(() => {
        if (mounted) {
          setAssistantFullContent("");
          setSectionTextLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, [context?.documentId, context?.sections?.length, sectionsArmed]);

  const isThreadContext = useMemo(() => {
    if (!context) return false;
    if (context.content?.includes("[Post 1 by @") || context.content?.includes("X Thread by")) return true;
    if (context.documentId) {
      const doc = useDocumentStore.getState().documents.find((d) => d.id === context.documentId);
      if (doc?.metadata?.xThread || doc?.tags?.includes("thread") || doc?.category === "X Threads") return true;
    }
    return false;
  }, [context]);

  // Clean, human-friendly model name formatter
  const getFriendlyModelName = (providerId: string, rawModelName?: string) => {
    if (isAppleFmAssistantProvider(providerId as AssistantProviderId)) {
      return appleFmProviderLabel;
    }
    if (!rawModelName) {
      if (providerId === "openai") return "GPT-4o";
      if (providerId === "anthropic") return "Claude 3.5 Sonnet";
      if (providerId === "gemini") return "Gemini 3.5 Flash";
      if (providerId === "deepseek") return "DeepSeek Chat";
      if (providerId === "ollama") return "Llama 3.2";
      if (providerId === "openrouter") return "Claude 3.5 Sonnet";
      return "Select Model";
    }

    const modelLower = rawModelName.toLowerCase();
    
    // OpenAI Models
    if (modelLower.includes("gpt-4o-mini")) return "GPT-4o Mini";
    if (modelLower.includes("gpt-4o")) return "GPT-4o";
    if (modelLower.includes("gpt-4-turbo")) return "GPT-4 Turbo";
    if (modelLower.includes("gpt-4")) return "GPT-4";
    if (modelLower.includes("gpt-3.5-turbo")) return "GPT-3.5 Turbo";
    
    // Anthropic Models
    if (modelLower.includes("claude-3-5-sonnet")) return "Claude 3.5 Sonnet";
    if (modelLower.includes("claude-3-5-haiku")) return "Claude 3.5 Haiku";
    if (modelLower.includes("claude-3-opus")) return "Claude 3 Opus";
    if (modelLower.includes("claude-3-sonnet")) return "Claude 3 Sonnet";
    if (modelLower.includes("claude-3-haiku")) return "Claude 3 Haiku";
    
    // OpenRouter / Gemini / DeepSeek mappings
    if (modelLower.includes("gemini-3.5-flash")) return "Gemini 3.5 Flash";
    if (modelLower.includes("gemini-3.5-pro")) return "Gemini 3.5 Pro";
    if (modelLower.includes("google/gemini-2.5-flash")) return "Gemini 2.5 Flash";
    if (modelLower.includes("google/gemini-pro-1.5")) return "Gemini 1.5 Pro";
    if (modelLower.includes("google/gemini-flash-1.5") || modelLower.includes("google/gemini-1.5-flash")) return "Gemini 1.5 Flash";
    if (modelLower.includes("google/gemini-2.5-pro")) return "Gemini 2.5 Pro";
    if (modelLower.includes("google/gemini-2.0-flash")) return "Gemini 2.0 Flash";
    if (modelLower.includes("google/gemini")) return "Gemini Model";
    if (modelLower.includes("deepseek-chat") || modelLower.includes("deepseek/deepseek-chat") || modelLower.includes("deepseek-v3")) return "DeepSeek Chat";
    if (modelLower.includes("deepseek-reasoner")) return "DeepSeek Reasoner";
    if (modelLower.includes("deepseek/deepseek-coder")) return "DeepSeek Coder";
    if (modelLower.includes("meta-llama/llama-3.3-70b")) return "Llama 3.3 70B";
    if (modelLower.includes("meta-llama/llama-3.1-405b")) return "Llama 3.1 405B";
    if (modelLower.includes("openrouter")) return "OpenRouter Model";
    
    // Ollama / Local Models
    if (modelLower.includes("llama3.2")) return "Llama 3.2";
    if (modelLower.includes("llama3.3")) return "Llama 3.3";
    if (modelLower.includes("llama3.1")) return "Llama 3.1";
    if (modelLower.includes("llama3")) return "Llama 3";
    if (modelLower.includes("mistral")) return "Mistral";
    if (modelLower.includes("qwen")) return "Qwen";
    if (modelLower.includes("deepseek")) return "DeepSeek";
    if (modelLower.includes("phi3") || modelLower.includes("phi-3")) return "Phi-3";
    if (modelLower.includes("gemma")) return "Gemma";
    
    // Clean OpenRouter formatting
    if (rawModelName.includes("/")) {
      const parts = rawModelName.split("/");
      const modelPart = parts[parts.length - 1];
      return modelPart
        .split("-")
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    }
    
    return rawModelName;
  };

  // Provider configuration active status checker
  const getProviderStatus = (providerId: AssistantProviderId) => {
    if (isAppleFmAssistantProvider(providerId)) {
      return assistantUseAppleFoundation && appleFmAvailable ? "active" : "not-configured";
    }
    const config = configuredProvidersList.find(p => p.provider === providerId);
    if (!config) return "not-configured";
    if (!config.enabled) return "disabled";
    
    const requiresKey = providerRequiresApiKey(providerId as ConfiguredLLMProvider, config.baseUrl || "");
    const hasKey = config.apiKey && config.apiKey.trim().length > 0;
    
    if (requiresKey && !hasKey) return "key-missing";
    return "active";
  };

  // Open the Gear tab to AI panel directly
  const handleOpenSettingsToAI = () => {
    localStorage.setItem("plethora_settings_initial_tab", "ai");
    
    const tabId = useTabsStore.getState().addTab({
      title: "Settings",
      icon: <Gear className="w-4 h-4" />,
      type: "settings",
      content: SettingsTab,
      closable: true,
    });
    
    const pane = useTabsStore.getState().findPaneContainingTab(tabId);
    if (pane) {
      useTabsStore.getState().setActiveTab(pane.id, tabId);
    }
  };

  // Share dialog state
  const [isShareDialogOpen, setIsShareDialogOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState<Message | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastContextSignatureRef = useRef<string | null>(null);
  const activeConversationKeyRef = useRef<string>("general");
  const historyDraftRef = useRef("");
  const publishConversationTimerRef = useRef<number | null>(null);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);

  const attachImage = async (file: File) => {
    if (!file.type.startsWith("image/")) return;

    if (file.size > MAX_IMAGE_BYTES) {
      // Show toast-like warning via a temporary system message
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          role: "system" as const,
          content: `⚠️ Image "${file.name}" exceeds the 10 MB limit and was not attached.`,
          timestamp: Date.now(),
        },
      ]);
      return;
    }

    setAttachedImages((prev) => {
      if (prev.length >= MAX_ATTACHED_IMAGES) {
        setMessages((msgs) => [
          ...msgs,
          {
            id: `sys-${Date.now()}`,
            role: "system" as const,
            content: `⚠️ Maximum ${MAX_ATTACHED_IMAGES} images per message. Remove one to add another.`,
            timestamp: Date.now(),
          },
        ]);
        return prev;
      }
      return prev;
    });

    try {
      let dataUrl = await readFileAsDataUrl(file);

      // Compress if > 1 MB raw data URL length (rough proxy)
      if (dataUrl.length > 1 * 1024 * 1024) {
        dataUrl = await compressImage(dataUrl);
      }

      const image: AttachedImage = {
        id: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        dataUrl,
        fileName: file.name,
        fileSize: file.size,
      };

      setAttachedImages((prev) => {
        if (prev.length >= MAX_ATTACHED_IMAGES) return prev;
        return [...prev, image];
      });
    } catch (err) {
      console.error("Failed to attach image:", err);
      setMessages((prev) => [
        ...prev,
        {
          id: `sys-${Date.now()}`,
          role: "system" as const,
          content: `⚠️ Failed to process image "${file.name}".`,
          timestamp: Date.now(),
        },
      ]);
    }
  };

  const removeImage = (id: string) => {
    setAttachedImages((prev) => prev.filter((img) => img.id !== id));
    textareaRef.current?.focus();
  };

  const clearAttachedImages = () => {
    setAttachedImages([]);
  };

  const appleFmProviderLabel = useMemo(() => {
    const label = t("assistant.providerAppleFoundation");
    return label === "assistant.providerAppleFoundation" ? "Apple Intelligence" : label;
  }, [t]);

  const providers = useMemo(() => {
    const list: Array<{
      id: AssistantProviderId;
      name: string;
      icon: typeof Sparkle;
      color: string;
      gradient: string;
      breathingDot: string;
    }> = [
    { 
      id: "openai" as const, 
      name: "OpenAI", 
      icon: Sparkle, 
      color: "text-emerald-500",
      gradient: "from-emerald-500/15 to-teal-500/5 hover:from-emerald-500/20",
      breathingDot: "bg-emerald-500 shadow-[0_0_8px_#10b981]",
    },
    { 
      id: "anthropic" as const, 
      name: "Anthropic", 
      icon: ChatCircle, 
      color: "text-orange-500",
      gradient: "from-orange-500/15 to-amber-500/5 hover:from-orange-500/20",
      breathingDot: "bg-orange-500 shadow-[0_0_8px_#f97316]",
    },
    {
      id: "gemini" as const,
      name: "Gemini",
      icon: Sparkle,
      color: "text-blue-400",
      gradient: "from-blue-400/15 to-indigo-500/5 hover:from-blue-400/20",
      breathingDot: "bg-blue-400 shadow-[0_0_8px_#60a5fa]",
    },
    { 
      id: "ollama" as const, 
      name: "Ollama", 
      icon: Code, 
      color: "text-cyan-500",
      gradient: "from-cyan-500/15 to-blue-500/5 hover:from-cyan-500/20",
      breathingDot: "bg-cyan-500 shadow-[0_0_8px_#06b6d4]",
    },
    {
      id: "openrouter" as const,
      name: "OpenRouter",
      icon: Gear,
      color: "text-purple-500",
      gradient: "from-purple-500/15 to-pink-500/5 hover:from-purple-500/20",
      breathingDot: "bg-purple-500 shadow-[0_0_8px_#a855f7]",
    },
    {
      id: "deepseek" as const,
      name: "DeepSeek",
      icon: Waves,
      color: "text-blue-500",
      gradient: "from-blue-500/15 to-sky-500/5 hover:from-blue-500/20",
      breathingDot: "bg-blue-500 shadow-[0_0_8px_#3b82f6]",
    },
    ];

    if (assistantUseAppleFoundation && appleFmAvailable) {
      list.push({
        id: APPLE_FM_ASSISTANT_PROVIDER,
        name: appleFmProviderLabel,
        icon: Sparkle,
        color: "text-slate-500",
        gradient: "from-slate-500/15 to-zinc-500/5 hover:from-slate-500/20",
        breathingDot: "bg-slate-500 shadow-[0_0_8px_#64748b]",
      });
    }

    return list;
  }, [appleFmAvailable, appleFmProviderLabel, assistantUseAppleFoundation]);

  const scrollToBottom = () => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTo({
        top: messagesContainerRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    onInputHoverChange?.(isInputFocused || isInputHovered);
  }, [isInputFocused, isInputHovered, onInputHoverChange]);

  useEffect(() => {
    const conversationKey = getConversationKey(context);
    activeConversationKeyRef.current = conversationKey;
    const stored = readStoredConversations()[conversationKey];
    setMessages(stored?.messages ?? []);
    setInput(stored?.input ?? "");
    historyDraftRef.current = stored?.input ?? "";
    setHistoryIndex(null);
    lastContextSignatureRef.current = null;
    clearAttachedImages();
  }, [context?.type, context?.documentId, context?.url, context?.metadata?.videoId, context?.metadata?.title]);

  useEffect(() => {
    const key = activeConversationKeyRef.current;
    const conversations = readStoredConversations();
    conversations[key] = {
      messages: messages.slice(-MAX_STORED_MESSAGES),
      input,
      updatedAt: Date.now(),
    };
    writeStoredConversations(conversations);

    // Cross-device sync: publish this conversation to the shared Yjs doc so the
    // same chat appears beside the item on every device in the room. Debounced
    // (500ms trailing) so a burst of UI updates — typing in the input, a tool
    // call resolving — collapses to one publish rather than one per keystroke.
    // Images are stripped by the entity before they hit the wire.
    if (isTauri()) {
      if (publishConversationTimerRef.current !== null) {
        window.clearTimeout(publishConversationTimerRef.current);
      }
      publishConversationTimerRef.current = window.setTimeout(() => {
        publishConversationTimerRef.current = null;
      }, 500);
    }
  }, [messages, input]);

  // When a conversation arrives from another device, reload the active
  // conversation from localStorage (the entity already wrote it there) so the
  // chat mirrors across devices in near-real-time. Guarded so we don't clobber
  // an in-flight interaction: skip while a request is loading, or when the
  // input is focused+dirty (the user is mid-typing) and the remote key matches.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { key?: string } | undefined;
      const activeKey = activeConversationKeyRef.current;
      if (detail?.key && detail.key !== activeKey) return;
      if (isLoading) return;
      if (isInputFocused && input.trim().length > 0) return;
      const stored = readStoredConversations()[activeKey];
      setMessages(stored?.messages ?? []);
      // Don't overwrite a dirty input draft with the remote draft.
      if (!isInputFocused) setInput(stored?.input ?? "");
    };
    window.addEventListener("plethora:synced-conversation", handler);
    window.addEventListener("plethora:synced-conversation-deleted", handler);
    return () => {
      window.removeEventListener("plethora:synced-conversation", handler);
      window.removeEventListener("plethora:synced-conversation-deleted", handler);
    };
  }, [isLoading, isInputFocused, input]);

  useEffect(() => {
    persistAssistantProvider(selectedProvider);
  }, [selectedProvider]);

  // Sync external provider prop
  useEffect(() => {
    if (externalSelectedProvider && externalSelectedProvider !== selectedProvider) {
      setSelectedProvider(externalSelectedProvider);
    }
  }, [externalSelectedProvider]);

  useEffect(() => {
    let isActive = true;
    getAppMCPTools()
      .then((tools) => {
        if (isActive) {
          setAvailableTools(tools);
        }
      })
      .catch((error) => {
        console.error("Failed to load assistant tools:", error);
      });
    return () => {
      isActive = false;
    };
  }, []);

  // Paste handler on input container (not textarea — textarea doesn't fire paste for images)
  useEffect(() => {
    const container = inputContainerRef.current;
    if (!container) return;

    const handlePaste = (e: ClipboardEvent) => {
      if (isLoading) return;
      const items = e.clipboardData?.items;
      if (!items) return;

      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) attachImage(file);
          return;
        }
      }
      // Let text paste propagate normally
    };

    container.addEventListener("paste", handlePaste);
    return () => container.removeEventListener("paste", handlePaste);
  }, [isLoading, attachedImages.length]);

  // Drag-and-drop handler on input container
  useEffect(() => {
    const container = inputContainerRef.current;
    if (!container) return;

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer?.types.some((t) => t === "Files")) {
        setIsDragOver(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (isLoading) return;

      const files = Array.from(e.dataTransfer?.files ?? []);
      for (const file of files) {
        if (file.type.startsWith("image/")) {
          attachImage(file);
        }
      }
    };

    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("dragleave", handleDragLeave);
    container.addEventListener("drop", handleDrop);
    return () => {
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("dragleave", handleDragLeave);
      container.removeEventListener("drop", handleDrop);
    };
  }, [isLoading, attachedImages.length]);

  // Add context message when context changes
  useEffect(() => {
    if (context && appendContextMessages) {
      const signature = `${context.type}:${context.documentId ?? ""}:${context.url ?? ""}`;
      if (lastContextSignatureRef.current === signature) {
        return;
      }
      lastContextSignatureRef.current = signature;
      const contextMessage: Message = {
        id: `context-${Date.now()}`,
        role: "system",
        content: getContextMessage(context),
        timestamp: Date.now(),
      };
      setMessages((prev) => {
        if (
          prev.length > 0 &&
          prev[prev.length - 1].role === "system" &&
          prev[prev.length - 1].content === contextMessage.content
        ) {
          return prev;
        }
        return [...prev, contextMessage];
      });
    }
  }, [context]);

  const getContextMessage = (ctx: AssistantContext): string => {
    switch (ctx.type) {
      case "document": {
        const title = ctx.metadata?.title;
        const base = title
          ? `📄 ${title}`
          : `📄 Viewing document${ctx.documentId ? ` (ID: ${ctx.documentId})` : ""}`;
        let msg = `${base}${ctx.position?.pageNumber ? ` • Page ${ctx.position.pageNumber}` : ""}${typeof ctx.position?.scrollPercent === "number" ? ` • ${ctx.position.scrollPercent.toFixed(1)}%` : ""}${ctx.selection ? `. Selected text: "${ctx.selection.slice(0, 100)}..."` : ""}`;
        if (selectedSectionNodes.length > 0) {
          const focusLabels = selectedSectionNodes
            .map((n) => (n.breadcrumb.length > 0 ? `${n.breadcrumb.join(" > ")} > ${n.title}` : n.title))
            .join(", ");
          const tokens = selectedSectionNodes.map((n) => Math.ceil(n.content.length / 4)).reduce((a, b) => a + b, 0);
          msg += ` • Focused: ${focusLabels} (${tokens} tokens)`;
        }
        return msg;
      }
      case "web": {
        const title = ctx.metadata?.title;
        const base = title ? `🌐 ${title}` : `🌐 Browsing: ${ctx.url || "Unknown page"}`;
        return `${base}${ctx.selection ? `. Selected text: "${ctx.selection.slice(0, 100)}..."` : ""}`;
      }
      case "video":
        return `🎬 Watching video: ${ctx.metadata?.title || ctx.metadata?.videoId || "Unknown"}${typeof ctx.position?.currentTime === "number" ? ` • ${formatDuration(ctx.position.currentTime)}` : ""}${ctx.metadata?.duration ? ` / ${formatDuration(ctx.metadata.duration)}` : ""}${ctx.selection ? `. Selected text: "${ctx.selection.slice(0, 100)}..."` : ""}`;
      default:
        return "General context - Ready to help";
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const hours = Math.floor(mins / 60);
    if (hours > 0) {
      return `${hours}:${(mins % 60).toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  interface AssistantSubmitRequest {
    requestContent: string;
    displayContent?: string;
    images?: AttachedImage[];
    conversationHistoryOverride?: Message[];
    sourceContentOverride?: string;
    capturedDocumentContext?: CapturedDocumentContext;
    skipMemoryExtraction?: boolean;
    skipLocalCommands?: boolean;
    originatingMessageId?: string;
    restoreInputOnError?: string;
  }

  const appendMessagesIfSameConversation = (
    conversationKeyAtStart: string,
    updater: (prev: Message[]) => Message[],
  ) => {
    setMessages((prev) => {
      if (activeConversationKeyRef.current !== conversationKeyAtStart) return prev;
      return updater(prev);
    });
  };

  const submitAssistantRequest = async (request: AssistantSubmitRequest) => {
    if (isLoading) return;

    const conversationKeyAtStart = activeConversationKeyRef.current;
    toolExecutionContextRef.current = request.capturedDocumentContext
      ?? captureDocumentContext(context?.documentId, assistantDocumentTitle);

    if (request.originatingMessageId) {
      setFlashcardGeneratingMessageId(request.originatingMessageId);
    }

    const hasImages = (request.images?.length ?? 0) > 0;
    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: request.displayContent ?? request.requestContent,
      timestamp: Date.now(),
      images: hasImages ? [...(request.images ?? [])] : undefined,
    };

    appendMessagesIfSameConversation(conversationKeyAtStart, (prev) => [...prev, userMessage]);
    const userInput = request.requestContent;
    setIsLoading(true);

    try {
      if (!request.skipLocalCommands) {
        if (userInput === "/help") {
          const toolsList = getAvailableTools()
            .map((tool) => `• **${tool.name}** - ${tool.description}`)
            .join("\n");
          const helpMessage: Message = {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: `**Available Commands:**

/help - Show this help message
/tools - List available tools
/20rules - Formulate atomic flashcards following the 20 Rules of Knowledge Formulation (Minimum Information Principle, clozes, anti-interference)
/clear - Clear conversation

**Available Tools:**
${toolsList || "No tools available."}

**What I can do:**
- Answer questions about your documents (content is automatically provided)
- Create flashcards from the current document
- Create extracts from important passages
- Summarize and explain concepts

**Example prompts:**
- "/20rules" - Create atomic flashcards following the 20 Rules of Knowledge Formulation
- "Create 5 flashcards from this paper" - I'll extract key concepts and make Q&A or cloze cards
- "Summarize the main points" - I'll summarize the document content
- "What is the author's argument?" - I'll analyze the provided content
- "Save this quote as an extract" - I'll create an extract

**Tool Calls:**
When you ask me to create flashcards or extracts, I'll use tool calls like:
\`\`\`tool_calls
{"tool_calls":[{"name":"create_qa_card","arguments":{"question":"...","answer":"..."}}]}
\`\`\``,
            timestamp: Date.now(),
          };
          appendMessagesIfSameConversation(conversationKeyAtStart, (prev) => [...prev, helpMessage]);
          return;
        }

        if (userInput === "/tools") {
          const tools = getAvailableTools();
          const toolsList = tools.map((tool) => `• **${tool.name}** - ${tool.description}`).join("\n");
          const toolsMessage: Message = {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: `**Available Tools:**\n\n${toolsList}`,
            timestamp: Date.now(),
          };
          appendMessagesIfSameConversation(conversationKeyAtStart, (prev) => [...prev, toolsMessage]);
          return;
        }

        if (userInput === "/clear") {
          if (activeConversationKeyRef.current === conversationKeyAtStart) {
            setMessages([]);
          }
          return;
        }

        if (isTwentyRulesCommand(userInput)) {
          const stripped = stripTwentyRulesCommand(userInput);
          const hasContext = !!(
            context?.content ||
            context?.documentId ||
            context?.selection ||
            selectedSectionNodes.length > 0
          );
          if (!hasContext && !stripped && !request.sourceContentOverride) {
            const rulesReminderMessage: Message = {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: `${getTwentyRulesReminderMarkdown()}\n\n---\n💡 **Usage:** Open a document, chapter, or select text, then type \`/20rules\` (or click the **/20rules** button) to formulate atomic, high-retention flashcards adhering to spaced repetition best practices.`,
              timestamp: Date.now(),
            };
            appendMessagesIfSameConversation(conversationKeyAtStart, (prev) => [...prev, rulesReminderMessage]);
            return;
          }
        }

        if (useWholeLibraryScope) {
          try {
            const { askLibrary } = await import("../../lib/ai/tasks/definitions/libraryTask");
            const { resolveEmbeddingConfigForRag } = await import("./ragConfig");

            const config = await resolveEmbeddingConfigForRag();

            const result = await askLibrary({
              query: userInput,
              config,
            });

            const citationsBlock =
              result.sources.length > 0
                ? "\n\n---\n**Sources:**\n" +
                  result.sources
                    .map((c, i) => `[${i + 1}] ${c.documentTitle ?? c.documentId} (score ${c.score.toFixed(2)})`)
                    .join("\n")
                : "";

            const ragMessage: Message = {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: result.answer.answer + citationsBlock,
              timestamp: Date.now(),
            };
            appendMessagesIfSameConversation(conversationKeyAtStart, (prev) => [...prev, ragMessage]);
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorMsg: Message = {
              id: `assistant-${Date.now()}`,
              role: "assistant",
              content: `⚠️ Whole-library chat failed: ${errorMessage}\n\nMake sure your library is indexed (Settings → Embeddings → Library indexing) and an embedding provider is configured.`,
              timestamp: Date.now(),
            };
            appendMessagesIfSameConversation(conversationKeyAtStart, (prev) => [...prev, errorMsg]);
          }
          return;
        }
      }

      const filteredHistory = request.conversationHistoryOverride
        ?? messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(-10);

      const contextData = {
        currentContext: context,
        conversationHistory: filteredHistory,
        availableTools: getAvailableTools(),
        currentUserImages: userMessage.images,
        currentProvider: effectiveProvider,
        currentModel: useLLMProvidersStore.getState().providers.find((p) => p.provider === effectiveProvider)?.model,
        sourceContentOverride: request.sourceContentOverride,
      };

      const isTwentyRules = isTwentyRulesCommand(userInput);
      const response = await callLLM(userInput, contextData, isTwentyRules, Boolean(request.sourceContentOverride));
      if (request.sourceContentOverride && response.content.startsWith("Error calling LLM:")) {
        throw new Error(response.content.replace(/^Error calling LLM:\s*/, ""));
      }
      const { cleanedContent, toolCalls } = parseToolCalls(response.content);

      if (response.imagesStripped && response.modelName) {
        const warningMessage: Message = {
          id: `sys-${Date.now()}`,
          role: "system",
          content: `⚠️ ${response.modelName} doesn't support images. Sent text only. Switch to a vision-capable model to include images.`,
          timestamp: Date.now(),
        };
        appendMessagesIfSameConversation(conversationKeyAtStart, (prev) => [...prev, warningMessage]);
      }

      const displayContent = cleanedContent || (toolCalls.length > 0 ? "Running tool calls..." : response.content);
      const assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: displayContent,
        timestamp: Date.now(),
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        sourceContext: response.sourceContext,
      };

      appendMessagesIfSameConversation(conversationKeyAtStart, (prev) => [...prev, assistantMessage]);

      if (!request.skipMemoryExtraction && useSettingsStore.getState().settings.ai.memoryEnabled) {
        const chatHistory = [...messages, userMessage, assistantMessage].map((m) => {
          let mappedRole: "System" | "User" | "Assistant" = "System";
          if (m.role === "user") mappedRole = "User";
          else if (m.role === "assistant") mappedRole = "Assistant";
          return {
            role: mappedRole,
            content: m.content,
          };
        });
        invokeCommand("update_memory_from_chat", { messages: chatHistory }).catch((e) => {
          console.warn("Failed to update memory in background:", e);
        });
      }

      if (toolCalls.length > 0 && activeConversationKeyRef.current === conversationKeyAtStart) {
        const results = await executeToolCalls(assistantMessage.id, toolCalls);
        const confirmation = buildConfirmationMessage(results);
        if (confirmation) {
          const confirmationMessage: Message = {
            id: `assistant-confirm-${Date.now()}`,
            role: "assistant",
            content: confirmation,
            timestamp: Date.now(),
          };
          appendMessagesIfSameConversation(conversationKeyAtStart, (prev) => [...prev, confirmationMessage]);
        }
      }
    } catch (error) {
      if (request.restoreInputOnError !== undefined && activeConversationKeyRef.current === conversationKeyAtStart) {
        setInput(request.restoreInputOnError);
        historyDraftRef.current = request.restoreInputOnError;
      }
      const errorMessage: Message = {
        id: `error-${Date.now()}`,
        role: "system",
        content: `Error: ${error instanceof Error ? error.message : "Failed to get response"}`,
        timestamp: Date.now(),
      };
      appendMessagesIfSameConversation(conversationKeyAtStart, (prev) => [...prev, errorMessage]);
    } finally {
      toolExecutionContextRef.current = {};
      setFlashcardGeneratingMessageId(null);
      setIsLoading(false);
      if (!request.sourceContentOverride) {
        setSelectedSectionNodes([]);
      }
    }
  };

  const handleSendMessage = async () => {
    if ((!input.trim() && attachedImages.length === 0) || isLoading) return;

    const userInput = input;
    const images = attachedImages.length > 0 ? [...attachedImages] : undefined;
    setInput("");
    historyDraftRef.current = "";
    setHistoryIndex(null);
    clearAttachedImages();
    setShowSectionPopup(false);
    setSectionQuery("");

    await submitAssistantRequest({
      requestContent: userInput,
      images,
      restoreInputOnError: userInput,
    });
  };

  const handleCreateFlashcardsFromMessage = (sourceMessage: Message) => {
    const ineligibility = getFlashcardIneligibilityReason(sourceMessage);
    if (ineligibility) {
      toast.info(
        t(ASSISTANT_MESSAGE_FLASHCARD_DISPLAY_KEY),
        t(ASSISTANT_MESSAGE_FLASHCARD_UNAVAILABLE_KEY),
      );
      return;
    }
    if (isLoading || flashcardGeneratingMessageId === sourceMessage.id) return;

    const { requestContent, sourceContent } = buildAssistantMessageFlashcardRequest(sourceMessage.content);
    void submitAssistantRequest({
      requestContent,
      displayContent: t(ASSISTANT_MESSAGE_FLASHCARD_DISPLAY_KEY),
      conversationHistoryOverride: [],
      sourceContentOverride: sourceContent,
      capturedDocumentContext: captureDocumentContext(context?.documentId, assistantDocumentTitle),
      skipMemoryExtraction: true,
      skipLocalCommands: true,
      originatingMessageId: sourceMessage.id,
    });
  };

  const callLLM = async (
    prompt: string,
    contextData: Record<string, unknown>,
    isTwentyRules?: boolean,
    throwOnLlmError?: boolean,
  ): Promise<{ content: string; toolCalls?: ToolCall[]; imagesStripped?: boolean; modelName?: string; sourceContext?: SectionSourceReference }> => {
    const mentionCandidates = selectionSection
      ? [selectionSection, ...assistantSectionFlat]
      : assistantSectionFlat;
    const mentionResolution = resolvePromptSectionMentions(
      prompt,
      selectedSectionNodes,
      mentionCandidates,
    );
    const hasSectionMentions = mentionResolution.tokens.length > 0;
    if (mentionResolution.ambiguous.length > 0) {
      const detail = mentionResolution.ambiguousTitles.find(
        (entry) => entry.token === mentionResolution.ambiguous[0],
      );
      const names = detail?.titles.length ? ` (${detail.titles.join(", ")})` : "";
      throw new Error(
        `The section chip “${mentionResolution.ambiguous[0]}” matches more than one section${names}. Choose the intended section again; no request was made.`,
      );
    }
    if (mentionResolution.unresolved.length > 0) {
      throw new Error(
        `The section chip “${mentionResolution.unresolved[0]}” is no longer available. Choose it again; no request was made.`,
      );
    }
    const promptSectionNodes = mentionResolution.nodes;

    try {
      const toolInstruction = buildToolInstruction(getAvailableTools(), isTwentyRules);
      const effectivePrompt = isTwentyRules
        ? (stripTwentyRulesCommand(prompt) || "Create atomic flashcards from the provided content strictly following the 20 Rules of Knowledge Formulation.")
        : prompt;
      const currentUserImages = contextData.currentUserImages as AttachedImage[] | undefined;
      let resolvedUserPrompt = effectivePrompt;

      const llmContext = contextData.currentContext as AssistantContext;
      const contextWindow = contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : 2000;
      const isOllama = effectiveProvider === "ollama";
      const providerConfig = useLLMProvidersStore
        .getState()
        .providers.find((p) => p.provider === effectiveProvider && p.enabled)
        ?? useLLMProvidersStore.getState().providers.find((p) => p.provider === effectiveProvider);
      const policy = resolveRequestPolicy({
        provider: effectiveProvider,
        providerMaxOutput: providerConfig?.maxTokens,
        maxOutputOverride: providerConfig?.maxTokens,
        perModelOverride: providerConfig?.model
          ? providerConfig.modelContextWindows?.[providerConfig.model]
          : undefined,
        providerContextTokens: providerConfig?.contextWindowTokens,
        globalContextTokens: contextWindow,
        autoPreset: providerConfig?.contextWindowPreset === "auto",
        applyOllamaDefaultGuard: isOllama,
      });
      const promptBudget = policy.promptBudgetTokens;
      const frontendTrimRatio = isOllama ? 1 : 0.7;
      const effectiveContextWindow = isOllama
        ? promptBudget
        : (llmContext?.contextWindowTokens && llmContext.contextWindowTokens > 0
          ? llmContext.contextWindowTokens
          : contextWindow);
      const sourceContentOverride = typeof contextData.sourceContentOverride === "string"
        ? contextData.sourceContentOverride.trim()
        : "";

      const resolvedContext = sourceContentOverride
        ? {
            status: "ready" as const,
            content: sourceContentOverride,
            source: "document" as const,
          }
        : llmContext?.resolveForPrompt
          ? await llmContext.resolveForPrompt(prompt)
          : {
              status: llmContext?.status ?? "ready",
              content: typeof llmContext?.content === "string" ? llmContext.content : undefined,
              source: (llmContext?.source as any) ?? "document",
              message: llmContext?.statusMessage,
            };

      const selectionNodes = promptSectionNodes.filter(
        (n) => n.source === "selection" || n.source === "media-transcript",
      );
      const sectionNodes = promptSectionNodes.filter(
        (n) => n.source !== "selection" && n.source !== "media-transcript",
      );

      let finalResolvedContent = "";
      let sourceContext: SectionSourceReference | undefined;
      let selectionContext = "";
      let selectionTruncated = false;
      let contextContent = "";
      let usedDocumentFallback = false;

      if (sourceContentOverride) {
        finalResolvedContent = sourceContentOverride;
        contextContent = sourceContentOverride;
        resolvedUserPrompt = effectivePrompt;
      } else {
      finalResolvedContent = resolvedContext.content ?? "";
      if (selectionNodes.length > 0) {
        const built = buildSelectionFocusedContext(selectionNodes, { maxTokens: effectiveContextWindow, trimRatio: frontendTrimRatio });
        selectionContext = built.content;
        selectionTruncated = built.truncated;
      }

      if (sectionNodes.length > 0 && llmContext?.type === "document") {
        const documentId = llmContext.documentId;
        const realDocumentId = documentId && !documentId.startsWith("extract:") ? documentId : null;
        const attachedKey = documentId || "attached-content";

        let sectionText: string;
        let resolutionFlat: SectionNode[];
        if (realDocumentId) {
          sectionText = await loadDocumentQaText(realDocumentId, { getDocument, extractDocumentText });
          resolutionFlat = assistantSectionFlat;
        } else {
          sectionText = llmContext.content || context?.content || "";
          resolutionFlat = buildSectionsSnapshot(attachedKey, sectionText, undefined).flat;
        }

        let focused = resolveSectionFocusedContext(
          sectionNodes,
          resolutionFlat,
          sectionText,
          { documentId: attachedKey, maxTokens: effectiveContextWindow, includeNeighbors: true, trimRatio: frontendTrimRatio },
        );
        if (!focused.ok && realDocumentId) {
          sectionText = await loadDocumentQaText(realDocumentId, { getDocument, extractDocumentText });
          const freshFlat = buildSectionsSnapshot(
            realDocumentId,
            sectionText,
            useDocumentOutlineStore.getState().getOutline(realDocumentId),
          ).flat;
          focused = resolveSectionFocusedContext(
            sectionNodes,
            freshFlat,
            sectionText,
            { documentId: realDocumentId, maxTokens: effectiveContextWindow, includeNeighbors: true, trimRatio: frontendTrimRatio },
          );
        }
        if (!focused.ok) {
          if (!realDocumentId) {
            const kind = documentId?.startsWith("extract:") ? "extract" : "transcript";
            const detail = focused.unresolved.map(describeSectionDiagnostic).join("; ");
            throw new Error(
              `Could not focus the section within the attached ${kind}${detail ? `: ${detail}` : ""}. ` +
                "`#` mentions here match headings of the attached content; pick the section again from the list. No request was made.",
            );
          }
          const detail = focused.unresolved.map(describeSectionDiagnostic).join("; ");
          throw new Error(
            `Could not focus the selected section${detail ? `: ${detail}` : ""}. Reselect it before sending; no request was made.`,
          );
        }
        finalResolvedContent = selectionContext
          ? `${focused.content}\n\n---\n\n${selectionContext}`
          : focused.content;
        sourceContext = focused.source;
        const request = createDocumentQaRequestContent({
          documentContext: finalResolvedContent,
          userQuestion: prompt.replace(/#{([^}]+)}/g, "").trim(),
          focusLabel: [...focused.labels, ...selectionNodes.map((n) => n.title)].join(", "),
        });
        resolvedUserPrompt = request.userPromptContent;
      } else if (selectionNodes.length > 0) {
        finalResolvedContent = selectionContext;
        sourceContext = {
          documentId: llmContext?.documentId,
          sectionIds: selectionNodes.map((n) => n.id),
          labels: selectionNodes.map((n) => n.title),
          contentHash: hashSectionContent(selectionContext),
          contextKey: hashSectionContent(`selection:${selectionNodes.map((n) => n.id).join(",")}`),
          ranges: [],
        };
      }

      if (selectionTruncated) {
        toast.info(t("assistant.selectionTruncated"), t("assistant.selectionTruncatedDesc"));
      }

      contextContent = typeof finalResolvedContent === "string"
        ? finalResolvedContent.trim()
        : typeof resolvedContext.content === "string"
          ? resolvedContext.content.trim()
          : "";

      if ((!contextContent || resolvedContext.status !== "ready")
          && llmContext?.type === "document" && llmContext.documentId
          && selectionNodes.length === 0) {
        const fallbackText = (await loadDocumentQaText(
          llmContext.documentId,
          { getDocument, extractDocumentText },
        )).trim();
        if (fallbackText) {
          finalResolvedContent = fallbackText;
          contextContent = fallbackText;
          usedDocumentFallback = true;
        }
      }

      const hasExplicitSelectionContext = selectionNodes.length > 0 && selectionContext.trim().length > 0;
      if (((!usedDocumentFallback && resolvedContext.status !== "ready") && !hasExplicitSelectionContext) || !contextContent) {
        throw new Error(resolvedContext.message || getAssistantContextErrorMessage(llmContext?.status));
      }
      }

      if (!sourceContentOverride && !contextContent) {
        throw new Error("No source content available for this request.");
      }

      if (isAppleFmAssistantProvider(effectiveProvider)) {
        if (!assistantUseAppleFoundation || !appleFmAvailable) {
          return {
            content: "Apple Intelligence is not available. Enable it in Settings → AI → On-device AI.",
          };
        }

        let imagesStripped = false;
        if (currentUserImages && currentUserImages.length > 0) {
          imagesStripped = true;
        }

        const appleFmUserPrompt = sectionNodes.length > 0
          ? (prompt.replace(/#{([^}]+)}/g, "").trim() || effectivePrompt)
          : effectivePrompt;
        const fmResponse = await runAssistantAppleFmChat({
          systemInstruction: toolInstruction,
          conversationHistory: (contextData.conversationHistory as Message[]).map((m) => ({
            role: m.role,
            content: m.content,
          })),
          userPrompt: appleFmUserPrompt,
          documentContext: contextContent || undefined,
          maxOutputTokens: contextWindowTokens,
        });

        return {
          content: fmResponse.content,
          imagesStripped,
          modelName: appleFmProviderLabel,
          sourceContext,
        };
      }

      const allProviders = useLLMProvidersStore.getState().providers;
      const enabledProviders = useLLMProvidersStore.getState().getEnabledProviders();

      const selectedTypeProvider = allProviders.find((p) => p.provider === effectiveProvider);

      if (!selectedTypeProvider) {
        const availableTypes = enabledProviders.map((p) => p.provider).join(", ");
        return {
          content: `No ${effectiveProvider} provider configured. Available providers: ${availableTypes || "None"}. Please add an API key in Settings.`,
        };
      }

      if (!selectedTypeProvider.enabled) {
        return {
          content: `The ${effectiveProvider} provider is configured but disabled. Please enable it in Settings, or select a different provider.`,
        };
      }

      if (providerRequiresApiKey(selectedTypeProvider.provider, selectedTypeProvider.baseUrl) && (!selectedTypeProvider.apiKey || !selectedTypeProvider.apiKey.trim())) {
        return {
          content: `${effectiveProvider} provider found but API key is empty. Please remove and re-add the provider in Settings.`,
        };
      }

      const provider = selectedTypeProvider;

      const llmMessages: LLMMessage[] = [
        {
          role: "system" as const,
          content: toolInstruction,
        },
        ...(contextData.conversationHistory as Message[]).map((m) => {
          if (m.images && m.images.length > 0) {
            const parts: LLMMessageContentPart[] = [];
            if (m.content.trim()) {
              parts.push({ type: "text", text: m.content });
            }
            for (const img of m.images) {
              parts.push({ type: "image_url", imageUrl: img.dataUrl });
            }
            return {
              role: m.role as "system" | "user" | "assistant",
              content: parts,
            };
          }
          return {
            role: m.role as "system" | "user" | "assistant",
            content: m.content,
          };
        }),
        {
          role: "user" as const,
          content: resolvedUserPrompt,
        },
      ];

      let imagesStripped = false;
      const modelName = (provider.model || effectiveProvider) as string;

      if (currentUserImages && currentUserImages.length > 0) {
        const hasVision = supportsVision(effectiveProvider, modelName);
        if (!hasVision) {
          const lastUserIdx = llmMessages.map((m) => m.role).lastIndexOf("user");
          if (lastUserIdx >= 0) {
            llmMessages[lastUserIdx] = {
              role: "user",
              content: prompt,
            };
          }
          imagesStripped = true;
        } else {
          const parts: LLMMessageContentPart[] = [];
          if (prompt.trim()) {
            parts.push({ type: "text", text: prompt });
          }
          for (const img of currentUserImages) {
            parts.push({ type: "image_url", imageUrl: img.dataUrl });
          }
          const lastUserIdx2 = llmMessages.map((m) => m.role).lastIndexOf("user");
          llmMessages[lastUserIdx2] = {
            role: "user" as const,
            content: parts,
          };
        }
      }

      const llmContextData = {
        type: llmContext?.type || "general",
        documentId: llmContext?.documentId,
        url: llmContext?.url,
        selection: llmContext?.selection,
        content: finalResolvedContent || contextContent,
        contextWindowTokens: promptBudget,
        promptBudgetTokens: promptBudget,
        configuredContextTokens: policy.configuredContextTokens,
        maxOutputTokens: policy.maxOutputTokens,
        memoryEnabled: useSettingsStore.getState().settings.ai.memoryEnabled,
      };

      const response = await chatWithContext(
        effectiveProvider as LLMProvider,
        provider.model,
        llmMessages,
        llmContextData,
        provider.apiKey,
        provider.baseUrl && provider.baseUrl.trim() ? provider.baseUrl : undefined,
        provider.temperature,
        provider.maxTokens,
        provider.systemPrompt,
        aiControls?.contextFromRelatedCards,
        aiControls?.documentSnippetLength
      );

      return { content: response.content, imagesStripped, modelName, sourceContext };
    } catch (error) {
      console.error("LLM API error:", error);
      if (hasSectionMentions || throwOnLlmError) throw error;
      // Better error handling - Tauri errors can be strings or objects
      const errorMessage = error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : JSON.stringify(error);
      return {
        content: `Error calling LLM: ${errorMessage}`,
      };
    }
  };

  const getAvailableTools = () => {
    return availableTools;
  };

  const parseToolCalls = (content: string) => {
    const knownToolNames = new Set(availableTools.map((t) => t.name));
    const toolCalls: ToolCall[] = [];
    const toolCallRegex = /```tool_calls\s*([\s\S]*?)```/g;
    let cleanedContent = content;
    let match: RegExpExecArray | null;

    const extractCalls = (parsed: unknown): Array<{ name?: string; arguments?: Record<string, unknown> }> => {
      if (Array.isArray(parsed)) return parsed;
      if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).tool_calls)) {
        return (parsed as Record<string, unknown>).tool_calls as Array<{ name?: string; arguments?: Record<string, unknown> }>;
      }
      if (parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).name === "string") {
        return [parsed as { name?: string; arguments?: Record<string, unknown> }];
      }
      return [];
    };

    while ((match = toolCallRegex.exec(content)) !== null) {
      const raw = match[1].trim();
      try {
        const parsed = JSON.parse(raw);
        const calls = extractCalls(parsed);

        calls.forEach((call: { name?: string; arguments?: Record<string, unknown> }) => {
          if (typeof call?.name === "string" && knownToolNames.has(call.name)) {
            const args = call.arguments;
            const normalizedArgs = args && typeof args === "object" && !Array.isArray(args)
              ? args
              : {};
            toolCalls.push({
              name: call.name,
              parameters: normalizedArgs,
              status: "pending",
            });
          }
        });
        cleanedContent = cleanedContent.replace(match[0], "").trim();
      } catch (error) {
        console.warn("Failed to parse tool call block:", error);
      }
    }

    // Fallback 1: try to parse unfenced JSON containing recognized tool names
    // Uses brace/bracket depth matching instead of regex to handle nested JSON like {"tool_calls":[...]}.
    if (toolCalls.length === 0 && knownToolNames.size > 0) {
      const jsonCandidatePositions: number[] = [];
      for (let i = 0; i < cleanedContent.length; i += 1) {
        if (cleanedContent[i] === "{" || cleanedContent[i] === "[") {
          jsonCandidatePositions.push(i);
        }
      }
      for (const startPos of jsonCandidatePositions) {
        const opener = cleanedContent[startPos];
        const closer = opener === "{" ? "}" : "]";
        let depth = 0;
        let endPos = -1;
        for (let i = startPos; i < cleanedContent.length; i += 1) {
          if (cleanedContent[i] === opener) depth += 1;
          else if (cleanedContent[i] === closer) {
            depth -= 1;
            if (depth === 0) { endPos = i + 1; break; }
          }
        }
        if (endPos === -1) continue;
        const raw = cleanedContent.slice(startPos, endPos).trim();
        try {
          const parsed = JSON.parse(raw);
          const calls = extractCalls(parsed);
          const validCalls = calls.filter((call) => typeof call?.name === "string" && knownToolNames.has(call.name));
          if (validCalls.length > 0) {
            validCalls.forEach((call) => {
              const args = call.arguments;
              const normalizedArgs = args && typeof args === "object" && !Array.isArray(args) ? args : {};
              toolCalls.push({ name: call.name!, parameters: normalizedArgs, status: "pending" });
            });
            cleanedContent = cleanedContent.slice(0, startPos) + cleanedContent.slice(endPos);
            cleanedContent = cleanedContent.replace(/\n{3,}/g, "\n\n").trim();
          } else if (knownToolNames.has("create_qa_card") && Array.isArray(parsed)) {
            let foundCards = false;
            for (const item of parsed) {
              if (item && typeof item === "object") {
                const q = item.question ?? item.Q ?? item.q;
                const a = item.answer ?? item.A ?? item.a;
                if (typeof q === "string" && typeof a === "string") {
                  toolCalls.push({ name: "create_qa_card", parameters: { question: q, answer: a }, status: "pending" });
                  foundCards = true;
                }
              }
            }
            if (foundCards) {
              cleanedContent = cleanedContent.slice(0, startPos) + cleanedContent.slice(endPos);
              cleanedContent = cleanedContent.replace(/\n{3,}/g, "\n\n").trim();
            }
          }
        } catch {
          // Not valid JSON — leave untouched
        }
      }
    }

    // Fallback 2: convert fenced JSON arrays of {question, answer} into create_qa_card calls
    if (toolCalls.length === 0 && knownToolNames.has("create_qa_card")) {
      const jsonArrRegex = /```(?:json)?\s*\n?([\s\S]*?)```/g;
      let arrMatch: RegExpExecArray | null;
      while ((arrMatch = jsonArrRegex.exec(cleanedContent)) !== null) {
        const raw = arrMatch[1].trim();
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (item && typeof item === "object") {
                const q = item.question ?? item.Q ?? item.q;
                const a = item.answer ?? item.A ?? item.a;
                if (typeof q === "string" && typeof a === "string") {
                  toolCalls.push({ name: "create_qa_card", parameters: { question: q, answer: a }, status: "pending" });
                }
              }
            }
            cleanedContent = cleanedContent.replace(arrMatch[0], "").trim();
          }
        } catch {
        /* Image paste handling may fail */ }
      }
    }

    // Fallback 3: convert UNFENCED JSON arrays of {question, answer} into create_qa_card calls
    // This catches the common case where the LLM outputs raw JSON without code fences.
    if (toolCalls.length === 0 && knownToolNames.has("create_qa_card")) {
      // Strategy: find JSON arrays that start with [{ and contain question/answer-like keys.
      // Use a relaxed regex that only needs to match the start of the first object.
      const arrayLikeRegex = /\[\s*\{[^}]*?(?:question|Q|q)\s*:/s;
      let arrMatch = arrayLikeRegex.exec(cleanedContent);
      if (arrMatch) {
        try {
          // Try to find the full array by extending from the match start
          const start = arrMatch.index;
          const afterMatch = cleanedContent.slice(start);
          const arrayStart = afterMatch.indexOf('[');
          if (arrayStart !== -1) {
            // Find the matching closing bracket
            let depth = 0;
            let end = -1;
            for (let i = arrayStart; i < afterMatch.length; i += 1) {
              if (afterMatch[i] === '[') depth += 1;
              else if (afterMatch[i] === ']') {
                depth -= 1;
                if (depth === 0) {
                  end = i + 1;
                  break;
                }
              }
            }
            if (end !== -1) {
              const raw = afterMatch.slice(arrayStart, end);
              const parsed = JSON.parse(raw);
              if (Array.isArray(parsed)) {
                let foundCards = false;
                for (const item of parsed) {
                  if (item && typeof item === "object") {
                    const q = item.question ?? item.Q ?? item.q;
                    const a = item.answer ?? item.A ?? item.a;
                    if (typeof q === "string" && typeof a === "string") {
                      toolCalls.push({ name: "create_qa_card", parameters: { question: q, answer: a }, status: "pending" });
                      foundCards = true;
                    }
                  }
                }
                if (foundCards) {
                  cleanedContent = cleanedContent.slice(0, start + arrayStart) + cleanedContent.slice(start + end);
                  cleanedContent = cleanedContent.replace(/\n{3,}/g, '\n\n').trim();
                }
              }
            }
          }
        } catch {
          // Not valid JSON — leave untouched
        }
      }
    }

    return { cleanedContent, toolCalls };
  };

  const executeToolCalls = async (messageId: string, calls: ToolCall[]) => {
    const results: Array<{ name: string; status: "success" | "error"; count?: number; error?: string }> = [];
    // Track deck names created in this batch so we can tag subsequent cards with matching tags
    const batchDeckNames: string[] = [];
    const createsCards = calls.some((call) => CARD_CREATION_TOOL_NAMES.has(call.name));
    const resolvedDocumentTitle = createsCards
      ? await resolveDocumentTitleForCards()
      : assistantDocumentTitle;
    const missingDocumentDeckTitle = Boolean(
      createsCards
      && (toolExecutionContextRef.current.documentId ?? context?.documentId)
      && !getDocumentDeckName(resolvedDocumentTitle),
    );

    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      const createdCount = call.name === "batch_create_cards" && Array.isArray(call.parameters.cards)
        ? call.parameters.cards.length
        : 1;
      if (missingDocumentDeckTitle && CARD_CREATION_TOOL_NAMES.has(call.name)) {
        const error = "Could not resolve the document title, so the card was not saved without its document deck.";
        updateToolCall(messageId, index, { status: "error", result: error });
        results.push({ name: call.name, status: "error", count: createdCount, error });
        continue;
      }
      let parameters = normalizeToolParameters(call.name, call.parameters, resolvedDocumentTitle);

      // If this is a card/extract call and we created decks earlier in this batch,
      // ensure the card tags include the deck names so tag-based filtering works.
      if (batchDeckNames.length > 0) {
        if (ATTACHABLE_TOOL_NAMES.has(call.name)) {
          const existingTags: string[] = Array.isArray(parameters.tags)
            ? parameters.tags.map((t: unknown) => String(t))
            : [];
          for (const deckName of batchDeckNames) {
            const normalized = deckName.toLowerCase();
            const hasMatch = existingTags.some(
              (t) => t.toLowerCase() === normalized || t.toLowerCase() === `deck:${normalized}`
            );
            if (!hasMatch) {
              existingTags.push(deckName);
            }
          }
          parameters = { ...parameters, tags: existingTags };
        }
      }

      updateToolCall(messageId, index, { parameters });

      try {
        const result = await callAppMCPTool(call.name, parameters);
        // Check if the MCP tool itself reported an error (e.g. DB write failure)
        if (result.isError) {
          console.warn("[Assistant] Tool reported error:", call.name, result);
          updateToolCall(messageId, index, {
            result: JSON.stringify(result.content),
            status: "error",
          });
          results.push({ name: call.name, status: "error", count: createdCount, error: "Tool returned error" });
        } else {
          updateToolCall(messageId, index, { result, status: "success" });
          results.push({ name: call.name, status: "success", count: createdCount });
        }

        // The extract was created directly by the Rust-side MCP tool, bypassing
        // api/extracts.ts's createExtract(), so patch the documentStore count
        // here too or the Documents grid shows a stale extractCount.
        if (call.name === "create_extract" && !result.isError) {
          const documentId = parameters.document_id as string | undefined;
          if (documentId) {
            void patchDocumentExtractCount(documentId, 1);
          }
        }

        // Sync deck creation to frontend store and track for card tagging
        if (call.name === "create_deck" && !result.isError) {
          try {
            const parsed = JSON.parse(result.content?.[0]?.text ?? "{}");
            if (parsed.success && parsed.name) {
              useStudyDeckStore.getState().addDeck(parsed.name, parsed.tags ?? [parsed.name]);
              batchDeckNames.push(parsed.name);
            }
          } catch { /* non-critical */ }
        }

        // Auto-create deck in frontend store from tags on card creation
        if (!result.isError && parameters.tags && Array.isArray(parameters.tags)) {
          for (const tag of parameters.tags as string[]) {
            const deckName = tag.startsWith("deck:") ? tag.slice(5) : null;
            if (deckName) {
              const store = useStudyDeckStore.getState();
              const baseName = deckName.replace(/\s*\([^)]*\)\s*$/, "").trim() || deckName;
              const documentId = parameters.document_id as string | undefined;
              // addDeck deduplicates by name and repairs an existing entry.
              // A document deck is document-scoped rather than tag-only, which
              // also includes older audiobook cards created without deck tags.
              store.addDeck(baseName, [baseName], documentId, documentId ? "all" : "tags");
            }
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        updateToolCall(messageId, index, {
          result: errorMsg,
          status: "error",
        });
        results.push({ name: call.name, status: "error", count: createdCount, error: errorMsg });
      }
    }

    return results;
  };

  const buildConfirmationMessage = (results: Array<{ name: string; status: "success" | "error"; count?: number; error?: string }>) => {
    const succeeded = results.filter((r) => r.status === "success");
    const failed = results.filter((r) => r.status === "error");

    const parts: string[] = [];

    if (succeeded.length > 0) {
      const counts: Record<string, number> = {};
      succeeded.forEach((r) => {
        counts[r.name] = (counts[r.name] || 0) + (r.count ?? 1);
      });

      const hasCards = counts["create_qa_card"] || counts["create_cloze_card"] || counts["batch_create_cards"];
      const hasDeck = counts["create_deck"];

      if (hasDeck && !hasCards) {
        // Deck was created but no cards — likely the LLM didn't include card calls
        parts.push(`⚠️ Deck created but no flashcards were saved. The AI may have only created the deck without the card tool calls. Try asking again to add cards.`);
      } else {
        const summaries = Object.entries(counts).map(([name, count]) => {
          const label = name === "create_qa_card" || name === "create_cloze_card" || name === "batch_create_cards"
            ? `${count} flashcard${count > 1 ? "s" : ""}`
            : name === "create_extract"
              ? `${count} extract${count > 1 ? "s" : ""}`
              : name === "create_document"
                ? `${count} document${count > 1 ? "s" : ""}`
                : `${count} ${name}${count > 1 ? "s" : ""}`;
          return label;
        });
        parts.push(`Created ${summaries.join(", ")} and saved to your library.`);
      }
    }

    if (failed.length > 0) {
      const errors = failed.map((r) => `${r.name}: ${r.error}`).join("; ");
      parts.push(`Failed: ${errors}`);
    }

    return parts.join(" ");
  };

  const updateToolCall = (messageId: string, index: number, updates: Partial<ToolCall>) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId || !message.toolCalls) return message;
        const updatedCalls = message.toolCalls.map((call, callIndex) =>
          callIndex === index ? { ...call, ...updates } : call
        );
        return { ...message, toolCalls: updatedCalls };
      })
    );
  };

  const resolveDocumentTitleForCards = async (): Promise<string | undefined> => {
    if (toolExecutionContextRef.current.documentTitle?.trim()) {
      return toolExecutionContextRef.current.documentTitle;
    }
    if (assistantDocumentTitle?.trim()) return assistantDocumentTitle;
    const documentId = toolExecutionContextRef.current.documentId ?? context?.documentId;
    if (!documentId) return undefined;
    try {
      return (await getDocument(documentId))?.title?.trim() || undefined;
    } catch (error) {
      console.warn("[Assistant] Could not resolve document title for generated-card deck:", error);
      return undefined;
    }
  };

  const normalizeToolParameters = (
    toolName: string,
    parameters: Record<string, unknown>,
    documentTitleOverride?: string,
  ) => {
    const normalized = { ...parameters };
    const documentId = toolExecutionContextRef.current.documentId ?? context?.documentId;
    const deckName = getDocumentDeckName(
      documentTitleOverride
        ?? toolExecutionContextRef.current.documentTitle
        ?? assistantDocumentTitle,
    );

    if (documentId && ATTACHABLE_TOOL_NAMES.has(toolName)) {
      normalized.document_id = documentId;
    }

    // Auto-tag with deck:<base title> for card/extract tools.
    // Strips parenthetical author info (e.g. "Book (Author)" → "deck:Book")
    // so tags match deck names more reliably.
    if (deckName && ATTACHABLE_TOOL_NAMES.has(toolName)) {
      const deckTag = `deck:${deckName}`;
      const existingTags: string[] = Array.isArray(normalized.tags)
        ? normalized.tags
          .map((t: unknown) => String(t))
          .filter((tag) => !tag.toLowerCase().startsWith("deck:"))
        : [];
      normalized.tags = [...existingTags, deckTag];
    }

    return normalized;
  };

  const openChatCard = (artifact: ChatFlashcardArtifact) => {
    if (!artifact.persistedCardId) return;
    sessionStorage.setItem("plethora:pending-flashcard-id", artifact.persistedCardId);
    window.dispatchEvent(new CustomEvent("plethora:open-flashcard", {
      detail: { cardId: artifact.persistedCardId, artifact },
    }));
  };

  const findChatDeck = (name: string) => {
    const normalized = name.trim().toLowerCase();
    return useStudyDeckStore.getState().decks.find((deck) => deck.name.trim().toLowerCase() === normalized);
  };

  const createChatDeck = (name: string) => {
    const store = useStudyDeckStore.getState();
    store.addDeck(name, [name], context?.documentId, context?.documentId ? "all" : "tags");
    toast.success("Deck created", `“${name}” is ready in Review.`);
  };

  const openChatDeck = (name: string) => {
    const deck = findChatDeck(name);
    if (!deck) {
      toast.error("Deck unavailable", `Create “${name}” first.`);
      return;
    }
    useReviewStore.getState().setSelectedDeckId(deck.id);
    useReviewStore.getState().setReviewTabMode("deck-manager");
    useTabsStore.getState().addTab({
      title: "Review",
      icon: "🧠",
      type: "review",
      content: ReviewTab,
      closable: true,
    });
  };

  const copyChatCards = async (artifacts: ChatFlashcardArtifact[]) => {
    const markdown = artifacts.map((artifact, index) => {
      if (artifact.type === "qa") {
        return `${index + 1}. **Q:** ${artifact.front}\n   **A:** ${artifact.back ?? ""}`;
      }
      return `${index + 1}. ${artifact.front}`;
    }).join("\n\n");
    const success = await copyToClipboard(markdown);
    if (success) toast.success("Flashcards copied", `${artifacts.length} card${artifacts.length === 1 ? "" : "s"} copied to the clipboard.`);
    else toast.error("Could not copy flashcards");
    return success;
  };

  const retryChatCard = async (messageId: string, artifact: ChatFlashcardArtifact) => {
    const message = messages.find((item) => item.id === messageId);
    const call = message?.toolCalls?.[artifact.callIndex];
    if (!call) return;
    updateToolCall(messageId, artifact.callIndex, { status: "pending", result: undefined });
    try {
      const parameters = normalizeToolParameters(
        call.name,
        call.parameters,
        await resolveDocumentTitleForCards(),
      );
      const result = await callAppMCPTool(call.name, parameters);
      updateToolCall(messageId, artifact.callIndex, {
        parameters,
        status: result.isError ? "error" : "success",
        result: result.isError ? JSON.stringify(result.content) : result,
      });
    } catch (error) {
      updateToolCall(messageId, artifact.callIndex, {
        status: "error",
        result: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const buildToolInstruction = (tools: MCPTool[], isTwentyRules?: boolean) => {
    if (tools.length === 0) {
      return isTwentyRules
        ? `Answer normally. Tool calls are unavailable.\n\n${buildTwentyRulesSystemPrompt()}`
        : "Answer normally. Tool calls are unavailable.";
    }
    const toolNames = tools.map((tool) => tool.name).join(", ");
    const toolDescriptions = tools.map((tool) => `- **${tool.name}**: ${tool.description}`).join("\n");

    const cardToolNames = tools
      .filter((t) => t.name.includes("card") || t.name.includes("cloze") || t.name === "batch_create_cards")
      .map((t) => t.name)
      .join(", ");
    const sharedCardPolicy = buildFlashcardToolInstruction(tools.map((tool) => tool.name));
    const twentyRulesPolicy = isTwentyRules ? `\n\n${buildTwentyRulesSystemPrompt()}` : "";

    return `You are a helpful assistant with access to document content and tools. You can answer questions about the content AND create learning items from it.

**Available Tools**: ${toolNames}

${toolDescriptions}

${sharedCardPolicy}${twentyRulesPolicy}

## CRITICAL RULES — Respond vs. Act

**When the user asks to CREATE, SAVE, ADD, or MAKE something** — you MUST emit tool calls, NOT output raw JSON or markdown.
- "create flashcards", "make cards", "generate qa cards", "add flashcards" → use ${cardToolNames}
- "save this as an extract", "save this quote" → use create_extract
- "create a document" → use create_document
- "make cloze cards" → use create_cloze_card

**When the user asks a question or wants an explanation** — respond conversationally, NO tool calls.
- "what does this mean?", "explain X", "summarize this" → just answer in plain text

**NEVER output raw JSON, markdown tables, or bullet lists of flashcards.** ALWAYS use the tool_calls format below.

## Tool call format (REQUIRED — you MUST use EXACTLY this format):

Output a SINGLE JSON code block with ALL tool calls combined. When the user asks to both create a deck AND create cards, you MUST include BOTH the create_deck call AND every card call in the SAME block. Never split actions across multiple blocks.

\`\`\`tool_calls
{"tool_calls":[{"name":"tool_name","arguments":{"key":"value"}},{"name":"another_tool","arguments":{"key":"value"}}]}
\`\`\`

- The block MUST start with \`\`\`tool_calls and end with \`\`\`
- Include ALL actions in a SINGLE block — do NOT create partial output
- Each call has "name" (one of: ${toolNames}) and "arguments" (an object)
- For flashcards: use "question" and "answer" fields
- For cloze: use "text" field with {{cloze}} markers
- Do NOT include document_id — it is added automatically

## Example — user says "create a deck called Physics and add 2 flashcards":
\`\`\`tool_calls
{"tool_calls":[
  {"name":"create_deck","arguments":{"name":"Physics"}},
  {"name":"create_qa_card","arguments":{"question":"What is Newton's first law?","answer":"An object at rest stays at rest unless acted upon by a force."}},
  {"name":"create_qa_card","arguments":{"question":"What is the speed of light?","answer":"Approximately 299,792,458 meters per second."}}
]}
\`\`\`

Do NOT output flashcards as plain JSON arrays, markdown, or anything other than the tool_calls format above.`;
  };

  const handleHistoryNavigation = (direction: "up" | "down") => {
    const history = getUserInputHistory(messages);
    if (history.length === 0) return;

    if (direction === "up") {
      if (historyIndex === null) {
        historyDraftRef.current = input;
        setHistoryIndex(0);
        setInput(history[0]);
        return;
      }

      const nextIndex = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex]);
      return;
    }

    if (historyIndex === null) return;

    if (historyIndex === 0) {
      setHistoryIndex(null);
      setInput(historyDraftRef.current);
      return;
    }

    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    setInput(history[nextIndex]);
  };

  const handleInputChange = (value: string) => {
    setInput(value);
    if (historyIndex === null) {
      historyDraftRef.current = value;
    }

    const textarea = textareaRef.current;
    const cursorPos = textarea ? textarea.selectionStart : value.length;
    const beforeCursor = value.slice(0, cursorPos);
    const hashMatch = beforeCursor.match(/#([^#\s]*)$/);

    if (context?.type !== "document") {
      // `#` has no document to draw sections from in this context. Show the
      // popup with an explanation instead of silently doing nothing.
      if (hashMatch) {
        setShowSectionPopup(true);
        setSectionQuery(hashMatch[1]);
        setSectionCursorIndex(0);
      } else {
        setShowSectionPopup(false);
        setSectionQuery("");
      }
      return;
    }

    if (hashMatch) {
      setShowSectionPopup(true);
      setSectionQuery(hashMatch[1]);
      setSectionCursorIndex(0);
    } else {
      setShowSectionPopup(false);
      setSectionQuery("");
    }

    // SECTION_REGEX is global because the send path removes every mention.
    // RegExp.test() advances a global regex's lastIndex, though, so consecutive
    // keystrokes after inserting one token alternated true/false and silently
    // dropped the selected section while leaving the visible token in place.
    SECTION_REGEX.lastIndex = 0;
    const hasTokens = SECTION_REGEX.test(value);
    SECTION_REGEX.lastIndex = 0;
    if (!hasTokens && selectedSectionNodes.length > 0) {
      setSelectedSectionNodes([]);
    }
  };

  const handleSelectAssistantSection = (node: SectionNode) => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    const cursorPos = textarea.selectionStart;
    const beforeCursor = input.slice(0, cursorPos);
    const hashMatch = beforeCursor.match(/#([^#\s]*)$/);
    if (hashMatch) {
      const hashPos = cursorPos - hashMatch[0].length;
      // Insert the node's stable id (rendered as its title chip by
      // renderUserMessageContent); a title token could be dropped by later
      // matching and can break when titles contain token characters.
      const token = `#{${node.id}}`;
      const newValue = input.slice(0, hashPos) + token + " " + input.slice(cursorPos);
      setInput(newValue);
      setSelectedSectionNodes((prev) => {
        if (prev.find((n) => n.id === node.id)) return prev;
        return [...prev, node];
      });
      setShowSectionPopup(false);
      setSectionQuery("");
      setTimeout(() => {
        const newPos = hashPos + token.length + 1;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
      }, 0);
    }
  };

  const handleRemoveAssistantSection = (id: string) => {
    const node = selectedSectionNodes.find((n) => n.id === id);
    setSelectedSectionNodes((prev) => prev.filter((n) => n.id !== id));
    if (node) {
      const newInput = input
        .replace(`#{${node.title}}`, "")
        .replace(`#{${node.id}}`, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      setInput(newInput);
    }
  };

  const getFilteredAssistantSections = () => {
    // The live selection is offered as the first entry (matching the popup),
    // so keyboard navigation and the rendered list stay consistent.
    const base = selectionSection
      ? [selectionSection, ...assistantSectionFlat]
      : assistantSectionFlat;
    if (!sectionQuery) return base;
    const q = sectionQuery.toLowerCase();
    const selectionMatches = (sec: SectionNode) =>
      sec.source === "selection" &&
      ((sec.title.toLowerCase().includes(q)) || (sec.content || "").toLowerCase().includes(q));
    return base
      .map((sec) => {
        const titleLower = sec.title.toLowerCase();
        const breadLower = sec.breadcrumb.join(" > ").toLowerCase();
        let score = 0;
        if (titleLower.startsWith(q)) score += 100;
        else if (titleLower.includes(q)) score += 50;
        if (breadLower.includes(q)) score += 20;
        if (selectionMatches(sec)) score += 5;
        return { sec, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 100)
      .map((s) => s.sec);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSectionPopup) {
      const filtered = getFilteredAssistantSections();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSectionCursorIndex((prev) => (prev < filtered.length - 1 ? prev + 1 : prev));
        return;
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSectionCursorIndex((prev) => (prev > 0 ? prev - 1 : 0));
        return;
      } else if (e.key === "Enter" && filtered.length > 0) {
        e.preventDefault();
        handleSelectAssistantSection(filtered[sectionCursorIndex] || filtered[0]);
        return;
      } else if (e.key === "Escape") {
        e.preventDefault();
        setShowSectionPopup(false);
        return;
      }
    }

    if (!e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && textareaRef.current) {
      if (e.key === "ArrowUp" && isCaretOnFirstLine(textareaRef.current)) {
        e.preventDefault();
        handleHistoryNavigation("up");
        return;
      }

      if (e.key === "ArrowDown" && isCaretOnLastLine(textareaRef.current)) {
        e.preventDefault();
        handleHistoryNavigation("down");
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
    if (e.key === "Tab" && showSectionPopup) {
      e.preventDefault();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
    }
  };

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const handleResizeKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const direction = e.key === "ArrowLeft" ? -1 : 1;
    const delta = position === "right" ? -direction * 24 : direction * 24;
    const newWidth = Math.max(ASSISTANT_MIN_WIDTH, Math.min(ASSISTANT_MAX_WIDTH, width + delta));
    setWidth(newWidth);
    localStorage.setItem(ASSISTANT_WIDTH_KEY, newWidth.toString());
    onWidthChange?.(newWidth);
  };

  // Sync external position prop
  useEffect(() => {
    if (externalPosition && externalPosition !== position) {
      setPosition(externalPosition);
    }
  }, [externalPosition]);

  const togglePosition = () => {
    const newPosition = position === "left" ? "right" : "left";
    setPosition(newPosition);
    localStorage.setItem(ASSISTANT_POSITION_KEY, newPosition);
    onPositionChange?.(newPosition);
  };

  const handleCopyMessage = async (message: Message) => {
    const conversationMessage: ConversationMessage = {
      role: message.role,
      content: message.content,
      timestamp: message.timestamp,
    };

    const title = context?.metadata?.title ||
      (context?.type === "document" ? "Document Discussion" :
        context?.type === "web" ? "Web Page Discussion" :
          "AI Conversation");

    const markdown = generateSingleMessageMarkdown(
      conversationMessage,
      title,
      context ? getContextMessage(context) : undefined
    );

    const success = await copyToClipboard(markdown);
    if (success) {
      setCopiedMessageId(message.id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    }
  };

  const handleShareMessage = (message: Message) => {
    setShareMessage(message);
    setIsShareDialogOpen(true);
  };

  const handleShareConversation = () => {
    setShareMessage(null);
    setIsShareDialogOpen(true);
  };

  // Convert internal messages to conversation messages for export
  const getConversationMessages = (): ConversationMessage[] => {
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
      }));
  };

  const renderUserMessageContent = (content: string, sectionsList: SectionNode[]) => {
    const re = /#{([^}]+)}/g;
    if (!re.test(content)) return content;

    re.lastIndex = 0;
    const matches: { index: number; length: number; token: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      matches.push({ index: m.index, length: m[0].length, token: m[1] });
    }

    const elements: (string | ReactNode)[] = [];
    let lastIdx = 0;

    matches.forEach((item, idx) => {
      if (item.index > lastIdx) {
        elements.push(content.slice(lastIdx, item.index));
      }
      const matchedNode =
        sectionsList.find((s) => s.id === item.token || s.title === item.token) ||
        sectionsList.find(
          (s) => normalizeSectionTitleForMatch(s.title) === normalizeSectionTitleForMatch(item.token),
        );
      const label = matchedNode
        ? (matchedNode.breadcrumb.length > 0
            ? `${matchedNode.breadcrumb[matchedNode.breadcrumb.length - 1]} > ${matchedNode.title}`
            : matchedNode.title)
        : item.token.startsWith("section-")
          ? "Section"
          : item.token;

      elements.push(
        <span
          key={`sec-${idx}`}
          className="inline-flex items-center gap-1 px-2 py-0.5 my-0.5 mx-0.5 rounded-full text-xs font-semibold bg-primary-foreground/20 text-primary-foreground border border-primary-foreground/30 align-baseline"
          title={matchedNode?.title || label}
        >
          <TextT className="w-3 h-3" />
          {label}
        </span>
      );
      lastIdx = item.index + item.length;
    });

    if (lastIdx < content.length) {
      elements.push(content.slice(lastIdx));
    }

    return <>{elements}</>;
  };

  const handleExtractText = async (text: string) => {
    if (!text.trim()) return;
    try {
      await createExtract({
        content: text.trim(),
        document_id: context?.documentId,
        source_url: context?.url,
        note: "Extracted from Assistant",
      });
      toast.success("Extract saved to library");
    } catch (err) {
      toast.error("Failed to save extract", err instanceof Error ? err.message : String(err));
    }
  };

  const handleEditUserMessage = (targetMessage: Message) => {
    const index = messages.findIndex((m) => m.id === targetMessage.id);
    if (index === -1) return;

    setInput(targetMessage.content);
    setMessages((prev) => prev.slice(0, index));
    textareaRef.current?.focus();
  };

  const handleDeleteMessage = (messageId: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== messageId));
    toast.success("Message deleted");
  };

  const handleRetryMessage = (targetMessage: Message) => {
    const index = messages.findIndex((m) => m.id === targetMessage.id);
    if (index === -1) return;

    let promptText = "";
    for (let i = index - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        promptText = messages[i].content;
        break;
      }
    }

    setMessages((prev) => prev.slice(0, index));
    if (promptText) {
      setInput(promptText);
      textareaRef.current?.focus();
    }
  };

  const handleCopyEntireChat = async () => {
    if (messages.length === 0) return;
    const conversationMessages = getConversationMessages();
    const title =
      context?.metadata?.title ||
      (context?.type === "document"
        ? "Document Discussion"
        : context?.type === "web"
          ? "Web Page Discussion"
          : "AI Conversation");

    const markdown = conversationMessages
      .map((m) => `### ${m.role === "user" ? "User" : "Assistant"}\n\n${m.content}`)
      .join("\n\n---\n\n");

    const header = `# ${title}\n\n*Exported on ${new Date().toLocaleString()}*\n\n---\n\n`;
    const fullText = header + markdown;

    const success = await copyToClipboard(fullText);
    if (success) {
      toast.success("Entire chat copied to clipboard");
    }
  };

  const handleClearChat = () => {
    setMessages([]);
    toast.success("Chat history cleared");
  };

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, targetMessage?: Message) => {
      e.preventDefault();
      e.stopPropagation();

      const selectionText = window.getSelection()?.toString().trim() || "";
      const position = { x: e.clientX, y: e.clientY };
      const items: ContextMenuItem[] = [];

      // 1. Text Selection Actions
      if (selectionText) {
        items.push(
          {
            id: "extract-selection",
            label: "Extract Selection",
            icon: <Quotes className="w-4 h-4" />,
            onClick: () => handleExtractText(selectionText),
          },
          {
            id: "copy-selection",
            label: "Copy Selection",
            icon: <Copy className="w-4 h-4" />,
            onClick: () => {
              copyToClipboard(selectionText);
              toast.success("Copied selection to clipboard");
            },
          },
          {
            id: "ask-selection",
            label: "Ask about Selection",
            icon: <ChatCircleText className="w-4 h-4" />,
            onClick: () => {
              setInput((prev) => (prev ? `${prev}\n\n> ${selectionText}\n` : `> ${selectionText}\n`));
              textareaRef.current?.focus();
            },
          },
          {
            id: "summarize-selection",
            label: "Summarize Selection",
            icon: <Sparkle className="w-4 h-4" />,
            onClick: () => {
              setInput(`Summarize this excerpt: "${selectionText}"`);
              textareaRef.current?.focus();
            },
          }
        );
      }

      // 2. Message Specific Actions
      if (targetMessage) {
        if (items.length > 0) {
          items.push({ id: "sep-msg-start", type: ContextMenuItemType.Separator, label: "" });
        }

        if (targetMessage.role === "assistant") {
          items.push(
            {
              id: "extract-message",
              label: "Extract Message Content",
              icon: <Quotes className="w-4 h-4" />,
              onClick: () => handleExtractText(targetMessage.content),
            },
            {
              id: "copy-message-plain",
              label: "Copy Text",
              icon: <Copy className="w-4 h-4" />,
              onClick: () => {
                copyToClipboard(targetMessage.content);
                toast.success("Copied message text to clipboard");
              },
            },
            {
              id: "copy-message-md",
              label: "Copy as Markdown",
              icon: <FileText className="w-4 h-4" />,
              onClick: () => handleCopyMessage(targetMessage),
            },
            {
              id: "create-flashcards-from-message",
              label: t(ASSISTANT_MESSAGE_FLASHCARD_DISPLAY_KEY),
              icon: <Brain className="w-4 h-4" />,
              disabled: !canCreateFlashcardsFromMessage(targetMessage),
              onClick: () => handleCreateFlashcardsFromMessage(targetMessage),
            },
            {
              id: "share-message",
              label: "Share / Export",
              icon: <ShareNetwork className="w-4 h-4" />,
              onClick: () => handleShareMessage(targetMessage),
            },
            {
              id: "retry-message",
              label: "Regenerate Response",
              icon: <ArrowsClockwise className="w-4 h-4" />,
              onClick: () => handleRetryMessage(targetMessage),
            },
            { id: "sep-msg-del", type: ContextMenuItemType.Separator, label: "" },
            {
              id: "delete-message",
              label: "Delete Message",
              icon: <Trash className="w-4 h-4 text-destructive" />,
              type: ContextMenuItemType.Danger,
              onClick: () => handleDeleteMessage(targetMessage.id),
            }
          );
        } else if (targetMessage.role === "user") {
          items.push(
            {
              id: "copy-user-prompt",
              label: "Copy Prompt",
              icon: <Copy className="w-4 h-4" />,
              onClick: () => {
                copyToClipboard(targetMessage.content);
                toast.success("Copied prompt to clipboard");
              },
            },
            {
              id: "edit-user-prompt",
              label: "Edit & Resend",
              icon: <Pencil className="w-4 h-4" />,
              onClick: () => handleEditUserMessage(targetMessage),
            },
            { id: "sep-user-del", type: ContextMenuItemType.Separator, label: "" },
            {
              id: "delete-user-msg",
              label: "Delete Message",
              icon: <Trash className="w-4 h-4 text-destructive" />,
              type: ContextMenuItemType.Danger,
              onClick: () => handleDeleteMessage(targetMessage.id),
            }
          );
        }
      }

      // 3. General Chat Actions
      if (items.length > 0) {
        items.push({ id: "sep-general", type: ContextMenuItemType.Separator, label: "" });
      }

      items.push(
        {
          id: "copy-entire-chat",
          label: "Copy Entire Chat",
          icon: <Copy className="w-4 h-4" />,
          disabled: messages.length === 0,
          onClick: handleCopyEntireChat,
        },
        {
          id: "clear-chat-history",
          label: "Clear Chat History",
          icon: <Trash className="w-4 h-4 text-destructive" />,
          type: ContextMenuItemType.Danger,
          disabled: messages.length === 0,
          onClick: handleClearChat,
        }
      );

      assistantContextMenu.showMenu(position, items);
    },
    [assistantContextMenu, context, messages]
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizing) {
        let newWidth: number;
        if (position === "right") {
          // Panel on right: width = screen width - mouse X
          newWidth = window.innerWidth - e.clientX;
        } else {
          // Panel on left: width = mouse X
          newWidth = e.clientX;
        }
        if (newWidth >= ASSISTANT_MIN_WIDTH && newWidth <= ASSISTANT_MAX_WIDTH) {
          setWidth(newWidth);
          localStorage.setItem(ASSISTANT_WIDTH_KEY, newWidth.toString());
          onWidthChange?.(newWidth);
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing, position, onWidthChange]);

  if (isCollapsed) {
    return (
      <div className={`flex flex-col h-full min-h-0 overflow-hidden bg-card ${position === "right" ? "border-l" : "border-r"} border-border relative ${className}`}>
        <button
          onClick={() => setIsCollapsed(false)}
          className="p-2 hover:bg-muted transition-colors"
          title="Open Assistant"
        >
          {position === "right" ? (
            <CaretLeft className="w-4 h-4 text-foreground" />
          ) : (
            <CaretRight className="w-4 h-4 text-foreground" />
          )}
        </button>
      </div>
    );
  }

  const currentProvider = providers.find((p) => p.id === effectiveProvider);

  const handleProviderChange = (providerId: AssistantProviderId) => {
    setSelectedProvider(providerId);
    onProviderChange?.(providerId);
  };

  return (
    <div
      className={`flex flex-col h-full max-h-full min-h-0 overflow-hidden bg-card ${position === "right" ? "border-l" : "border-r"} border-border relative ${className}`}
      style={{ width: fillContainer ? "100%" : isCollapsed ? "auto" : width }}
      onContextMenu={(e) => handleContextMenu(e)}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <ChatCircle className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Assistant</h2>
        </div>
        <div className="flex items-center gap-1">
          {/* Share Conversation Button */}
          {messages.length > 0 && (
            <button
              onClick={handleShareConversation}
              className="p-1.5 hover:bg-muted transition-colors rounded mr-1"
              title="Share conversation"
            >
              <ShareNetwork className="w-4 h-4 text-foreground" />
            </button>
          )}
          {/* Breathing CSS Animation */}
          <style>{`
            @keyframes breathing-glow {
              0%, 100% {
                opacity: 0.55;
                transform: scale(0.92);
              }
              50% {
                opacity: 1;
                transform: scale(1.1);
              }
            }
            .breathing-pulse {
              animation: breathing-glow 2.2s infinite ease-in-out;
            }
          `}</style>

          {/* Model Status Pill & Selector */}
          <div className="relative mr-2">
            <button
              onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
              className={`
                flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold
                bg-background border border-border shadow-sm transition-all duration-200
                hover:bg-muted/80 cursor-pointer select-none active:scale-[0.98]
                ${isModelDropdownOpen ? "border-primary ring-2 ring-primary/10 bg-muted/30" : ""}
              `}
              title="Change Active AI Model"
            >
              {/* Pulsing indicator dot */}
              <span className="relative flex h-1.5 w-1.5">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                  effectiveProvider === "openai" ? "bg-emerald-400" :
                  effectiveProvider === "anthropic" ? "bg-orange-400" :
                  effectiveProvider === "ollama" ? "bg-cyan-400" :
                  isAppleFmAssistantProvider(effectiveProvider) ? "bg-slate-400" : "bg-purple-400"
                }`}></span>
                <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                  effectiveProvider === "openai" ? "bg-emerald-500" :
                  effectiveProvider === "anthropic" ? "bg-orange-500" :
                  effectiveProvider === "ollama" ? "bg-cyan-500" :
                  isAppleFmAssistantProvider(effectiveProvider) ? "bg-slate-500" : "bg-purple-500"
                }`}></span>
              </span>

              {/* Icon */}
              {(() => {
                const activeProvObj = providers.find(p => p.id === effectiveProvider);
                if (!activeProvObj) return null;
                return <activeProvObj.icon className={`w-3 h-3 ${activeProvObj.color}`} />;
              })()}

              {/* Active Model Name */}
              <span className="max-w-[110px] truncate text-foreground/90 font-medium tracking-tight">
                {(() => {
                  const activeConfig = configuredProvidersList.find(p => p.provider === effectiveProvider && p.enabled);
                  return getFriendlyModelName(effectiveProvider, activeConfig?.model);
                })()}
              </span>

              {/* Chevron */}
              <CaretDown className={`w-3 h-3 text-muted-foreground transition-transform duration-200 ${
                isModelDropdownOpen ? "transform rotate-180" : ""
              }`} />
            </button>

            {/* Whole-library RAG scope toggle */}
            <button
              onClick={() => setUseWholeLibraryScope((v) => !v)}
              className={`
                flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium
                transition-all duration-200 cursor-pointer select-none active:scale-[0.98]
                ${useWholeLibraryScope
                  ? "bg-primary/15 text-primary border border-primary/40 ring-2 ring-primary/10"
                  : "bg-background border border-border text-muted-foreground hover:bg-muted/80"
                }
              `}
              title={useWholeLibraryScope ? "Whole-library chat ON — answers are grounded in your indexed collection with citations. Click to use single-document context." : "Whole-library chat OFF — single-document context. Click to chat across your whole library (requires indexing)."}
            >
              <Globe className="w-3 h-3" />
              {useWholeLibraryScope ? "Library" : "Document"}
            </button>

            {/* AI Engine Center Dropdown */}
            {isModelDropdownOpen && (
              <>
                {/* Backdrop overlay to close dropdown */}
                <div 
                  className="fixed inset-0 z-40 bg-transparent"
                  onClick={() => setIsModelDropdownOpen(false)}
                />
                
                {/* Dropdown Menu container */}
                <div className={`
                  absolute ${position === "right" ? "right-0" : "left-0"} mt-2 w-72 z-50
                  glass-panel-heavy rounded-xl border border-glass-border/40 shadow-glass-lg
                  p-3 space-y-2 select-none animate-in fade-in slide-in-from-bottom-2 duration-150
                  bg-card/95 backdrop-blur-md
                `}>
                  <div className="flex items-center justify-between px-1.5 pb-1 border-b border-border/40">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      AI Engine Center
                    </span>
                    <button
                      onClick={handleOpenSettingsToAI}
                      className="p-1 hover:bg-muted/70 rounded transition-colors text-muted-foreground hover:text-foreground"
                      title="Manage AI Providers"
                    >
                      <Gear className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    {providers.map((provider) => {
                      const provConfig = configuredProvidersList.find(p => p.provider === provider.id);
                      const status = getProviderStatus(provider.id);
                      const isActive = effectiveProvider === provider.id;
                      const hasVision = provConfig ? supportsVision(provider.id, provConfig.model) : false;
                      const isMini = provConfig ? provConfig.model.toLowerCase().includes("mini") || provConfig.model.toLowerCase().includes("haiku") : false;
                      const isAppleFm = isAppleFmAssistantProvider(provider.id);

                      return (
                        <div
                          key={provider.id}
                          onClick={() => {
                            if (status !== "not-configured") {
                              handleProviderChange(provider.id);
                              setIsModelDropdownOpen(false);
                            } else {
                              handleOpenSettingsToAI();
                              setIsModelDropdownOpen(false);
                            }
                          }}
                          className={`
                            group flex flex-col p-2.5 rounded-lg border transition-all duration-200 cursor-pointer
                            ${isActive 
                              ? `bg-gradient-to-br ${provider.gradient} border-primary/20 shadow-sm` 
                              : "bg-background/40 hover:bg-muted/40 border-transparent hover:border-border/60"
                            }
                          `}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className={`p-1 rounded bg-background/80 shadow-sm transition-transform duration-200 group-hover:scale-105`}>
                                <provider.icon className={`w-3.5 h-3.5 ${provider.color}`} />
                              </div>
                              <span className="text-xs font-bold text-foreground">
                                {provider.name}
                              </span>
                            </div>

                            {/* Status Indicators */}
                            <div className="flex items-center gap-1.5">
                              {isActive && (
                                <span className={`h-1.5 w-1.5 rounded-full ${provider.breathingDot} breathing-pulse`}></span>
                              )}
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                                status === "active" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" :
                                status === "disabled" ? "bg-muted text-muted-foreground" :
                                status === "key-missing" ? "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20" :
                                "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                              }`}>
                                {status === "active" ? "Active" :
                                 status === "disabled" ? "Disabled" :
                                 status === "key-missing" ? "Key Alert" :
                                 "Setup"}
                              </span>
                            </div>
                          </div>

                          {/* Model details and Capability Badges */}
                          {(provConfig || isAppleFm) && (
                            <div className="mt-2 space-y-1.5 pl-7">
                              {provConfig && (
                                <div className="text-[10px] font-mono text-muted-foreground truncate" title={provConfig.model}>
                                  {provConfig.model}
                                </div>
                              )}
                              
                              {/* Capabilities tags */}
                              <div className="flex flex-wrap gap-1">
                                {hasVision && (
                                  <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold px-1 py-0.25 rounded bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/10">
                                    <Eye className="w-2 h-2" /> Vision
                                  </span>
                                )}
                                {isAppleFm ? (
                                  <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold px-1 py-0.25 rounded bg-slate-500/15 text-slate-600 dark:text-slate-400 border border-slate-500/10">
                                    <Cpu className="w-2.5 h-2.5" /> On-device
                                  </span>
                                ) : provider.id === "ollama" ? (
                                  <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold px-1 py-0.25 rounded bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/10">
                                    <Cpu className="w-2.5 h-2.5" /> Local
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold px-1 py-0.25 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/10">
                                    <Globe className="w-2.5 h-2.5" /> Cloud
                                  </span>
                                )}
                                {isMini && (
                                  <span className="inline-flex items-center gap-0.5 text-[8px] font-semibold px-1 py-0.25 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/10">
                                    <Lightning className="w-2.5 h-2.5" /> Fast
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                          
                          {status === "not-configured" && (
                            <div className="mt-1 pl-7 text-[9px] text-muted-foreground italic">
                              Click to configure API Key
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
          {/* Position Toggle Button */}
          <button
            onClick={togglePosition}
            className="p-1.5 hover:bg-muted transition-colors rounded"
            title={position === "right" ? "Move to left side" : "Move to right side"}
          >
            {position === "right" ? (
              <SidebarSimple className="w-4 h-4 text-foreground" />
            ) : (
              <SidebarSimple className="w-4 h-4 text-foreground" />
            )}
          </button>
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 hover:bg-muted transition-colors rounded"
            title="Collapse"
          >
            {position === "right" ? (
              <CaretRight className="w-4 h-4 text-foreground" />
            ) : (
              <CaretLeft className="w-4 h-4 text-foreground" />
            )}
          </button>
        </div>
      </div>

      {/* Context Banner */}
      {context && (
        <div className="px-3 py-2 bg-muted/50 border-b border-border text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            {context.type === "document" && <TextT className="w-3 h-3" />}
            {context.type === "web" && <Code className="w-3 h-3" />}
            <span>{getContextMessage(context)}</span>
            {isThreadContext ? (
              <span className="ml-auto px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 font-medium text-[10px]">
                Scope: This X thread
              </span>
            ) : context.type === "video" && context.content ? (
              <span className="ml-auto text-[10px] uppercase tracking-wide text-muted-foreground/80">
                Transcript attached
              </span>
            ) : null}
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={messagesContainerRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 space-y-4"
      >
        {messages.filter((m) => m.role !== "system").length === 0 ? (
          <div className="text-center text-muted-foreground text-sm py-6 space-y-4">
            <Sparkle className="w-8 h-8 mx-auto mb-2 opacity-50 text-primary" />
            <div>
              <p className="font-medium text-foreground">
                {isThreadContext ? "Analyze X Thread" : "Ask me anything about your documents"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isThreadContext ? "Instant summary, key insights, and flashcards" : "I have context of what you're viewing"}
              </p>
            </div>

            {isThreadContext && (
              <div className="flex flex-col gap-2 pt-2 px-2 max-w-xs mx-auto">
                <button
                  onClick={() => {
                    const prompt = "Please provide a comprehensive summary of this X/Twitter thread. Structure your response with a High-Level Overview, Key Points post-by-post, and the Main Conclusion. Cite specific posts (e.g. [Post 1], [Post 2]) when referencing claims.";
                    setInput(prompt);
                    setTimeout(() => {
                      textareaRef.current?.focus();
                    }, 0);
                  }}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-border/80 bg-background hover:bg-muted/60 text-left text-xs transition-colors group"
                >
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <FileText className="w-4 h-4 text-blue-500" />
                    <span>Summary</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground group-hover:text-primary">Overview & Key Points →</span>
                </button>

                <button
                  onClick={() => {
                    const prompt = "Please analyze this X/Twitter thread and extract key insights structured into the following sections:\n1. Core Claims: The fundamental arguments or theses.\n2. Key Supporting Arguments: Evidence and logical backing.\n3. Actionable Takeaways: Practical lessons or insights.\n4. Counterarguments / Tensions: Any nuances, potential counterarguments, or open questions raised.";
                    setInput(prompt);
                    setTimeout(() => {
                      textareaRef.current?.focus();
                    }, 0);
                  }}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-border/80 bg-background hover:bg-muted/60 text-left text-xs transition-colors group"
                >
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <Lightbulb className="w-4 h-4 text-amber-500" />
                    <span>Insights</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground group-hover:text-primary">Claims & Takeaways →</span>
                </button>

                <button
                  onClick={() => {
                    const prompt = "/20rules Formulate atomic flashcards from this X thread following the 20 Rules of Knowledge Formulation. Include question-answer and cloze deletion cards for key facts, concepts, and takeaways.";
                    setInput(prompt);
                    setTimeout(() => {
                      textareaRef.current?.focus();
                    }, 0);
                  }}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-border/80 bg-background hover:bg-muted/60 text-left text-xs transition-colors group"
                >
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <Brain className="w-4 h-4 text-purple-500" />
                    <span>Flashcards (/20rules)</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground group-hover:text-primary">Atomic Cards →</span>
                </button>

                <button
                  onClick={() => {
                    const prompt = "What are the most important takeaways from this thread?";
                    setInput(prompt);
                    setTimeout(() => {
                      textareaRef.current?.focus();
                    }, 0);
                  }}
                  className="flex items-center justify-between p-2.5 rounded-lg border border-border/80 bg-background hover:bg-muted/60 text-left text-xs transition-colors group"
                >
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <ChatCircleText className="w-4 h-4 text-emerald-500" />
                    <span>Ask Questions</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground group-hover:text-primary">Q&A Mode →</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex flex-col group ${message.role === "user" ? "items-end" : "items-start"
                }`}
              onContextMenu={(e) => handleContextMenu(e, message)}
            >
              {/* Message Header */}
              <div className="flex items-center gap-2 mb-1">
                {message.role === "system" && (
                  <Gear className="w-3 h-3 text-muted-foreground" />
                )}
                {message.role === "assistant" && (
                  <>
                    {effectiveProvider === "openai" && <Sparkle className="w-3 h-3 text-green-500" />}
                    {effectiveProvider === "anthropic" && <ChatCircle className="w-3 h-3 text-orange-500" />}
                    {effectiveProvider === "ollama" && <Code className="w-3 h-3 text-blue-500" />}
                    {effectiveProvider === "openrouter" && <Gear className="w-3 h-3 text-purple-500" />}
                  </>
                )}
                <span className="text-xs text-muted-foreground">
                  {message.role === "user"
                    ? "You"
                    : message.role === "system"
                      ? "System"
                      : currentProvider?.name || "Assistant"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </span>
              </div>

              {/* Message Content */}
              <div
                className={`max-w-[85%] px-3 py-2 rounded-lg text-sm ${message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : message.role === "system"
                    ? "bg-muted text-muted-foreground"
                    : "bg-muted text-foreground"
                  }`}
              >
                {/* Image thumbnails for user messages */}
                {message.images && message.images.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap mb-1.5">
                    {message.images.map((img) => (
                      <img
                        key={img.id}
                        src={img.dataUrl}
                        alt={img.fileName || "Attached image"}
                        className="max-w-[120px] max-h-[120px] rounded-md object-cover cursor-pointer hover:opacity-80 transition-opacity"
                        onClick={() => window.open(img.dataUrl, "_blank")}
                      />
                    ))}
                  </div>
                )}
                {message.role === "user" ? (
                  renderUserMessageContent(message.content, assistantSectionFlat)
                ) : (
                  <MemoizedMarkdown content={message.content} />
                )}
              </div>

              {/* Message Actions - always visible on assistant answers */}
              {message.role === "assistant" && (
                <div className="flex items-center gap-0.5 mt-1 opacity-100 transition-opacity motion-reduce:transition-none">
                  <button
                    type="button"
                    onClick={() => handleCopyMessage(message)}
                    className="p-1.5 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                    aria-label={t("assistant.copyToClipboard")}
                    title={t("assistant.copyToClipboard")}
                  >
                    {copiedMessageId === message.id ? (
                      <Check className="w-3 h-3 text-green-500" weight="bold" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCreateFlashcardsFromMessage(message)}
                    disabled={
                      !canCreateFlashcardsFromMessage(message)
                      || isLoading
                      || flashcardGeneratingMessageId === message.id
                    }
                    className="inline-flex items-center gap-1 px-1.5 py-1 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded disabled:opacity-40 disabled:pointer-events-none"
                    aria-label={t(ASSISTANT_MESSAGE_FLASHCARD_DISPLAY_KEY)}
                    title={
                      canCreateFlashcardsFromMessage(message)
                        ? t(ASSISTANT_MESSAGE_FLASHCARD_DISPLAY_KEY)
                        : t(ASSISTANT_MESSAGE_FLASHCARD_UNAVAILABLE_KEY)
                    }
                  >
                    {flashcardGeneratingMessageId === message.id ? (
                      <CircleNotch className="w-3.5 h-3.5 animate-spin text-purple-500" />
                    ) : (
                      <Brain className="w-3.5 h-3.5 text-purple-500" weight="duotone" />
                    )}
                    <span className="text-[11px] font-medium leading-none">Flashcards</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleShareMessage(message)}
                    className="p-1.5 text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
                    aria-label={t("assistant.shareExport")}
                    title={t("assistant.shareExport")}
                  >
                    <ShareNetwork className="w-3 h-3" />
                  </button>
                </div>
              )}

              {/* Tool Calls */}
              {message.toolCalls && message.toolCalls.length > 0 && (() => {
                const artifacts = toolCallsToFlashcardArtifacts(message.id, message.toolCalls, {
                  source: message.sourceContext,
                  timestamp: message.timestamp,
                });
                const genericTools = nonFlashcardToolCalls(message.toolCalls);
                const deckName = getFlashcardArtifactDeckName(artifacts)
                  ?? (artifacts.length > 0 ? getDocumentDeckName(assistantDocumentTitle) : undefined);
                const existingDeck = deckName
                  ? studyDecks.find((deck) => deck.name.trim().toLowerCase() === deckName.trim().toLowerCase())
                  : undefined;
                return (
                <>
                  <ChatFlashcardCollection
                    artifacts={artifacts}
                    onOpen={openChatCard}
                    onRetry={(artifact) => void retryChatCard(message.id, artifact)}
                    onCopy={copyChatCards}
                    deckAction={deckName ? {
                      name: deckName,
                      exists: Boolean(existingDeck),
                      onCreate: () => createChatDeck(deckName),
                      onOpen: () => openChatDeck(deckName),
                    } : undefined}
                  />
                  {genericTools.length > 0 && <div className="mt-2 space-y-1">
                  {genericTools.map((tool, idx) => (
                    <div
                      key={idx}
                      className={`text-xs px-2 py-1 rounded flex items-center gap-2 ${tool.status === "success"
                        ? "bg-emerald-500/15 text-emerald-500"
                        : tool.status === "error"
                          ? "bg-red-500/15 text-red-500"
                          : "bg-amber-500/15 text-amber-500"
                        }`}
                    >
                      <Code className="w-3 h-3" />
                      <span className="font-medium">{tool.name}</span>
                      <span className="opacity-75">
                        {JSON.stringify(tool.parameters)}
                      </span>
                      {tool.status === "pending" && (
                        <CircleNotch className="w-3 h-3 animate-spin" />
                      )}
                    </div>
                  ))}
                </div>}
                </>
                );
              })()}
            </div>
          ))
        )}
      </div>

      {/* Input Area */}
      <div className="flex-shrink-0 p-3 border-t border-border bg-card relative">
        <div className="flex flex-col gap-2">
          {/* Image Preview Strip */}
          {attachedImages.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {attachedImages.map((img) => (
                <div
                  key={img.id}
                  className="relative flex-shrink-0 group/thumb rounded-md overflow-hidden border border-border"
                >
                  <img
                    src={img.dataUrl}
                    alt={img.fileName || "Attached image"}
                    className="w-16 h-16 object-cover"
                  />
                  <button
                    onClick={() => removeImage(img.id)}
                    className="absolute top-0 right-0 bg-black/60 text-white rounded-bl-md p-0.5 opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                    title="Remove image"
                  >
                    <X className="w-3 h-3" />
                  </button>
                  {(img.fileName || img.fileSize) && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[9px] px-1 truncate">
                      {img.fileName || `${((img.fileSize ?? 0) / 1024).toFixed(0)}KB`}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Selected section cards - collapsed by default, expandable to read */}
          {selectedSectionNodes.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedSectionNodes.map((node) => {
                const latestNode = assistantSectionFlat.find((n) => n.id === node.id) || node;
                return (
                  <SectionMentionCard
                    key={node.id}
                    node={latestNode}
                    onRemove={handleRemoveAssistantSection}
                  />
                );
              })}
            </div>
          )}

          {/* Available Tools Hint */}
          <div className="text-xs text-muted-foreground flex items-center gap-1">
            <Sparkle className="w-3 h-3" />
            <span>Type /tools to see available tools • # references sections of an open document</span>
          </div>

          {/* SectionMentionPopup - positioned above input */}
          {showSectionPopup && (
            <div className="absolute bottom-full left-3 right-3 mb-2">
              <SectionMentionPopup
                tree={assistantSectionTree}
                flat={assistantSectionFlat}
                query={sectionQuery}
                selectedIndex={sectionCursorIndex}
                onSelect={handleSelectAssistantSection}
                open={showSectionPopup}
                maxHeight={260}
                selectionEntry={selectionSection}
                isLoading={
                  context?.type === "document" &&
                  sectionTextLoading &&
                  assistantSectionFlat.length === 0
                }
                unavailableReason={
                  context?.type !== "document"
                    ? t("sectionMention.noDocumentTargeted")
                    : null
                }
              />
            </div>
          )}

          {/* Text Input */}
          <div
            ref={inputContainerRef}
            className={`flex gap-2 rounded-lg transition-colors ${isDragOver ? "border-2 border-dashed border-primary bg-primary/5" : ""}`}
            onMouseEnter={() => setIsInputHovered(true)}
            onMouseLeave={() => setIsInputHovered(false)}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => handleInputChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => { setIsInputFocused(true); setSectionsArmed(true); }}
              onBlur={() => setIsInputFocused(false)}
              placeholder={attachedImages.length > 0 ? "Ask about the attached image(s)..." : "Ask about your document, or type /help for commands..."}
              className="flex-1 px-3 py-2 bg-background border border-border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-primary text-foreground text-sm"
              rows={2}
              disabled={isLoading}
            />
            <div className="flex flex-col gap-1">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading || attachedImages.length >= MAX_ATTACHED_IMAGES}
                className="px-2 py-1 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={attachedImages.length >= MAX_ATTACHED_IMAGES ? `Maximum ${MAX_ATTACHED_IMAGES} images` : "Attach image"}
              >
                <Images className="w-4 h-4" />
              </button>
              <button
                onClick={handleSendMessage}
                disabled={(!input.trim() && attachedImages.length === 0) || isLoading}
                className="px-2 py-1 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
              >
                {isLoading ? (
                  <CircleNotch className="w-4 h-4 animate-spin" />
                ) : (
                  <PaperPlaneTilt className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              for (const file of files) {
                if (file.type.startsWith("image/")) {
                  attachImage(file);
                }
              }
              // Reset input so same file can be picked again
              e.target.value = "";
            }}
          />

          {/* Quick Actions */}
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setInput("/20rules")}
              className="px-2 py-1 bg-muted hover:bg-muted/80 rounded text-muted-foreground transition-colors font-medium"
              title="Formulate atomic flashcards with Dr. Wozniak's 20 Rules"
            >
              /20rules
            </button>
            <button
              onClick={() => setInput("/tools")}
              className="px-2 py-1 bg-muted hover:bg-muted/80 rounded text-muted-foreground transition-colors"
            >
              /tools
            </button>
            <button
              onClick={() => setInput("/help")}
              className="px-2 py-1 bg-muted hover:bg-muted/80 rounded text-muted-foreground transition-colors"
            >
              /help
            </button>
            <button
              onClick={() => setInput("/clear")}
              className="px-2 py-1 bg-muted hover:bg-muted/80 rounded text-muted-foreground transition-colors ml-auto"
            >
              /clear
            </button>
          </div>
        </div>
      </div>

      {/* Share Dialog */}
      <ShareMessageDialog
        isOpen={isShareDialogOpen}
        onClose={() => setIsShareDialogOpen(false)}
        messages={getConversationMessages()}
        singleMessage={shareMessage ? {
          role: shareMessage.role,
          content: shareMessage.content,
          timestamp: shareMessage.timestamp,
        } : undefined}
        contextInfo={context ? getContextMessage(context) : undefined}
        documentTitle={context?.metadata?.title ||
          (context?.type === "document" ? "Document Discussion" :
            context?.type === "web" ? "Web Page Discussion" :
              "AI Conversation")}
      />

      <ContextMenu
        menuId="assistant-panel-context-menu"
        items={assistantContextMenu.items}
        visible={assistantContextMenu.visible}
        position={assistantContextMenu.position}
        onClose={assistantContextMenu.hideMenu}
      />

      {/* Resize Handle - positioned based on panel position */}
      {!fillContainer && (
        <div
          onMouseDown={handleResizeStart}
          onKeyDown={handleResizeKeyDown}
          role="separator"
          aria-label="Resize Assistant panel"
          aria-orientation="vertical"
          aria-valuemin={ASSISTANT_MIN_WIDTH}
          aria-valuemax={ASSISTANT_MAX_WIDTH}
          aria-valuenow={width}
          tabIndex={0}
          className={`absolute top-0 bottom-0 z-10 w-1 cursor-ew-resize hover:bg-primary/20 focus-visible:bg-primary/30 focus-visible:outline-none transition-colors group ${position === "right" ? "left-0" : "right-0"
            }`}
        >
          <div className={`absolute top-1/2 -translate-y-1/2 w-1 h-8 bg-border group-hover:bg-primary/50 rounded ${position === "right" ? "left-0" : "right-0"
            }`} />
        </div>
      )}
    </div>
  );
}
