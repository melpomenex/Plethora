import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useMobileShell } from "../../hooks/useMobileShell";
import { useDocumentStore, useLLMProvidersStore, useSettingsStore, useDocumentQAStore, useReviewStore, useStudyDeckStore, useTabsStore, type QAMessage, type QAToolCall } from "../../stores";
import { chatWithContext, type LLMMessage } from "../../api/llm";
import { getDocument, extractDocumentText } from "../../api/documents";
import { getExtracts, patchDocumentExtractCount } from "../../api/extracts";
import { callAppMCPTool, getAppMCPTools } from "../../api/mcp";
import { copyToClipboard, getIntegrationSettings, notebooklmGetSettings } from "../../api/integrations";
import {
  buildClozeFromSelection,
  buildQaFromSelection,
  createArtifactDraft,
  createSelectionRange,
  loadOrCreateResearchSession,
  orchestrateNotebooklmResearch,
  saveResearchDraft,
  upsertArtifactDraft,
  type DocumentResearchSession,
  type NotebookLMResearchError,
  type ResearchArtifactDraft,
} from "../../features/documentQa/notebooklmResearch";
import { createDocumentQaRequestContent, loadDocumentQaText } from "../../features/documentQa/sectionContextRequest";
import {
  BookOpen,
  ChatCircle,
  Check,
  CircleNotch,
  Copy,
  Flask,
  FloppyDisk,
  Gear,
  Globe,
  List,
  PaperPlaneTilt,
  PencilSimple,
  Plus,
  Sparkle,
  TextT,
  Trash,
  WarningCircle,
  X,
  XCircle,
} from "@phosphor-icons/react";
import { renderMarkdown } from "../../utils/markdown";
import { detectChapterReference, buildChapterQAContext, getChapterTitles, type ChapterReference } from "../../utils/chapterUtils";
import { useI18n } from "../../lib/i18n";
import { invokeCommand } from "../../lib/tauri";
import { useDocumentSections } from "../../hooks/useDocumentSections";
import { SectionMentionPopup } from "../common/SectionMentionPopup";
import { SectionMentionCard } from "../common/SectionMentionCard";
import {
  buildDocumentSections,
  describeSectionDiagnostic,
  normalizeSectionTitleForMatch,
  resolvePromptSectionMentions,
  resolveMixedSectionFocusedContext,
  type FocusedSectionContextResult,
  type SectionNode,
} from "../../utils/sectionIndex";
import { ChatFlashcardCollection } from "../assistant/ChatFlashcardCollection";
import {
  getFlashcardArtifactDeckName,
  nonFlashcardToolCalls,
  toolCallsToFlashcardArtifacts,
  type ChatFlashcardArtifact,
} from "../../features/assistant/chatFlashcardArtifacts";
import { formatRelativeTime } from "../../utils/relativeTime";
import { DocumentQASources, sourcesCopyText } from "./DocumentQASources";
import { ReviewTab } from "./TabRegistry";
import { useToast } from "../common/Toast";
import { useDocumentOutlineStore } from "../../stores/documentOutlineStore";
import { loadAudiobookSectionCatalog } from "../../features/documentQa/audiobookSectionCatalog";
import {
  STORAGE_KEYS as SESSION_STORAGE_KEYS,
  createSession,
  deleteSession as deleteQaSession,
  getActiveSessionId,
  loadSessions,
  migrateLegacyState,
  renameSession as renameQaSession,
  saveSessions,
  setActiveSessionId,
  updateSession,
  type DocumentQaSession,
} from "./documentQaSessions";
import {
  buildTwentyRulesSystemPrompt,
  getTwentyRulesReminderMarkdown,
  isTwentyRulesCommand,
  stripTwentyRulesCommand,
} from "../../lib/ai/knowledgeFormulation";

// Re-export types with simpler names for local use
type Message = QAMessage;
type ToolCall = QAToolCall;

interface DocumentMention {
  id: string;
  title: string;
  index: number; // Position in the input text
}

// Mention token format in input: @{documentId}
const MENTION_REGEX = /@{([^}]+)}/g;
const SECTION_REGEX = /#{([^}]+)}/g;
const CARD_CREATION_TOOL_NAMES = new Set(["create_qa_card", "create_cloze_card", "batch_create_cards"]);
const ATTACHABLE_TOOL_NAMES = new Set([...CARD_CREATION_TOOL_NAMES, "create_extract"]);

const getDocumentDeckName = (title?: string): string | undefined => {
  const trimmed = title?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\s*\([^)]*\)\s*$/, "").trim() || trimmed;
};

export function DocumentQATab() {
  // Use store for persistent state
  const {
    messages,
    isProcessing,
    addMessage,
    setMessages,
    clearMessages,
    setIsProcessing,
    updateToolCall,
  } = useDocumentQAStore();

  // Local UI state (doesn't need persistence)
  const [input, setInput] = useState("");
  const [rawInput, setRawInput] = useState(""); // Input with mention tokens
  const [mentions, setMentions] = useState<DocumentMention[]>([]);
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionCursorIndex, setMentionCursorIndex] = useState(0);
  const [, setProviderError] = useState<string | null>(null);
  const [detectedChapter, setDetectedChapter] = useState<{ number: number; title?: string } | null>(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>("");
  const [notebookResearchEnabled, setNotebookResearchEnabled] = useState(false);
  const [researchQuery, setResearchQuery] = useState("");
  const [researchStatus, setResearchStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [researchError, setResearchError] = useState<string | null>(null);
  const [researchSession, setResearchSession] = useState<DocumentResearchSession | null>(null);
  const [activeNotebookId, setActiveNotebookId] = useState<string | undefined>(undefined);
  const [researchDraft, setResearchDraft] = useState("");
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number; text: string } | null>(null);
  const [artifactDraft, setArtifactDraft] = useState<ResearchArtifactDraft | null>(null);
  const [isSavingArtifact, setIsSavingArtifact] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [researchDocumentId, setResearchDocumentId] = useState<string>("");
  const showLegacyNotebookResearch = false;

  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [inputDraft, setInputDraft] = useState("");

  // Section autocomplete state - new hierarchical model
  const [showSectionPopup, setShowSectionPopup] = useState(false);
  const [sectionQuery, setSectionQuery] = useState("");
  const [sectionCursorIndex, setSectionCursorIndex] = useState(0);
  const [selectedSections, setSelectedSections] = useState<SectionNode[]>([]);
  const [fullContent, setFullContent] = useState("");
  const [fullContentLoading, setFullContentLoading] = useState(false);
  const [mediaCatalogLoad, setMediaCatalogLoad] = useState<{
    documentId?: string;
    status: "idle" | "loading" | "ready";
  }>({ status: "idle" });
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);

  // --- Document Q&A sessions (see documentQaSessions.ts) ---
  // The active session id is the source of truth for which conversation is
  // loaded into the live store below. Hydration happens in a load effect; the
  // debounced save effect writes the live state back into the active record.
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);
  const [sessions, setSessions] = useState<DocumentQaSession[]>([]);
  // Bump to force a sidebar refresh after session-store mutations performed
  // outside React (e.g. rename/delete handled in the sidebar).
  const [sessionsVersion, setSessionsVersion] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(SESSION_STORAGE_KEYS.sidebarCollapsed) === "1";
  });
  const isMobile = useMobileShell();
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [showNewChatConfirm, setShowNewChatConfirm] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const sessionSaveTimerRef = useRef<number | null>(null);
  // Guard against the save effect writing state from a session we're in the
  // middle of switching away from (hydration sets this true).
  const isHydratingRef = useRef(false);

  const targetDocId = useMemo(() => {
    return mentions.length > 0 ? mentions[0].id : selectedDocumentId;
  }, [mentions, selectedDocumentId]);

  useEffect(() => {
    if (!targetDocId) {
      setFullContent("");
      setFullContentLoading(false);
      return;
    }
    // While the target document's text loads, the section catalog is empty;
    // the popup must say "loading" instead of a false "no sections".
    setFullContentLoading(true);
    let cancelled = false;
    const settle = () => {
      if (!cancelled) setFullContentLoading(false);
    };
    getDocument(targetDocId)
      .then((fullDoc) => {
        if (fullDoc && fullDoc.content) {
          if (!cancelled) setFullContent(fullDoc.content);
          settle();
        } else {
          extractDocumentText(targetDocId)
            .then((res) => {
              if (!cancelled) setFullContent(res?.content || "");
              settle();
            })
            .catch(() => {
              if (!cancelled) setFullContent("");
              settle();
            });
        }
      })
      .catch(() => {
        if (!cancelled) setFullContent("");
        settle();
      });
    return () => {
      cancelled = true;
    };
  }, [targetDocId]);

  const {
    tree: sectionTree,
    flat: sectionFlat,
    getById: getSectionById,
  } = useDocumentSections({
    documentId: targetDocId,
    content: fullContent,
    useStoreOutline: true,
  });

  useEffect(() => {
    setSelectedSections([]);
    setRawInput((value) => value.replace(SECTION_REGEX, "").trim());
  }, [targetDocId]);

  const userQueries = useMemo(() => {
    return messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .reverse();
  }, [messages]);

  // Sent prompts in their raw token form (`#{id}` intact). Message contents
  // are display-formatted (labels, no tokens), so restoring history from them
  // could never recover the section chips. Newest first, like userQueries.
  const [rawQueryHistory, setRawQueryHistory] = useState<string[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const researchEditorRef = useRef<HTMLTextAreaElement>(null);
  const mentionPopupRef = useRef<HTMLDivElement>(null);
  const autosaveTimerRef = useRef<number | null>(null);

  const { documents, currentDocument } = useDocumentStore();
  const sharedMediaSections = useDocumentOutlineStore((state) =>
    targetDocId ? state.mediaSectionsByDocId.get(targetDocId) : undefined
  );
  const setSharedMediaSections = useDocumentOutlineStore((state) => state.setMediaSections);
  const studyDecks = useStudyDeckStore((state) => state.decks);
  const getEnabledProviders = useLLMProvidersStore((state) => state.getEnabledProviders);
  const toast = useToast();
  const contextWindowTokens = useSettingsStore((state) => state.settings.ai.maxTokens);
  const aiControls = useSettingsStore((state) => state.settings.ai.aiControls);
  const notebookFeatureEnabled = useSettingsStore((state) => state.settings.features.notebooklmEnabled);
  const analyticsEnabled = useSettingsStore((state) => state.settings.privacy.analyticsEnabled);
  const { t } = useI18n();

  const targetDocument = useMemo(
    () => documents.find((document) => document.id === targetDocId)
      ?? (currentDocument?.id === targetDocId ? currentDocument : undefined),
    [currentDocument, documents, targetDocId],
  );
  const isAudiobookTarget = targetDocument?.fileType === "audio"
    || targetDocument?.tags?.some((tag) => tag.toLowerCase() === "audiobook")
    || false;

  useEffect(() => {
    if (!targetDocument || !isAudiobookTarget) {
      setMediaCatalogLoad({ documentId: targetDocId || undefined, status: "ready" });
      return;
    }
    if (sharedMediaSections?.length) {
      setMediaCatalogLoad({ documentId: targetDocument.id, status: "ready" });
      return;
    }

    let cancelled = false;
    setMediaCatalogLoad({ documentId: targetDocument.id, status: "loading" });
    void loadAudiobookSectionCatalog(targetDocument)
      .then((sections) => {
        if (cancelled) return;
        if (sections.length > 0) setSharedMediaSections(targetDocument.id, sections);
        setMediaCatalogLoad({ documentId: targetDocument.id, status: "ready" });
      })
      .catch(() => {
        if (!cancelled) setMediaCatalogLoad({ documentId: targetDocument.id, status: "ready" });
      });
    return () => { cancelled = true; };
  }, [isAudiobookTarget, setSharedMediaSections, sharedMediaSections, targetDocId, targetDocument]);

  const isMediaCatalogLoading = isAudiobookTarget
    && !sharedMediaSections?.length
    && (mediaCatalogLoad.documentId !== targetDocId || mediaCatalogLoad.status === "loading");
  const pickerSectionTree = isMediaCatalogLoading ? [] : sectionTree;
  const pickerSectionFlat = isMediaCatalogLoading ? [] : sectionFlat;
  const sections = pickerSectionFlat;

  const brainstormingPrompts = useMemo(() => [
    "Summarize the key concepts from this document and explain them simply.",
    "Compare and contrast the two most important ideas in this document.",
    "Create a timeline of the most important events or arguments.",
    "List high-yield concepts that are likely to become exam questions.",
    "Brainstorm counterpoints or alternative interpretations for the main claims.",
  ], []);

  // Filter documents for mention autocomplete
  const filteredDocuments = documents.filter((doc) =>
    doc.title.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  // Filter sections for autocomplete - fuzzy scoring with breadcrumb
  const filteredSections = useMemo(() => {
    if (!sectionQuery) return sections;
    const q = sectionQuery.toLowerCase();
    const scored = sections
      .map((sec) => {
        const titleLower = sec.title.toLowerCase();
        const breadLower = sec.breadcrumb.join(" > ").toLowerCase();
        let score = 0;
        if (titleLower.startsWith(q)) score += 100;
        else if (titleLower.includes(q)) score += 50;
        if (breadLower.includes(q)) score += 20;
        if (sec.preview.toLowerCase().includes(q)) score += 5;
        return { sec, score };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || a.sec.level - b.sec.level)
      .slice(0, 100)
      .map((s) => s.sec);
    return scored.length > 0 ? scored : sections.filter((sec) => sec.title.toLowerCase().includes(q) || sec.breadcrumb.join(" ").toLowerCase().includes(q));
  }, [sections, sectionQuery]);
  const activeResearchDocumentId = useMemo(() => {
    if (researchDocumentId) return researchDocumentId;
    if (mentions.length > 0) return mentions[0].id;
    return documents[0]?.id ?? "";
  }, [researchDocumentId, mentions, documents]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Seed the focus selector once on mount. The Q&A tab is a long-lived
  // singleton, so re-running on every currentDocument/documents change would
  // yank the user's explicit choice (e.g. "Whole Library (RAG)") whenever a
  // source click or any other action opens a document viewer (which updates
  // the store's currentDocument).
  useEffect(() => {
    setSelectedDocumentId((prev) => {
      if (prev) return prev;
      if (currentDocument) return currentDocument.id;
      if (documents.length > 0) return documents[0].id;
      return "";
    });
    // Intentionally mount-only: later changes must not overwrite the choice.
  }, []);

  // Detect chapter references in the query reactively
  useEffect(() => {
    const visibleQuery = rawInput.replace(MENTION_REGEX, "").replace(SECTION_REGEX, "");
    const chapterRef = detectChapterReference(visibleQuery);
    const targetDocId = mentions.length > 0 ? mentions[0].id : selectedDocumentId;
    
    if (chapterRef && targetDocId) {
      const doc = documents.find(d => d.id === targetDocId);
      if (doc?.content) {
        const titles = getChapterTitles(doc.content);
        const matchedChapter = titles.find(t => t.number === chapterRef.number);
        setDetectedChapter({ number: chapterRef.number, title: matchedChapter?.title });
      } else {
        // Content not loaded in memory; show number first
        setDetectedChapter({ number: chapterRef.number });
        
        // Asynchronously fetch document content to resolve title
        getDocument(targetDocId)
          .then((fullDoc) => {
            if (fullDoc?.content) {
              const titles = getChapterTitles(fullDoc.content);
              const matchedChapter = titles.find(t => t.number === chapterRef.number);
              setDetectedChapter((prev) => {
                if (prev && prev.number === chapterRef.number) {
                  return { number: chapterRef.number, title: matchedChapter?.title };
                }
                return prev;
              });
            }
          })
          .catch((err) => {
            console.warn("Failed to fetch full document content for chapter title:", err);
          });
      }
    } else {
      setDetectedChapter(null);
    }
  }, [rawInput, mentions, selectedDocumentId, documents]);

  useEffect(() => {
    setNotebookResearchEnabled(notebookFeatureEnabled);
  }, [notebookFeatureEnabled]);

  useEffect(() => {
    const integrationSettings = getIntegrationSettings();
    if (integrationSettings.notebooklm?.activeNotebookId) {
      setActiveNotebookId(integrationSettings.notebooklm.activeNotebookId || undefined);
    }
    if (documents.length > 0 && !researchDocumentId) {
      setResearchDocumentId(documents[0].id);
    }

    void notebooklmGetSettings()
      .then((settings) => {
        if (settings.activeNotebookId) {
          setActiveNotebookId(settings.activeNotebookId || undefined);
        }
      })
      .catch(() => {
        // Keep local fallback settings when NotebookLM settings are unavailable.
      });
  }, [documents, researchDocumentId]);

  useEffect(() => {
    if (!activeResearchDocumentId) return;
    const session = loadOrCreateResearchSession(activeResearchDocumentId, activeNotebookId);
    setResearchSession(session);
    setResearchDraft(session.draftText);
  }, [activeResearchDocumentId, activeNotebookId]);

  useEffect(() => {
    if (!researchSession) return;
    if (autosaveTimerRef.current) {
      window.clearTimeout(autosaveTimerRef.current);
    }
    autosaveTimerRef.current = window.setTimeout(() => {
      const updated = saveResearchDraft(researchSession, researchDraft);
      setResearchSession(updated);
    }, 600);

    return () => {
      if (autosaveTimerRef.current) {
        window.clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [researchDraft, researchSession]);

  const parseMentions = useCallback((text: string): { text: string; mentions: DocumentMention[] } => {
    const newMentions: DocumentMention[] = [];

    let match: RegExpExecArray | null;
    while ((match = MENTION_REGEX.exec(text)) !== null) {
      const documentId = match[1];
      const doc = documents.find((d) => d.id === documentId);
      if (doc) {
        newMentions.push({
          id: documentId,
          title: doc.title,
          index: match.index,
        });
      }
    }

    return { text, mentions: newMentions };
  }, [documents]);

  // One token→section identity for every mention surface. Ids are primary
  // (what pick-time insertion writes); exact- and normalized-title fallbacks
  // keep `#{title}` tokens from older sessions rendering and surviving
  // keystrokes instead of being silently discarded.
  const sectionForToken = useCallback((token: string): SectionNode | undefined => {
    return (
      getSectionById(token) ||
      sections.find((s) => s.id === token) ||
      sections.find((s) => s.title === token) ||
      sections.find(
        (s) => normalizeSectionTitleForMatch(s.title) === normalizeSectionTitleForMatch(token)
      )
    );
  }, [sections, getSectionById]);

  // Format input for display (replace tokens with badges) - now tree-aware with breadcrumb
  const formatInputForDisplay = useCallback((text: string, mentionList: DocumentMention[], activeSections: SectionNode[] = []): string => {
    let formatted = text;
    mentionList.forEach((mention) => {
      const token = `@{${mention.id}}`;
      formatted = formatted.replace(token, `@${mention.title}`);
    });

    const sectionMatches = formatted.match(/#{([^}]+)}/g);
    if (sectionMatches) {
      sectionMatches.forEach((token) => {
        const secId = token.slice(2, -1);
        const matchedSec = activeSections.find((section) => section.id === secId) || sectionForToken(secId);
        if (matchedSec) {
          const label = matchedSec.breadcrumb.length > 0 ? `${matchedSec.breadcrumb[matchedSec.breadcrumb.length - 1]} > ${matchedSec.title}` : matchedSec.title;
          formatted = formatted.replace(token, `#${label}`);
        }
      });
    }
    return formatted;
  }, [sectionForToken]);

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setRawInput(value);
    setHistoryIndex(-1);

    const cursorPosition = e.target.selectionStart;
    const beforeCursor = value.slice(0, cursorPosition);
    const atMatch = beforeCursor.match(/@(\w*)$/);
    const hashMatch = beforeCursor.match(/#([^#\s]*)$/);

    if (atMatch) {
      setShowMentionPopup(true);
      setMentionQuery(atMatch[1]);
      setMentionCursorIndex(0);
      setShowSectionPopup(false);
    } else if (hashMatch) {
      setShowSectionPopup(true);
      setSectionQuery(hashMatch[1]);
      setSectionCursorIndex(0);
      setShowMentionPopup(false);
    } else {
      setShowMentionPopup(false);
      setMentionQuery("");
      setShowSectionPopup(false);
      setSectionQuery("");
    }

    const { mentions: newMentions } = parseMentions(value);
    setMentions(newMentions);

    // If section token is deleted, clear selected section
    // Keep boolean token detection stateless across keystrokes. SECTION_REGEX
    // is global for match/replace elsewhere, and test() otherwise advances its
    // lastIndex and reports a still-visible token as missing on the next edit.
    SECTION_REGEX.lastIndex = 0;
    const hasSectionToken = SECTION_REGEX.test(value);
    SECTION_REGEX.lastIndex = 0;
    let nextSections = selectedSections;
    if (!hasSectionToken) {
      setSelectedSections([]);
      nextSections = [];
    } else {
      const tokenIds = value.match(SECTION_REGEX)?.map((token) => token.slice(2, -1)) ?? [];
      const tokenSections = tokenIds
        .map((token) => sectionForToken(token))
        .filter((section): section is SectionNode => Boolean(section));
      nextSections = selectedSections.filter(
        (section) =>
          tokenSections.some((resolved) => resolved.id === section.id) ||
          tokenIds.includes(section.id)
      );
      setSelectedSections(nextSections);
    }

    setInput(formatInputForDisplay(value, newMentions, nextSections));
  };

  const handleSelectDocument = (doc: { id: string; title: string }) => {
    if (!textareaRef.current) return;

    const textarea = textareaRef.current;
    const cursorPosition = textarea.selectionStart;
    const value = rawInput;

    // Find the @ position
    const beforeCursor = value.slice(0, cursorPosition);
    const atMatch = beforeCursor.match(/@(\w*)$/);

    if (atMatch) {
      const atPosition = cursorPosition - atMatch[0].length;
      const mentionToken = `@{${doc.id}}`;
      const newValue =
        value.slice(0, atPosition) + mentionToken + " " + value.slice(cursorPosition);

      setRawInput(newValue);
      setInput(formatInputForDisplay(newValue, [...mentions, { id: doc.id, title: doc.title, index: atPosition }], selectedSections));
      setShowMentionPopup(false);

      // Set cursor after the mention
      setTimeout(() => {
        const newPosition = atPosition + mentionToken.length + 1;
        textarea.setSelectionRange(newPosition, newPosition);
        textarea.focus();
      }, 0);
    }
  };

  const handleSelectSection = (sec: SectionNode) => {
    if (!textareaRef.current) return;

    const textarea = textareaRef.current;
    const cursorPosition = textarea.selectionStart;
    const value = rawInput;

    const beforeCursor = value.slice(0, cursorPosition);
    const hashMatch = beforeCursor.match(/#([^#\s]*)$/);

    if (hashMatch) {
      const hashPosition = cursorPosition - hashMatch[0].length;
      // Insert the section's stable id, not its title: the chip filter, the
      // display formatter, and history restore all key on ids, and a title
      // token was dropped by the very next keystroke (issue #44 bug 03).
      // Titles may also contain characters that break the token itself.
      const sectionToken = `#{${sec.id}}`;
      const newValue =
        value.slice(0, hashPosition) + sectionToken + " " + value.slice(cursorPosition);

      setRawInput(newValue);
      const selectedWithDocument = { ...sec, documentId: targetDocId };
      const nextSections = [...selectedSections.filter((section) => section.id !== sec.id), selectedWithDocument];
      setSelectedSections(nextSections);
      setShowSectionPopup(false);

      setInput(formatInputForDisplay(newValue, mentions, nextSections));

      setTimeout(() => {
        const newPosition = hashPosition + sectionToken.length + 1;
        textarea.setSelectionRange(newPosition, newPosition);
        textarea.focus();
      }, 0);
    }
  };

  const handleRemoveDocumentQaSection = (id: string) => {
    const removed = selectedSections.find((section) => section.id === id);
    const nextSections = selectedSections.filter((section) => section.id !== id);
    setSelectedSections(nextSections);
    if (removed) {
      const newRaw = rawInput
        .replace(`#{${removed.title}}`, "")
        .replace(`#{${removed.id}}`, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      setRawInput(newRaw);
      setInput(formatInputForDisplay(newRaw, mentions, nextSections));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // §3.1 — Cmd/Ctrl+Shift+K starts a new chat.
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "K" || e.key === "k")) {
      e.preventDefault();
      handleNewChat();
      return;
    }
    if (showMentionPopup) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionCursorIndex((prev) =>
          prev < filteredDocuments.length - 1 ? prev + 1 : prev
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionCursorIndex((prev) => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === "Enter" && filteredDocuments.length > 0) {
        e.preventDefault();
        handleSelectDocument(filteredDocuments[mentionCursorIndex]);
      } else if (e.key === "Escape") {
        setShowMentionPopup(false);
      }
    } else if (showSectionPopup) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSectionCursorIndex((prev) =>
          prev < filteredSections.length - 1 ? prev + 1 : prev
        );
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSectionCursorIndex((prev) => (prev > 0 ? prev - 1 : 0));
      } else if (e.key === "Enter" && filteredSections.length > 0) {
        e.preventDefault();
        handleSelectSection(filteredSections[sectionCursorIndex]);
      } else if (e.key === "Escape") {
        setShowSectionPopup(false);
      }
    } else if (e.key === "ArrowUp") {
      const textarea = textareaRef.current;
      if (textarea && textarea.selectionStart === 0 && userQueries.length > 0) {
        e.preventDefault();
        // Prefer the raw token history: formatted message contents have no
        // `#{...}` tokens, so restoring from them drops the section chips.
        const history = rawQueryHistory.length > 0 ? rawQueryHistory : userQueries;
        const nextIndex = historyIndex + 1;
        if (nextIndex < history.length) {
          if (historyIndex === -1) {
            setInputDraft(rawInput);
          }
          setHistoryIndex(nextIndex);
          const historicalQuery = history[nextIndex];
          setRawInput(historicalQuery);
          const { mentions: newMentions } = parseMentions(historicalQuery);
          setMentions(newMentions);
          const historicalSections = (historicalQuery.match(SECTION_REGEX) ?? [])
            .map((token) => sectionForToken(token.slice(2, -1)))
            .filter((section): section is SectionNode => Boolean(section));
          setSelectedSections(historicalSections);
          setInput(formatInputForDisplay(historicalQuery, newMentions, historicalSections));
        }
      }
    } else if (e.key === "ArrowDown") {
      const textarea = textareaRef.current;
      if (textarea && textarea.selectionStart === textarea.value.length && historyIndex >= 0) {
        e.preventDefault();
        const history = rawQueryHistory.length > 0 ? rawQueryHistory : userQueries;
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);

        let newQuery = "";
        if (nextIndex === -1) {
          newQuery = inputDraft;
        } else {
          newQuery = history[nextIndex] ?? userQueries[nextIndex] ?? "";
        }
        
        setRawInput(newQuery);
        const { mentions: newMentions } = parseMentions(newQuery);
        setMentions(newMentions);
        const historicalSections = (newQuery.match(SECTION_REGEX) ?? [])
          .map((token) => sectionForToken(token.slice(2, -1)))
          .filter((section): section is SectionNode => Boolean(section));
        setSelectedSections(historicalSections);
        setInput(formatInputForDisplay(newQuery, newMentions, historicalSections));
      }
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleRemoveMention = (mentionId: string) => {
    const token = `@{${mentionId}}`;
    const newValue = rawInput.replace(token, "");
    setRawInput(newValue);
    const { mentions: newMentions } = parseMentions(newValue);
    setMentions(newMentions);
    setInput(formatInputForDisplay(newValue, newMentions, selectedSections));
  };

  const refreshSessions = useCallback(() => {
    setSessions(loadSessions());
  }, []);

  // Flush (synchronously) the current live state into the active session.
  // Called before any session switch/new/delete to avoid stale-debounce races.
  const flushSaveActiveSession = useCallback(() => {
    if (sessionSaveTimerRef.current) {
      window.clearTimeout(sessionSaveTimerRef.current);
      sessionSaveTimerRef.current = null;
    }
    const id = getActiveSessionId();
    if (!id) return;
    const focusDocName = selectedDocumentId
      ? documents.find((d) => d.id === selectedDocumentId)?.title
      : t("tabs.wholeLibrary");
    updateSession(id, {
      messages,
      selectedDocumentId,
      webSearchEnabled,
      documentName: focusDocName,
    });
    refreshSessions();
  }, [messages, selectedDocumentId, webSearchEnabled, documents, t, refreshSessions]);

  // Hydrate the live store from a session record (and reset the composer).
  const hydrateFromSession = useCallback(
    (session: DocumentQaSession) => {
      isHydratingRef.current = true;
      setMessages(session.messages);
      setSelectedDocumentId(session.selectedDocumentId ?? "");
      setWebSearchEnabled(Boolean(session.webSearchEnabled));
      // Reset composer / transient focus state — composer is per-session.
      setInput("");
      setRawInput("");
      setMentions([]);
      setSelectedSections([]);
      setDetectedChapter(null);
      setHistoryIndex(-1);
      setProviderError(null);
      isHydratingRef.current = false;
      // Defer focus to the next tick so the textarea is rendered.
      window.setTimeout(() => textareaRef.current?.focus(), 0);
    },
    [setMessages],
  );

  // §2.1 — On mount: migrate legacy state once, then hydrate the active
  // session into the live store. Also refresh the sidebar list.
  useEffect(() => {
    const activeId = migrateLegacyState();
    setActiveSessionIdState(activeId);
    refreshSessions();
    const session = activeId ? loadSessions().find((s) => s.id === activeId) ?? null : null;
    if (session) {
      hydrateFromSession(session);
    } else {
      clearMessages();
    }
  }, []);

  // §2.2 — Debounced save of the live state back into the active session.
  // Skips writes triggered purely by hydration to avoid stomping a just-loaded
  // session with a stale closure. Flushes on unmount.
  useEffect(() => {
    if (!activeSessionId || isHydratingRef.current) return;
    if (sessionSaveTimerRef.current) {
      window.clearTimeout(sessionSaveTimerRef.current);
    }
    sessionSaveTimerRef.current = window.setTimeout(() => {
      const focusDocName = selectedDocumentId
        ? documents.find((d) => d.id === selectedDocumentId)?.title
        : t("tabs.wholeLibrary");
      updateSession(activeSessionId, {
        messages,
        selectedDocumentId,
        webSearchEnabled,
        documentName: focusDocName,
      });
      refreshSessions();
    }, 500);

    return () => {
      if (sessionSaveTimerRef.current) {
        window.clearTimeout(sessionSaveTimerRef.current);
        sessionSaveTimerRef.current = null;
      }
    };
  }, [messages, selectedDocumentId, webSearchEnabled, activeSessionId, documents, t, refreshSessions]);

  // Keep the sidebar list fresh after out-of-band mutations.
  useEffect(() => {
    refreshSessions();
  }, [sessionsVersion, refreshSessions]);

  // Persist sidebar collapse choice.
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SESSION_STORAGE_KEYS.sidebarCollapsed, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  // §3.2 / §3.3 — Start a new chat. If the composer has unsent text, confirm
  // first. Sent history is always preserved into the outgoing session.
  const handleNewChat = useCallback(() => {
    if (rawInput.trim()) {
      setShowNewChatConfirm(true);
      return;
    }
    startNewChatNow();
  }, [rawInput]);

  const startNewChatNow = useCallback(() => {
    flushSaveActiveSession();
    const fresh = createSession({
      selectedDocumentId,
      webSearchEnabled: false,
    });
    // Persist the new record immediately (createSession only builds the
    // object) so it's visible in the sidebar / survives a reload.
    saveSessions([fresh, ...loadSessions()]);
    setActiveSessionId(fresh.id);
    setActiveSessionIdState(fresh.id);
    hydrateFromSession(fresh);
    setSessionsVersion((v) => v + 1);
    setShowNewChatConfirm(false);
  }, [flushSaveActiveSession, hydrateFromSession, selectedDocumentId]);

  // §5.1 — Resume a past session with full state.
  const handleResumeSession = useCallback(
    (id: string) => {
      if (id === activeSessionId) return;
      flushSaveActiveSession();
      setActiveSessionId(id);
      setActiveSessionIdState(id);
      const target = loadSessions().find((s) => s.id === id) ?? null;
      if (target) {
        hydrateFromSession(target);
      } else {
        // Guard (§6.3): target vanished — fall back to a fresh session.
        const fresh = createSession();
        setActiveSessionId(fresh.id);
        setActiveSessionIdState(fresh.id);
        hydrateFromSession(fresh);
      }
      setSessionsVersion((v) => v + 1);
    },
    [activeSessionId, flushSaveActiveSession, hydrateFromSession],
  );

  // §4.4 — Rename a session inline.
  const handleRenameSession = useCallback(
    (id: string) => {
      const trimmed = renameValue.trim();
      if (trimmed) {
        renameQaSession(id, trimmed);
      }
      setRenamingSessionId(null);
      setRenameValue("");
      setSessionsVersion((v) => v + 1);
    },
    [renameValue],
  );

  // §4.4 — Delete a session (active session deletion is handled by the store:
  // it creates+activates an empty session and returns its id).
  const handleConfirmDelete = useCallback(() => {
    if (!pendingDeleteId) return;
    const wasActive = pendingDeleteId === activeSessionId;
    const newActiveId = deleteQaSession(pendingDeleteId);
    setPendingDeleteId(null);

    if (wasActive) {
      setActiveSessionId(newActiveId);
      setActiveSessionIdState(newActiveId);
      const fresh = loadSessions().find((s) => s.id === newActiveId) ?? null;
      if (fresh) hydrateFromSession(fresh);
    }
    setSessionsVersion((v) => v + 1);
  }, [pendingDeleteId, activeSessionId, hydrateFromSession]);

  // §3.4 — Clear the active conversation in place (keeps the session record,
  // empties its messages). Confirms first.
  const clearConversation = () => {
    if (messages.length > 0) {
      setShowClearConfirm(true);
      return;
    }
    clearMessages();
    setProviderError(null);
  };

  const confirmClearActiveConversation = () => {
    clearMessages();
    setProviderError(null);
    setShowClearConfirm(false);
    setSessionsVersion((v) => v + 1);
  };

  // Get document content for context (chapter-aware)
  const getDocumentContent = async (
    documentId: string, 
    chapterRef?: ChapterReference | null
  ): Promise<{ content: string; isChapterSpecific: boolean; chapterNumber?: number }> => {
    try {
      const doc = await getDocument(documentId);
      const docTitle = doc?.title || "Unknown Document";

      let documentContent = doc?.content || "";

      // If no content stored, try to extract from the document (e.g., PDF)
      if (!documentContent) {
        try {
          const extractionResult = await extractDocumentText(documentId);
          if (extractionResult.content) {
            documentContent = extractionResult.content;
          }
        } catch (extractionError) {
          console.warn(`Failed to extract text from document ${documentId}:`, extractionError);
        }
      }

      // If chapter reference detected and we have content, extract that chapter
      if (chapterRef && documentContent) {
        const maxTokens = contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : 4000;
        const chapterContext = buildChapterQAContext(docTitle, documentContent, chapterRef.number, maxTokens);
        
        return {
          content: chapterContext,
          isChapterSpecific: true,
          chapterNumber: chapterRef.number,
        };
      }

      // If document has content, use it (with truncation if needed)
      if (documentContent) {
        const maxTokens = contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : 4000;
        const maxChars = maxTokens * 4;
        let content = documentContent;
        if (content.length > maxChars) {
          content = content.slice(0, maxChars) + "\n\n[Content truncated due to length...]";
        }
        return {
          content: `Document: ${docTitle}\n\n${content}`,
          isChapterSpecific: false,
        };
      }

      // Otherwise, try to get extracts (highlights/notes) from the document
      try {
        const extracts = await getExtracts(documentId);
        if (extracts && extracts.length > 0) {
          const extractContent = extracts
            .map((e, i) => {
              let text = `[Extract ${i + 1}]`;
              if (e.page_number) text += ` (Page ${e.page_number})`;
              text += `\n${e.content}`;
              if (e.notes) text += `\nNote: ${e.notes}`;
              return text;
            })
            .join("\n\n");
          return {
            content: `Document: ${docTitle}\n\nExtracts and highlights from this document:\n\n${extractContent}`,
            isChapterSpecific: false,
          };
        }
      } catch (extractError) {
        console.warn(`Failed to get extracts for document ${documentId}:`, extractError);
      }

      return {
        content: `Document: ${docTitle}\n\n(No content or extracts available. This document may be a PDF or file that hasn't been processed yet.)`,
        isChapterSpecific: false,
      };
    } catch (error) {
      console.error(`Failed to get document ${documentId}:`, error);
      return {
        content: `Document ID: ${documentId}\n\n(Error loading content)`,
        isChapterSpecific: false,
      };
    }
  };

  const loadDocumentText = async (documentId: string): Promise<string> => {
    return loadDocumentQaText(documentId, { getDocument, extractDocumentText });
  };

  // Build aggregated content from mentioned documents (chapter-aware or section-aware)
  const buildMultiDocumentContext = async (
    documentIds: string[],
    chapterRef?: ChapterReference | null,
    focusedSection?: FocusedSectionContextResult | null
  ): Promise<{ content: string; isChapterSpecific: boolean; chapterNumber?: number; isSectionSpecific?: boolean; sectionTitle?: string }> => {
    if (documentIds.length === 0) {
      // If no documents mentioned, search all documents
      return {
        content: "User is asking about their documents. Search across all available documents to find relevant information.",
        isChapterSpecific: false,
      };
    }

    if (focusedSection?.ok) {
      const docTitle = documents.find((d) => d.id === documentIds[0])?.title || "Document";
      const titles = focusedSection.labels.join(", ");
      return {
        content: `Document: ${docTitle}\nFocused Section(s): ${titles}\n\n${focusedSection.content}`,
        isChapterSpecific: false,
        isSectionSpecific: true,
        sectionTitle: titles,
      };
    }

    // Get content for each document (with chapter extraction if referenced)
    const results = await Promise.all(
      documentIds.map((id) => getDocumentContent(id, chapterRef))
    );

    const isChapterSpecific = results.some(r => r.isChapterSpecific);
    const chapterNumber = results.find(r => r.chapterNumber)?.chapterNumber;

    // Combine contents
    let combined = results.map(r => r.content).join("\n\n---\n\n");

    // Rough token estimation and truncation
    const maxTokens = contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : 4000;
    const estimatedCharsPerToken = 4;
    const maxChars = maxTokens * estimatedCharsPerToken;

    if (combined.length > maxChars) {
      combined = combined.slice(0, maxChars) + "\n\n[Content truncated due to length...]";
    }

    return {
      content: combined,
      isChapterSpecific,
      chapterNumber,
    };
  };

  const parseToolCalls = (content: string) => {
    const toolCalls: ToolCall[] = [];
    const toolCallRegex = /```tool_calls\s*([\s\S]*?)```/g;
    let cleanedContent = content;

    let match: RegExpExecArray | null;
    while ((match = toolCallRegex.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        const calls = Array.isArray(parsed)
          ? parsed
          : Array.isArray(parsed?.tool_calls)
            ? parsed.tool_calls
            : [];

        calls.forEach((call: { name?: string; arguments?: Record<string, unknown> }) => {
          if (typeof call?.name === "string") {
            toolCalls.push({
              name: call.name,
              parameters: call.arguments || {},
              status: "pending",
            });
          }
        });
        cleanedContent = cleanedContent.replace(match[0], "").trim();
      } catch (error) {
        console.warn("Failed to parse tool call block:", error);
      }
    }

    return { cleanedContent, toolCalls };
  };

  const documentTitleFromStore = (documentId?: string): string | undefined => {
    if (!documentId) return undefined;
    return documents.find((document) => document.id === documentId)?.title
      ?? (currentDocument?.id === documentId ? currentDocument.title : undefined);
  };

  const resolveDocumentTitleForCards = async (documentId?: string): Promise<string | undefined> => {
    const storedTitle = documentTitleFromStore(documentId)?.trim();
    if (storedTitle) return storedTitle;
    if (!documentId) return undefined;
    try {
      return (await getDocument(documentId))?.title?.trim() || undefined;
    } catch (error) {
      console.warn("[Document Q&A] Could not resolve document title for generated-card deck:", error);
      return undefined;
    }
  };

  const toolDocumentId = (
    parameters: Record<string, unknown>,
    sourceContext?: FocusedSectionContextResult["source"],
  ): string | undefined => {
    const focusedDocumentId = sourceContext?.documentId || targetDocId;
    if (focusedDocumentId) return focusedDocumentId;
    return typeof parameters.document_id === "string" && parameters.document_id.trim()
      ? parameters.document_id
      : undefined;
  };

  const normalizeToolParameters = (
    toolName: string,
    parameters: Record<string, unknown>,
    sourceContext?: FocusedSectionContextResult["source"],
    documentTitleOverride?: string,
    documentIdOverride?: string,
  ) => {
    const normalized = { ...parameters };
    const documentId = documentIdOverride ?? toolDocumentId(normalized, sourceContext);
    const deckName = getDocumentDeckName(documentTitleOverride ?? documentTitleFromStore(documentId));

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

  const deckNameFromParameters = (parameters: Record<string, unknown>): string | undefined => {
    const tags = Array.isArray(parameters.tags) ? parameters.tags.map(String) : [];
    const deckTag = tags.find((tag) => tag.toLowerCase().startsWith("deck:"));
    return getDocumentDeckName(deckTag?.slice(5));
  };

  const upsertDocumentDeckForParameters = (
    toolName: string,
    parameters: Record<string, unknown>,
    sourceContext?: FocusedSectionContextResult["source"],
    documentIdOverride?: string,
  ) => {
    if (!CARD_CREATION_TOOL_NAMES.has(toolName)) return;
    const deckName = deckNameFromParameters(parameters);
    if (!deckName) return;
    const documentId = documentIdOverride ?? toolDocumentId(parameters, sourceContext);
    useStudyDeckStore.getState().addDeck(
      deckName,
      [deckName],
      documentId,
      documentId ? "all" : "tags",
    );
  };

  const executeToolCalls = async (messageId: string, calls: ToolCall[], sourceContext?: FocusedSectionContextResult["source"]) => {
    const results: Array<{ name: string; status: "success" | "error"; error?: string }> = [];
    const batchDeckNames: string[] = [];
    const resolvedTitles = new Map<string, string | undefined>();

    for (let index = 0; index < calls.length; index += 1) {
      const call = calls[index];
      const documentId = toolDocumentId(call.parameters, sourceContext);
      let resolvedDocumentTitle: string | undefined;
      if (documentId && ATTACHABLE_TOOL_NAMES.has(call.name)) {
        if (!resolvedTitles.has(documentId)) {
          resolvedTitles.set(documentId, await resolveDocumentTitleForCards(documentId));
        }
        resolvedDocumentTitle = resolvedTitles.get(documentId);
      }
      let parameters = normalizeToolParameters(call.name, call.parameters, sourceContext, resolvedDocumentTitle);

      if (documentId && CARD_CREATION_TOOL_NAMES.has(call.name) && !getDocumentDeckName(resolvedDocumentTitle)) {
        const errorMsg = "Could not save this card because the source document title could not be resolved. Reopen the document and retry.";
        updateToolCall(messageId, index, {
          parameters,
          result: errorMsg,
          status: "error",
        });
        results.push({ name: call.name, status: "error", error: errorMsg });
        continue;
      }

      // If this is a card/extract call and we created decks earlier in this batch,
      // ensure the card tags include the deck names so tag-based filtering works.
      if (batchDeckNames.length > 0) {
        const cardTools = new Set(["create_qa_card", "create_cloze_card", "batch_create_cards", "create_extract"]);
        if (cardTools.has(call.name)) {
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
        
        if (result.isError) {
          updateToolCall(messageId, index, {
            result: JSON.stringify(result.content),
            status: "error",
          });
          results.push({ name: call.name, status: "error", error: "Tool returned error" });
        } else {
          updateToolCall(messageId, index, {
            result,
            status: "success",
          });
          results.push({ name: call.name, status: "success" });
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

        // Upsert the document-title deck after a successful card write. Calling
        // addDeck for an existing name repairs older tag-only decks by binding
        // them to the source document and including legacy untagged cards.
        if (!result.isError && CARD_CREATION_TOOL_NAMES.has(call.name)) {
          upsertDocumentDeckForParameters(call.name, parameters, sourceContext);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        updateToolCall(messageId, index, {
          result: errorMsg,
          status: "error",
        });
        results.push({ name: call.name, status: "error", error: errorMsg });
      }
    }
  };

  const messageDocumentId = (message: Message): string | undefined => {
    const callDocumentId = message.toolCalls
      ?.map((call) => call.parameters.document_id)
      .find((value): value is string => typeof value === "string" && Boolean(value.trim()));
    return message.sourceContext?.documentId
      ?? message.sourceDocuments?.[0]
      ?? callDocumentId
      ?? undefined;
  };

  // Repair successful Document Q&A card sets created by older builds. Session
  // messages retain document ownership even when their deck tag was omitted,
  // so a document-bound title deck can recover those cards on reopen.
  useEffect(() => {
    const bindings = new Map<string, { name: string; documentId: string }>();
    for (const message of messages) {
      const documentId = messageDocumentId(message);
      if (!documentId) continue;
      for (const call of message.toolCalls ?? []) {
        if (!CARD_CREATION_TOOL_NAMES.has(call.name) || call.status !== "success") continue;
        const deckName = deckNameFromParameters(call.parameters)
          ?? getDocumentDeckName(documentTitleFromStore(documentId));
        if (deckName) bindings.set(`${documentId}:${deckName.toLowerCase()}`, { name: deckName, documentId });
      }
    }
    const store = useStudyDeckStore.getState();
    for (const binding of bindings.values()) {
      store.addDeck(binding.name, [binding.name], binding.documentId, "all");
    }
  }, [currentDocument, documents, messages]);

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

  const createChatDeck = (name: string, documentId?: string) => {
    useStudyDeckStore.getState().addDeck(name, [name], documentId, documentId ? "all" : "tags");
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
      const documentId = messageDocumentId(message) ?? toolDocumentId(call.parameters, message.sourceContext);
      const documentTitle = await resolveDocumentTitleForCards(documentId);
      const parameters = normalizeToolParameters(
        call.name,
        call.parameters,
        message.sourceContext,
        documentTitle,
        documentId,
      );
      if (documentId && CARD_CREATION_TOOL_NAMES.has(call.name) && !getDocumentDeckName(documentTitle)) {
        throw new Error("Could not save this card because the source document title could not be resolved. Reopen the document and retry.");
      }
      const result = await callAppMCPTool(call.name, parameters);
      updateToolCall(messageId, artifact.callIndex, {
        parameters,
        status: result.isError ? "error" : "success",
        result: result.isError ? JSON.stringify(result.content) : result,
      });
      if (!result.isError) upsertDocumentDeckForParameters(call.name, parameters, message.sourceContext, documentId);
    } catch (error) {
      updateToolCall(messageId, artifact.callIndex, {
        status: "error",
        result: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const trackNotebookEvent = useCallback((event: string, payload: Record<string, unknown> = {}) => {
    if (!analyticsEnabled) return;
    const detail = {
      event,
      payload,
      ts: Date.now(),
    };
    window.dispatchEvent(new CustomEvent("plethora:analytics", { detail }));
  }, [analyticsEnabled]);

  const handleResearchSelection = () => {
    if (!researchEditorRef.current) return;
    const editor = researchEditorRef.current;
    const range = createSelectionRange(researchDraft, editor.selectionStart, editor.selectionEnd);
    setSelectedRange(range);
  };

  const handleRunNotebookResearch = async (source: "notebooklm" | "brainstorm" = "notebooklm") => {
    if (!researchSession || !researchQuery.trim()) return;
    setResearchStatus("loading");
    setResearchError(null);
    setSaveMessage(null);

    try {
      const { session } = await orchestrateNotebooklmResearch({
        documentId: researchSession.documentId,
        notebookId: activeNotebookId,
        query: researchQuery.trim(),
        mode: "deep",
        from: "web",
        source,
        session: researchSession,
        retryCount: 2,
        timeoutMs: 30000,
      });
      setResearchSession(session);
      setResearchDraft(session.draftText);
      setResearchStatus("success");
      trackNotebookEvent("document_qa_notebooklm_research_success", {
        documentId: researchSession.documentId,
        source,
      });
    } catch (error) {
      const typed = error as NotebookLMResearchError | Error;
      const message = typed instanceof Error ? typed.message : "NotebookLM research failed";
      setResearchError(message);
      setResearchStatus("error");
      trackNotebookEvent("document_qa_notebooklm_research_error", {
        error: message,
      });
    }
  };

  const handleCreateClozeDraft = () => {
    if (!researchSession || !selectedRange) return;
    const clozeText = buildClozeFromSelection(researchDraft, selectedRange);
    const draft = createArtifactDraft(researchSession, "cloze", selectedRange, { clozeText });
    const updatedSession = upsertArtifactDraft(researchSession, draft);
    setResearchSession(updatedSession);
    setArtifactDraft(draft);
    setSaveMessage(null);
    trackNotebookEvent("document_qa_cloze_draft_created", { documentId: researchSession.documentId });
  };

  const handleCreateQaDraft = () => {
    if (!researchSession || !selectedRange) return;
    const qa = buildQaFromSelection(selectedRange);
    const draft = createArtifactDraft(researchSession, "qa", selectedRange, qa);
    const updatedSession = upsertArtifactDraft(researchSession, draft);
    setResearchSession(updatedSession);
    setArtifactDraft(draft);
    setSaveMessage(null);
    trackNotebookEvent("document_qa_qa_draft_created", { documentId: researchSession.documentId });
  };

  const handleSaveArtifactDraft = async () => {
    if (!artifactDraft || !researchSession) return;

    const documentId = researchSession.documentId;
    if (!documentId) {
      setSaveMessage("Select a document before saving a card.");
      return;
    }

    setIsSavingArtifact(true);
    setSaveMessage(null);
    try {
      const documentTitle = await resolveDocumentTitleForCards(documentId);
      const deckName = getDocumentDeckName(documentTitle);
      if (!deckName) {
        throw new Error("Could not save this card because the source document title could not be resolved. Reopen the document and retry.");
      }
      const tags = [
        "notebooklm",
        "document-qa",
        `research-session:${artifactDraft.provenance.sessionId}`,
        `deck:${deckName}`,
      ];

      let result: Awaited<ReturnType<typeof callAppMCPTool>>;
      if (artifactDraft.type === "cloze" && artifactDraft.clozeText) {
        result = await callAppMCPTool("create_cloze_card", {
          text: artifactDraft.clozeText,
          document_id: documentId,
          tags,
        });
      } else if (artifactDraft.type === "qa" && artifactDraft.question && artifactDraft.answer) {
        result = await callAppMCPTool("create_qa_card", {
          question: artifactDraft.question,
          answer: artifactDraft.answer,
          document_id: documentId,
          tags,
        });
      } else {
        throw new Error("Draft is incomplete. Fill all required fields first.");
      }
      if (result.isError) throw new Error("The card tool could not save this draft.");
      useStudyDeckStore.getState().addDeck(deckName, [deckName], documentId, "all");

      setSaveMessage("Card saved successfully.");
      setArtifactDraft(null);
      trackNotebookEvent("document_qa_artifact_saved", { type: artifactDraft.type, documentId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save artifact";
      setSaveMessage(message);
      trackNotebookEvent("document_qa_artifact_save_error", { error: message });
    } finally {
      setIsSavingArtifact(false);
    }
  };

  const handleSendMessage = async () => {
    if (!rawInput.trim() || isProcessing) return;

    const mentionedDocumentIds = mentions.length > 0
      ? mentions.map((m) => m.id)
      : selectedDocumentId
        ? [selectedDocumentId]
        : [];

    // Detect chapter references in the query
    const chapterRef = detectChapterReference(rawInput.replace(MENTION_REGEX, "").replace(SECTION_REGEX, ""));

    // Detect section references in the query (support multiple)
    const submittedSectionMentions = resolvePromptSectionMentions(
      rawInput,
      selectedSections,
      sections,
    );
    const hasSectionMentions = submittedSectionMentions.tokens.length > 0;
    const selectedSectionSnapshot = submittedSectionMentions.nodes;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: input, // Display version with document titles
      timestamp: Date.now(),
      mentionedDocumentIds,
    };

    addMessage(userMessage);
    setHistoryIndex(-1);
    const savedRawInput = rawInput;
    const restoreComposer = () => {
      setRawInput(savedRawInput);
      setMentions(parseMentions(savedRawInput).mentions);
      setSelectedSections(selectedSectionSnapshot);
      setInput(formatInputForDisplay(savedRawInput, mentions, selectedSectionSnapshot));
    };
    setRawInput("");
    setInput("");
    setMentions([]);
    setSelectedSections([]);
    setRawQueryHistory((prev) => [savedRawInput, ...prev]);
    setDetectedChapter(null);
    setProviderError(null);
    setIsProcessing(true);

    let userQuestion = savedRawInput.replace(MENTION_REGEX, "").replace(SECTION_REGEX, "").trim();
    const isTwentyRules = isTwentyRulesCommand(userQuestion);

    if (isTwentyRules && mentionedDocumentIds.length === 0 && !hasSectionMentions && !stripTwentyRulesCommand(userQuestion)) {
      addMessage({
        id: `assistant-${Date.now()}`,
        role: "assistant" as const,
        content: `${getTwentyRulesReminderMarkdown()}\n\n---\n💡 **Usage:** Mention a document using \`@\` (e.g. \`@DocumentName /20rules\`) or focus on a section to formulate atomic, high-retention flashcards adhering to spaced repetition best practices.`,
        timestamp: Date.now(),
      });
      setIsProcessing(false);
      return;
    }

    if (isTwentyRules) {
      userQuestion = stripTwentyRulesCommand(userQuestion) || "Create atomic flashcards from the provided content strictly following Dr. Piotr Wozniak's 20 Rules of Knowledge Formulation.";
    }

    try {
      const enabledProviders = getEnabledProviders();
      if (!enabledProviders || enabledProviders.length === 0) {
        const errorMsg = {
          id: `error-${Date.now()}`,
          role: "system" as const,
          content: "No LLM provider configured. Please add an API key in Settings to use Document Q&A.",
          timestamp: Date.now(),
        };
        addMessage(errorMsg);
        restoreComposer();
        setIsProcessing(false);
        return;
      }

      const provider = enabledProviders[0];

      let focusedSectionContext: FocusedSectionContextResult | null = null;
      if (hasSectionMentions) {
        if (submittedSectionMentions.unresolved.length > 0 || submittedSectionMentions.ambiguous.length > 0) {
          const detail = [
            ...submittedSectionMentions.unresolved.map((token) => `${token} is unavailable`),
            ...submittedSectionMentions.ambiguous.map((token) => {
              const entry = submittedSectionMentions.ambiguousTitles.find((e) => e.token === token);
              return `${token} matches multiple sections${entry ? ` (${entry.titles.join(", ")})` : ""}`;
            }),
          ].join("; ");
          addMessage({
            id: `error-${Date.now()}`,
            role: "system",
            content: `Could not focus the visible section chip${detail ? `: ${detail}` : ""}. Choose it again from the current document. No LLM request was sent.`,
            timestamp: Date.now(),
          });
          restoreComposer();
          return;
        }
        if (mentionedDocumentIds.length !== 1) {
          addMessage({
            id: `error-${Date.now()}`,
            role: "system",
            content: "Section context is unavailable because a # heading must belong to one active document. Select one document and choose the heading again.",
            timestamp: Date.now(),
          });
          restoreComposer();
          return;
        }

        const documentId = mentionedDocumentIds[0];
        const requestedSections = selectedSectionSnapshot;
        const hasStructuralSections = requestedSections.some((section) =>
          section.source !== "selection" && section.source !== "media-transcript"
        );
        const currentText = hasStructuralSections
          ? await loadDocumentText(documentId)
          : fullContent;
        if (hasStructuralSections && !currentText) {
          addMessage({
            id: `error-${Date.now()}`,
            role: "system",
            content: "The selected section could not be loaded from this document. Retry text extraction or select another heading before asking again.",
            timestamp: Date.now(),
          });
          restoreComposer();
          return;
        }

        const parsedCurrentSections = buildDocumentSections(currentText).flat.map((section) => ({ ...section, documentId }));
        const currentSections = [
          ...sectionFlat.map((section) => ({ ...section, documentId })),
          ...parsedCurrentSections.filter((parsed) => !sectionFlat.some((section) => section.id === parsed.id)),
        ];
        const maxTokens = contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : 4000;
        focusedSectionContext = resolveMixedSectionFocusedContext(requestedSections, currentSections, currentText, {
          documentId,
          maxTokens,
          includeNeighbors: true,
        });
        if (!focusedSectionContext.ok) {
          const failed = focusedSectionContext.unresolved.map(describeSectionDiagnostic).join("; ");
          addMessage({
            id: `error-${Date.now()}`,
            role: "system",
            content: `Could not focus the selected section${failed ? `: ${failed}` : ""}. Retry text extraction or select the heading again. No LLM request was sent.`,
            timestamp: Date.now(),
          });
          restoreComposer();
          return;
        }
        if (currentText) setFullContent(currentText);
      }

      const mcpTools = (await getAppMCPTools()) || [];
      const systemPrompt: LLMMessage = {
        role: "system",
        content: `You are a helpful assistant for incremental reading and spaced repetition.

${mentionedDocumentIds.length > 0
  ? `**DOCUMENT CONTENT PROVIDED**: The user has provided full document content below. Use this content to:
- Answer questions about the material
- Extract key concepts for flashcards
- Create extracts from important passages
- Summarize and explain topics

${chapterRef ? `**CHAPTER CONTEXT**: The user is asking about Chapter ${chapterRef.number}. Focus your answer and flashcard creation on that specific chapter.\n\n` : ''}
${focusedSectionContext?.ok ? `**SECTION CONTEXT**: The user is asking about Section(s) "${focusedSectionContext.labels.join(", ")}". Focus your answer and flashcard creation on those specific sections. Resolved context estimate: ${focusedSectionContext.estimatedTokens} tokens.\n\n` : ''}`
  : `The user is asking a general question. Answer based on your knowledge.`}

**CRITICAL: TOOL USAGE**
When the user asks to CREATE or SAVE learning items, you MUST output tool calls in the exact format below. DO NOT just display flashcards as text - use tool calls to actually save them to the database.

**When to use tools**:
- "Create flashcards", "make cards", "generate cards", "add to database" → MUST use create_qa_card or create_cloze_card tools
- "Create an extract", "save this quote", "save this passage" → MUST use create_extract tool
- "Save this note" → MUST use create_extract tool

**For regular questions** like "summarize", "explain", "what is" - answer directly without tools.

**FLASHCARD CREATION - CRITICAL INSTRUCTIONS**:
When asked to create flashcards:
1. Extract key concepts FROM THE PROVIDED DOCUMENT CONTENT
2. Create meaningful Q&A cards and cloze deletion cards
3. **IMPORTANT**: You MUST output the tool_calls code block to actually save the cards
4. Do NOT just display "Flashcard 1", "Flashcard 2" as text
5. The document_id will be automatically added

**CORRECT FORMAT (you MUST use this)**:
User: "Create 5 flashcards from this paper"
You respond:
\`\`\`tool_calls
{"tool_calls":[
  {"name":"create_qa_card","arguments":{"question":"What is the main contribution?","answer":"The paper introduces..."}},
  {"name":"create_cloze_card","arguments":{"text":"BRACE conditions on the {{belief distribution}}"}},
  {"name":"create_qa_card","arguments":{"question":"How does it learn?","answer":"End-to-end gradients..."}}
]}
\`\`\`

**WRONG FORMAT (do NOT do this)**:
Flashcard 1 - Q&A
Q: ...
A: ...

${mcpTools.length > 0 ? `**AVAILABLE TOOLS**: ${mcpTools.map((t) => t.name).join(", ")}

**REQUIRED TOOL CALL FORMAT**:
\`\`\`tool_calls
{"tool_calls":[{"name":"tool_name","arguments":{"key":"value"}}]}
\`\`\`` : ''}${isTwentyRules ? `\n\n${buildTwentyRulesSystemPrompt()}` : ""}`,
      };

      // Get document context (chapter-aware or section-aware)
      const { content: documentContext, isChapterSpecific, chapterNumber, isSectionSpecific, sectionTitle } = await buildMultiDocumentContext(
        mentionedDocumentIds,
        chapterRef,
        focusedSectionContext
      );

      let webSearchContext = "";
      if (webSearchEnabled) {
        try {
          interface BraveSearchResult {
            title: string;
            url: string;
            snippet: string;
          }
          const results = await invokeCommand<BraveSearchResult[]>("brave_web_search", { query: userQuestion });
          if (results && results.length > 0) {
            webSearchContext = "\n\n**Web Search Results (Brave Search)**:\n" +
              results.map((r, i) => `[${i + 1}] **${r.title}** (${r.url})\n   ${r.snippet}`).join("\n\n") + "\n\nUse the web search results to supplement your answer when necessary, citing them as [1], [2], etc.";
          }
        } catch (searchError) {
          console.warn("Brave Search failed:", searchError);
        }
      }

      // Whole-library RAG branch: when no specific document is mentioned,
      // retrieve relevant chunks across the collection and answer with
      // citations instead of the placeholder "search all documents" prompt.
      if (mentionedDocumentIds.length === 0 && !webSearchEnabled) {
        try {
          const { askLibrary } = await import("../../lib/ai/tasks/definitions/libraryTask");
          const { resolveEmbeddingConfigForRag } = await import("../assistant/ragConfig");

          const ragConfig = await resolveEmbeddingConfigForRag();

          const ragResult = await askLibrary({
            query: userQuestion,
            config: ragConfig,
          });

          // The library was never searched (nothing indexed) — say so instead
          // of letting the answer read as "I looked and my notes have nothing
          // on this".
          if (ragResult.sources.length === 0 && ragResult.answer.evidenceLevel === "none") {
            addMessage({
              id: `assistant-${Date.now()}`,
              role: "assistant" as const,
              content: `⚠️ ${ragResult.answer.answer}`,
              timestamp: Date.now(),
            });
            setIsProcessing(false);
            return;
          }

          // `content` is the answer alone; the retrieval citations ride along as
          // structured data so the sources footer can render them interactively.
          const citations = ragResult.sources.map(source => ({
            documentId: source.documentId,
            documentTitle: source.documentTitle ?? source.documentId,
            chunkIndex: source.location.ordinal,
            chunkText: source.text,
            score: source.score,
          }));
          const ragMessage = {
            id: `assistant-${Date.now()}`,
            role: "assistant" as const,
            content: ragResult.answer.answer,
            timestamp: Date.now(),
            sourceDocuments: citations.length > 0
              ? citations.map(c => c.documentId)
              : undefined,
            citations: citations.length > 0 ? citations : undefined,
          };
          addMessage(ragMessage);
          setIsProcessing(false);
          return;
        } catch (ragError) {
          // Do NOT fall through silently: answering from general knowledge
          // after retrieval failed is indistinguishable from having searched
          // the library and found nothing. Show the cause instead.
          console.warn("Library question failed:", ragError);
          const detail = ragError instanceof Error ? ragError.message : String(ragError);
          addMessage({
            id: `assistant-${Date.now()}`,
            role: "assistant" as const,
            content:
              `⚠️ I could not search your library, so this question was not answered from it.\n\n` +
              `**Cause:** ${detail}\n\n` +
              `Check the embedding provider in Settings → Embeddings (Ollama must be running for local models), ` +
              `then start library indexing. Mention a document with @ to ask about it directly.`,
            timestamp: Date.now(),
          });
          setIsProcessing(false);
          return;
        }
      }
      let contextPrefix = "";
      if (isChapterSpecific && chapterNumber) {
        contextPrefix = `[Focusing on Chapter ${chapterNumber}]\n\n`;
      }

      const requestContent = createDocumentQaRequestContent({
        documentContext,
        userQuestion,
        focusLabel: isSectionSpecific ? sectionTitle : undefined,
        webSearchContext,
      });

      const userPrompt: LLMMessage = {
        role: "user",
        content: mentionedDocumentIds.length > 0
          ? `${contextPrefix}${requestContent.userPromptContent}`
          : `${webSearchContext}\n\nUser question: ${userQuestion}`.trim(),
      };

      // Include recent messages (excluding system messages) for context
      const conversationHistory: LLMMessage[] = messages
        .filter(m => m.role === "user" || m.role === "assistant")
        .slice(-6) // Last 6 messages for context (3 turns)
        .map(m => ({
          role: m.role,
          content: m.content,
        }));

      // Call LLM with conversation history
      const response = await chatWithContext(
        provider.provider,
        provider.model,
        [systemPrompt, ...conversationHistory, userPrompt],
        {
          type: mentionedDocumentIds.length > 0 ? "document" : "general",
          documentId: mentionedDocumentIds[0],
          content: mentionedDocumentIds.length > 0 ? requestContent.contextContent : webSearchContext,
        },
        provider.apiKey,
        provider.baseUrl,
        provider.temperature,
        provider.maxTokens,
        provider.systemPrompt,
        aiControls?.contextFromRelatedCards,
        aiControls?.documentSnippetLength
      );

      const { cleanedContent, toolCalls } = parseToolCalls(response.content);

      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: "assistant" as const,
        content: cleanedContent || response.content,
        timestamp: Date.now(),
        sourceDocuments: mentionedDocumentIds.length > 0 ? mentionedDocumentIds : undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        sourceContext: focusedSectionContext?.ok ? focusedSectionContext.source : undefined,
      };

      addMessage(assistantMessage);

      if (toolCalls.length > 0) {
        await executeToolCalls(assistantMessage.id, toolCalls, focusedSectionContext?.ok ? focusedSectionContext.source : undefined);
      }
    } catch (error) {
      const errorMessage = {
        id: `error-${Date.now()}`,
        role: "system" as const,
        content: `Error: ${error instanceof Error ? error.message : "Failed to get response from AI. Please check your API key and try again."}`,
        timestamp: Date.now(),
      };
      addMessage(errorMessage);
    } finally {
      setIsProcessing(false);
    }
  };

  // Empty state when no documents
  if (documents.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <TextT className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
          <h2 className="text-2xl font-bold text-foreground mb-2">{t("tabs.noDocumentsYet")}</h2>
          <p className="text-muted-foreground mb-4">
            {t("tabs.importDocumentsFirst")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("tabs.useImportButton")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex bg-background">
      {/* Sessions sidebar (chat-app-native history rail); desktop only — a
          256px rail leaves no room for the chat column on a phone. */}
      {!isMobile && !sidebarCollapsed && (
        <aside className="w-64 flex-shrink-0 border-r border-border flex flex-col bg-card/50">
          <div className="p-3 border-b border-border flex items-center gap-2">
            <button
              onClick={startNewChatNow}
              className="flex-1 px-3 py-2 text-sm font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-center gap-1.5"
              title={t("tabs.newChatShortcut")}
            >
              <Plus className="w-4 h-4" />
              {t("tabs.newChat")}
            </button>
            <button
              onClick={toggleSidebar}
              className="p-2 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
              title={t("tabs.collapseSidebar")}
              aria-label={t("tabs.collapseSidebar")}
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          <div className="px-3 pt-2 pb-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("tabs.chatHistory")}
            </div>
          </div>

          <div className="flex-1 overflow-auto px-2 pb-2">
            {sessions.length === 0 ? (
              <div className="text-center text-xs text-muted-foreground p-4">
                <ChatCircle className="w-6 h-6 mx-auto mb-2 opacity-40" />
                <p>{t("tabs.sidebarEmpty")}</p>
              </div>
            ) : (
              <ul className="space-y-1">
                {sessions.map((session) => {
                  const isActive = session.id === activeSessionId;
                  const focusLabel = session.documentName || t("tabs.wholeLibrary");
                  return (
                    <li key={session.id}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleResumeSession(session.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleResumeSession(session.id);
                          }
                        }}
                        className={`group relative w-full text-left px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                          isActive
                            ? "bg-primary/15 ring-1 ring-primary/30"
                            : "hover:bg-muted"
                        }`}
                      >
                        {isActive && (
                          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-1 rounded-r bg-primary" />
                        )}
                        {renamingSessionId === session.id ? (
                          <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={() => handleRenameSession(session.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleRenameSession(session.id);
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                setRenamingSessionId(null);
                                setRenameValue("");
                              }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="w-full bg-background border border-primary rounded px-1.5 py-0.5 text-sm text-foreground focus:outline-none"
                          />
                        ) : (
                          <div className="pr-12">
                            <div className="text-sm font-medium text-foreground truncate">
                              {session.title}
                            </div>
                            <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground">
                              <span>{formatRelativeTime(session.updatedAt)}</span>
                              <span aria-hidden>·</span>
                              <span className="truncate">{focusLabel}</span>
                            </div>
                            {isActive && (
                              <span className="text-[10px] font-semibold uppercase text-primary">
                                {t("tabs.activeSessionLabel")}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Row hover actions */}
                        {renamingSessionId !== session.id && (
                          <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setRenamingSessionId(session.id);
                                setRenameValue(session.title);
                              }}
                              className="p-1 rounded text-muted-foreground hover:bg-background hover:text-foreground"
                              title={t("tabs.rename")}
                              aria-label={t("tabs.rename")}
                            >
                              <PencilSimple className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingDeleteId(session.id);
                              }}
                              className="p-1 rounded text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
                              title={t("tabs.deleteSession")}
                              aria-label={t("tabs.deleteSession")}
                            >
                              <Trash className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {sessions.length > 0 && (
              <p className="text-[10px] text-muted-foreground px-2 pt-3">
                {t("tabs.sidebarCapNote")}
              </p>
            )}
          </div>
        </aside>
      )}

      {/* Collapsed sidebar — show just the expand toggle */}
      {sidebarCollapsed && (
        <div className="w-10 flex-shrink-0 border-r border-border flex flex-col items-center py-3 bg-card/50">
          <button
            onClick={toggleSidebar}
            className="p-2 rounded-lg text-muted-foreground hover:bg-muted transition-colors"
            title={t("tabs.expandSidebar")}
            aria-label={t("tabs.expandSidebar")}
          >
            <List className="w-4 h-4" />
          </button>
          <button
            onClick={startNewChatNow}
            className="mt-2 p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            title={t("tabs.newChatShortcut")}
            aria-label={t("tabs.newChat")}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Chat column */}
      <div className="flex-1 flex flex-col min-w-0">
      {/* Header */}
      <div className="p-2 sm:p-4 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ChatCircle className="w-5 h-5 text-primary flex-shrink-0" />
          <h2 className="text-base sm:text-xl font-bold text-foreground truncate">{t("toolbar.documentQA")}</h2>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {documents.length > 0 && (
            <div className="flex items-center gap-1.5 bg-muted/50 border border-border rounded-lg px-2.5 py-1 text-muted-foreground focus-within:ring-1 focus-within:ring-primary transition-all max-w-[45vw]">
              <BookOpen className="w-3.5 h-3.5" />
              <select
                aria-label="Select focus document"
                value={selectedDocumentId}
                onChange={(e) => setSelectedDocumentId(e.target.value)}
                className="bg-transparent text-xs font-semibold text-foreground focus:outline-none cursor-pointer pr-1"
              >
                <option value="" className="bg-background text-foreground">🌐 {t("tabs.wholeLibrary")} (RAG)</option>
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id} className="bg-background text-foreground">
                    {doc.title.length > 30 ? `${doc.title.slice(0, 30)}...` : doc.title}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            onClick={handleNewChat}
            className="px-2 sm:px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center gap-1 min-h-[36px]"
            title={t("tabs.newChatShortcut")}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">{t("tabs.newChat")}</span>
          </button>
          {messages.length > 0 && (
            <button
              onClick={clearConversation}
              className="px-2 sm:px-3 py-1.5 text-sm bg-muted text-muted-foreground rounded hover:bg-destructive hover:text-destructive-foreground transition-colors flex items-center gap-1 min-h-[36px]"
              title={t("tabs.clearChat")}
            >
              <Trash className="w-4 h-4" />
              <span className="hidden sm:inline">{t("tabs.clearChat")}</span>
            </button>
          )}
        </div>
      </div>

      {notebookResearchEnabled && showLegacyNotebookResearch && (
        <div className="border-b border-border bg-muted/30 p-4">
          <div className="max-w-4xl mx-auto space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Flask className="w-4 h-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">NotebookLM Research Workspace</span>
              <select
                aria-label="Research document"
                value={activeResearchDocumentId}
                onChange={(e) => setResearchDocumentId(e.target.value)}
                className="px-2 py-1 border border-border rounded bg-background text-sm"
              >
                {documents.map((doc) => (
                  <option key={doc.id} value={doc.id}>
                    {doc.title}
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {activeNotebookId ? `Notebook: ${activeNotebookId}` : "No active NotebookLM notebook selected"}
              </span>
            </div>

            <div className="flex flex-wrap gap-2">
              {brainstormingPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => {
                    setResearchQuery(prompt);
                    trackNotebookEvent("document_qa_brainstorm_prompt_selected", { prompt });
                  }}
                  className="text-xs px-2 py-1 rounded-full border border-border bg-background hover:bg-muted"
                >
                  <Sparkle className="w-3 h-3 inline mr-1" />
                  {prompt.length > 54 ? `${prompt.slice(0, 54)}...` : prompt}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <textarea
                aria-label="Research query"
                value={researchQuery}
                onChange={(e) => setResearchQuery(e.target.value)}
                placeholder="Ask NotebookLM to research this document context..."
                className="w-full px-3 py-2 bg-background border border-border rounded text-sm resize-y min-h-[72px]"
              />
              <button
                onClick={() => void handleRunNotebookResearch("notebooklm")}
                disabled={researchStatus === "loading" || !researchQuery.trim()}
                className="px-4 py-2 bg-primary text-primary-foreground rounded disabled:opacity-50 flex items-center gap-2 self-start"
              >
                {researchStatus === "loading" ? <CircleNotch className="w-4 h-4 animate-spin" /> : <Sparkle className="w-4 h-4" />}
                Research
              </button>
            </div>

            <div>
              <textarea
                aria-label="Research draft"
                ref={researchEditorRef}
                value={researchDraft}
                onChange={(e) => setResearchDraft(e.target.value)}
                onSelect={handleResearchSelection}
                placeholder="NotebookLM output appears here. Edit inline, select text, then create cloze or Q&A drafts."
                className="w-full px-3 py-2 bg-background border border-border rounded text-sm min-h-[180px] font-mono"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={handleCreateClozeDraft}
                  disabled={!selectedRange}
                  className="px-3 py-1.5 text-xs rounded border border-border bg-background hover:bg-muted disabled:opacity-50"
                >
                  Create Cloze Draft
                </button>
                <button
                  onClick={handleCreateQaDraft}
                  disabled={!selectedRange}
                  className="px-3 py-1.5 text-xs rounded border border-border bg-background hover:bg-muted disabled:opacity-50"
                >
                  Create Q&A Draft
                </button>
                <span className="text-xs text-muted-foreground">
                  {selectedRange
                    ? `Selected ${selectedRange.end - selectedRange.start} chars`
                    : "Select text to enable card actions"}
                </span>
              </div>
            </div>

            {researchStatus === "error" && researchError && (
              <div className="text-xs text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded px-2 py-1 flex items-center gap-1">
                <WarningCircle className="w-3 h-3" />
                {researchError}
              </div>
            )}

            {artifactDraft && (
              <div className="p-3 border border-border rounded bg-background space-y-2">
                <div className="text-sm font-semibold text-foreground">
                  {artifactDraft.type === "cloze" ? "Cloze Draft Preview" : "Q&A Draft Preview"}
                </div>
                {artifactDraft.type === "cloze" ? (
                  <textarea
                    aria-label="Cloze text"
                    value={artifactDraft.clozeText || ""}
                    onChange={(e) => setArtifactDraft({ ...artifactDraft, clozeText: e.target.value, updatedAt: Date.now() })}
                    className="w-full px-2 py-1 border border-border rounded text-sm min-h-[90px]"
                  />
                ) : (
                  <div className="space-y-2">
                    <input
                      aria-label="Flashcard question"
                      value={artifactDraft.question || ""}
                      onChange={(e) => setArtifactDraft({ ...artifactDraft, question: e.target.value, updatedAt: Date.now() })}
                      className="w-full px-2 py-1 border border-border rounded text-sm"
                      placeholder="Question"
                    />
                    <textarea
                      aria-label="Flashcard answer"
                      value={artifactDraft.answer || ""}
                      onChange={(e) => setArtifactDraft({ ...artifactDraft, answer: e.target.value, updatedAt: Date.now() })}
                      className="w-full px-2 py-1 border border-border rounded text-sm min-h-[80px]"
                      placeholder="Answer"
                    />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void handleSaveArtifactDraft()}
                    disabled={isSavingArtifact}
                    className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50 flex items-center gap-1"
                  >
                    {isSavingArtifact ? <CircleNotch className="w-3 h-3 animate-spin" /> : <FloppyDisk className="w-3 h-3" />}
                    Save Card
                  </button>
                  <button
                    onClick={() => setArtifactDraft(null)}
                    className="px-3 py-1.5 text-xs rounded border border-border bg-background"
                  >
                    Cancel
                  </button>
                  <span className="text-xs text-muted-foreground">
                    Session {researchSession?.id?.slice(0, 12)}
                  </span>
                </div>
                {saveMessage && <div className="text-xs text-muted-foreground">{saveMessage}</div>}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mention badges, chapter detection, section focus - new tree-aware */}
      {(mentions.length > 0 || detectedChapter || selectedSections.length > 0) && (
        <div className="px-4 pt-2 flex flex-wrap gap-2">
          {mentions.map((mention) => (
            <span
              key={mention.id}
              className="inline-flex items-center gap-1 px-2 py-1 bg-primary/20 text-primary text-sm rounded-full"
            >
              <TextT className="w-3 h-3" />
              {mention.title}
              <button
                onClick={() => handleRemoveMention(mention.id)}
                className="hover:bg-primary/30 rounded-full p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
          {detectedChapter && (
            <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-sm rounded-full">
              <BookOpen className="w-3 h-3" />
              Chapter {detectedChapter.number}
              {detectedChapter.title && `: ${detectedChapter.title}`}
            </span>
          )}
          {selectedSections.map((selectedSection) => (
            <SectionMentionCard
              key={selectedSection.id}
              node={selectedSection}
              onRemove={handleRemoveDocumentQaSection}
            />
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto p-2 sm:p-4">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center max-w-md">
              <Sparkle className="w-8 h-8 sm:w-12 sm:h-12 mx-auto mb-2 sm:mb-4 text-primary opacity-50" />
              <h2 className="text-lg sm:text-2xl font-bold text-foreground mb-2">
                {t("tabs.askYourDocuments")}
              </h2>
              <p className="text-muted-foreground mb-4">
                {t("tabs.typeAtToMention")}
              </p>
              <div className={`${isMobile ? "hidden" : ""} text-sm text-muted-foreground text-left`}>
                <p className="font-semibold mb-2">Example questions:</p>
                <ul className="space-y-1">
                  <li>• "@MyDocument What are the main points?"</li>
                  <li>• "Summarize chapter 3" (saves tokens!)</li>
                  <li>• "@MyDocument Explain chapter 5 in detail"</li>
                  <li>• "Create flashcards from mentioned documents"</li>
                  <li>• "What insights can you extract?"</li>
                </ul>
                <p className="font-semibold mt-3 mb-1">Chapter-aware queries:</p>
                <p className="text-xs">
                  Mention a document, then ask about a specific chapter like "summarize chapter 9" 
                  to only process that chapter—saving LLM tokens and getting more focused answers.
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4 max-w-4xl mx-auto">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex flex-col ${message.role === "user" ? "items-end" : "items-start"}`}
              >
                {/* Message header */}
                <div className="flex items-center gap-2 mb-1">
                  {message.role === "user" ? (
                    <span className="text-xs text-muted-foreground">You</span>
                  ) : message.role === "system" ? (
                    <>
                      <Gear className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground">System</span>
                    </>
                  ) : (
                    <>
                      <Sparkle className="w-3 h-3 text-primary" />
                      <span className="text-xs text-muted-foreground">AI</span>
                    </>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </span>
                  {message.sourceDocuments && message.sourceDocuments.length > 0 && (
                    <span className="text-xs text-muted-foreground">
                      · {message.sourceDocuments.length} doc{message.sourceDocuments.length > 1 ? "s" : ""} referenced
                    </span>
                  )}
                </div>

                {/* Message content */}
                <div
                  className={`max-w-[85%] rounded-lg p-3 sm:p-4 relative group ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : message.role === "system"
                        ? "bg-muted text-muted-foreground border border-border"
                        : "bg-muted text-foreground"
                  }`}
                >
                  {message.role === "user" ? (
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  ) : (
                    <>
                      {message.role === "assistant" && (
                        <button
                          onClick={() => {
                            navigator.clipboard.writeText(sourcesCopyText(message.content, message.citations));
                            setCopiedMessageId(message.id);
                            setTimeout(() => setCopiedMessageId(null), 2000);
                          }}
                          className="absolute top-2 right-2 p-1.5 rounded bg-background/50 hover:bg-background/80 text-muted-foreground transition-all opacity-0 group-hover:opacity-100 border border-border"
                          title="Copy response"
                        >
                          {copiedMessageId === message.id ? (
                            <Check className="w-3.5 h-3.5 text-green-500" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                      <div
                        className="prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: renderMarkdown(message.content) }}
                      />
                      {/* Interactive sources footer — renders only when the
                          message carries structured citations (older persisted
                          messages have their sources baked into content as text
                          and must not gain a second footer). */}
                      {message.role === "assistant" &&
                        message.citations &&
                        message.citations.length > 0 && (
                          <DocumentQASources citations={message.citations} />
                        )}
                    </>
                  )}

                  {/* Tool calls */}
                  {message.toolCalls && message.toolCalls.length > 0 && (() => {
                    const artifacts = toolCallsToFlashcardArtifacts(message.id, message.toolCalls, {
                      source: message.sourceContext,
                      timestamp: message.timestamp,
                    });
                    const genericTools = nonFlashcardToolCalls(message.toolCalls);
                    const artifactDocumentId = (messageDocumentId(message) ?? targetDocId) || undefined;
                    const deckName = getFlashcardArtifactDeckName(artifacts)
                      ?? (artifacts.length > 0
                        ? getDocumentDeckName(documentTitleFromStore(artifactDocumentId))
                        : undefined);
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
                          onCreate: () => createChatDeck(deckName, artifactDocumentId),
                          onOpen: () => openChatDeck(deckName),
                        } : undefined}
                      />
                      {genericTools.length > 0 && <div className="mt-3 space-y-2">
                      {genericTools.map((tool, idx) => (
                        <div
                          key={idx}
                          className={`text-xs px-2 py-1 rounded flex items-center gap-2 ${
                            tool.status === "success"
                              ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                              : tool.status === "error"
                                ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                                : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"
                          }`}
                        >
                          <span className="font-medium">{tool.name}</span>
                          {tool.status === "pending" && <CircleNotch className="w-3 h-3 animate-spin" />}
                        </div>
                      ))}
                    </div>}
                    </>
                    );
                  })()}
                </div>

                {/* Mentioned documents in user message */}
                {message.mentionedDocumentIds && message.mentionedDocumentIds.length > 0 && (
                  <div className="flex gap-1 mt-1">
                    {message.mentionedDocumentIds.map((docId) => {
                      const doc = documents.find((d) => d.id === docId);
                      return doc ? (
                        <span
                          key={docId}
                          className="text-xs px-2 py-0.5 bg-muted rounded text-muted-foreground flex items-center gap-1"
                        >
                          <TextT className="w-3 h-3" />
                          {doc.title}
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            ))}
            {isProcessing && (
              <div className="flex items-start">
                <div className="bg-muted rounded-lg p-4">
                  <CircleNotch className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      <div
        className="p-2 sm:p-4 border-t border-border relative"
        style={{ paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))" }}
      >
        {/* Quick Command Chips */}
        <div className="flex items-center gap-2 max-w-4xl mx-auto mb-2 text-xs">
          <button
            type="button"
            onClick={() => {
              setRawInput((prev) => {
                const trimmed = prev.trim();
                if (!trimmed) return "/20rules ";
                if (isTwentyRulesCommand(trimmed)) return prev;
                return `/20rules ${trimmed}`;
              });
              textareaRef.current?.focus();
            }}
            title="Formulate atomic flashcards following Dr. Wozniak's 20 Rules (Minimum Info Principle, clozes, anti-interference)"
            className="px-2.5 py-1 bg-muted/80 hover:bg-muted border border-border/80 rounded-md text-foreground transition-colors flex items-center gap-1.5 font-medium shadow-xs"
          >
            <Sparkle className="w-3.5 h-3.5 text-amber-500" />
            <span className="font-mono font-semibold">/20rules</span>
            <span className="text-[11px] text-muted-foreground font-normal hidden sm:inline">— 20 Rules Formulation</span>
          </button>
        </div>

        <div className="flex gap-2 max-w-4xl mx-auto">
          <div className="relative flex-1">
            <textarea
              ref={textareaRef}
              value={rawInput}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder="Type @ to mention documents... (Shift+Enter for new line)"
              className="w-full px-3 sm:px-4 py-2 sm:py-3 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground resize-none pr-12 text-[15px]"
              rows={isMobile ? 1 : 2}
              disabled={isProcessing}
            />
            {/* Character indicator for mentions */}
            {mentions.length > 0 && (
              <div className="absolute bottom-2 left-4 text-xs text-muted-foreground">
                {mentions.length} document{mentions.length > 1 ? "s" : ""} mentioned
              </div>
            )}
          </div>
          <button
            onClick={() => setWebSearchEnabled(!webSearchEnabled)}
            title="Toggle Web Search"
            className={`px-3 sm:px-4 py-2 sm:py-3 min-h-[44px] border rounded-lg transition-all flex items-center gap-1.5 ${
              webSearchEnabled
                ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/20"
                : "bg-muted/50 border-border text-muted-foreground hover:bg-muted"
            }`}
            disabled={isProcessing}
          >
            <Globe className={`w-5 h-5 ${webSearchEnabled ? "animate-pulse" : ""}`} />
            <span className="text-xs font-semibold hidden md:inline">Web Search</span>
          </button>
          <button
            onClick={handleSendMessage}
            disabled={!rawInput.trim() || isProcessing}
            className="px-4 sm:px-6 py-2 sm:py-3 min-h-[44px] bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isProcessing ? (
              <CircleNotch className="w-5 h-5 animate-spin" />
            ) : (
              <PaperPlaneTilt className="w-5 h-5" />
            )}
          </button>
        </div>

        {/* Mention autocomplete popup */}
        {showMentionPopup && filteredDocuments.length > 0 && (
          <div
            ref={mentionPopupRef}
            className="absolute bottom-full left-4 right-4 mb-2 max-w-4xl mx-auto bg-card border border-border rounded-lg shadow-lg overflow-hidden z-10"
          >
            <div className="max-h-48 overflow-auto">
              {filteredDocuments.map((doc, index) => (
                <button
                  key={doc.id}
                  onClick={() => handleSelectDocument(doc)}
                  className={`w-full px-4 py-2 text-left hover:bg-muted transition-colors flex items-center gap-3 ${
                    index === mentionCursorIndex ? "bg-muted" : ""
                  }`}
                >
                  <TextT className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {doc.title}
                    </div>
                    {doc.metadata?.author && (
                      <div className="text-xs text-muted-foreground truncate">
                        {doc.metadata.author}
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
            <div className="px-4 py-2 bg-muted text-xs text-muted-foreground">
              Use ↑↓ to navigate, Enter to select, Escape to close
            </div>
          </div>
        )}

        {/* Section autocomplete popup - new tree-aware */}
        {showSectionPopup && (
          <SectionMentionPopup
            tree={pickerSectionTree}
            flat={pickerSectionFlat}
            query={sectionQuery}
            selectedIndex={sectionCursorIndex}
            onSelect={handleSelectSection}
            open={showSectionPopup}
            isLoading={
              isMediaCatalogLoading ||
              (Boolean(targetDocId) && fullContentLoading && pickerSectionFlat.length === 0)
            }
            loadingLabel="Loading transcript chapters…"
            unavailableReason={
              !targetDocId ? t("sectionMention.noDocumentTargeted") : null
            }
          />
        )}
      </div>

      {/* Confirmation dialogs (new chat / clear active / delete session) */}
      {showNewChatConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("tabs.clearDraftTitle")}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowNewChatConfirm(false)}
        >
          <div
            className="max-w-sm w-full bg-background border border-border rounded-lg shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2 mb-3">
              <WarningCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-semibold text-foreground">{t("tabs.clearDraftTitle")}</h3>
                <p className="text-sm text-muted-foreground mt-1">{t("tabs.clearDraftBody")}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNewChatConfirm(false)}
                className="px-3 py-1.5 text-sm rounded border border-border bg-background hover:bg-muted"
              >
                {t("tabs.cancel")}
              </button>
              <button
                onClick={startNewChatNow}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {t("tabs.startNewChat")}
              </button>
            </div>
          </div>
        </div>
      )}

      {showClearConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("tabs.clearActiveChatTitle")}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setShowClearConfirm(false)}
        >
          <div
            className="max-w-sm w-full bg-background border border-border rounded-lg shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2 mb-3">
              <Trash className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-semibold text-foreground">{t("tabs.clearActiveChatTitle")}</h3>
                <p className="text-sm text-muted-foreground mt-1">{t("tabs.clearActiveChatBody")}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowClearConfirm(false)}
                className="px-3 py-1.5 text-sm rounded border border-border bg-background hover:bg-muted"
              >
                {t("tabs.cancel")}
              </button>
              <button
                onClick={confirmClearActiveConversation}
                className="px-3 py-1.5 text-sm rounded bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("tabs.clearChat")}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingDeleteId && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t("tabs.deleteSession")}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setPendingDeleteId(null)}
        >
          <div
            className="max-w-sm w-full bg-background border border-border rounded-lg shadow-xl p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2 mb-3">
              <XCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-base font-semibold text-foreground">{t("tabs.deleteSession")}</h3>
                <p className="text-sm text-muted-foreground mt-1">{t("tabs.deleteSessionConfirm")}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setPendingDeleteId(null)}
                className="px-3 py-1.5 text-sm rounded border border-border bg-background hover:bg-muted"
              >
                {t("tabs.cancel")}
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-3 py-1.5 text-sm rounded bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {t("tabs.deleteSession")}
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
