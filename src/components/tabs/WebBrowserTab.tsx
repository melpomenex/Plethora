/**
 * Web Browser Tab with Extract Creation
 *
 * Renders arbitrary web pages inside the tab and lets the user turn selected
 * text into extracts.
 *
 * Page rendering (design: openspec/changes/fix-in-app-browser-page-loading):
 * - **Desktop / native mobile (Tauri):** the Rust loopback web proxy
 *   (`web_proxy.rs`) fetches the upstream document, strips
 *   `X-Frame-Options`/CSP, and serves it from `http://127.0.0.1:<port>`. The
 *   tab frames that proxied URL in a sandboxed iframe and talks to the page
 *   through the injected bridge via `postMessage`. The URL bar, page title,
 *   back/forward history, bookmarks, extracts, and "Open in system browser"
 *   always carry the **upstream** URL, never the loopback one.
 * - **Browser / PWA:** no Rust backend, so the direct iframe is attempted as
 *   before and the embed-blocked → Reader View fallback stays.
 *
 * Selection capture works directly on the proxied page: the bridge reports
 * `selection` messages, the tab stores the latest one, and "Create Extract"
 * (or the configured shortcut) opens the dialog pre-filled — no clipboard or
 * manual paste step. The Assistant's context resolver reads the live page's
 * text via `text-request`/`text-response` before falling back to Reader View
 * content and a re-fetch.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  ArrowClockwise,
  ArrowSquareOut,
  BookmarkSimple,
  BookOpen,
  CaretLeft,
  CaretRight,
  ChatCircle,
  CheckCircle,
  Clock,
  Eye,
  FolderOpen,
  Highlighter,
  Plus,
  Sparkle,
  Tag,
  Trash,
  X,
} from "@phosphor-icons/react";
import { isTauri } from "../../lib/tauri";
import { unwrapSearchRedirector } from "../../utils/searchRedirectors";
import { useI18n } from "../../lib/i18n";
import { getShortcutCombo } from "../common/KeyboardShortcuts";
import { CompactTagEditor } from "../common/CompactTagEditor";
import { createExtract, type CreateExtractInput } from "../../api/extracts";
import { createLearningItem } from "../../api/learning-items";
import { createDocument, fetchUrlContent, readDocumentFile } from "../../api/documents";
import { processHtmlContent } from "../../utils/documentImport";
import { AssistantPanel, type AssistantContext } from "../assistant/AssistantPanel";
import {
  resolveGenericAssistantContext,
  type AssistantContextSource,
  type ResolvedAssistantContext,
} from "../../utils/assistantContext";
import { trimToTokenWindow } from "../../utils/tokenizer";
import { useSettingsStore, useTabsStore } from "../../stores";
import { WebBrowserTab as LazyWebBrowserTab } from "./TabRegistry";
import { useToast } from "../common/Toast";
import { formatRelativeTime } from "../../utils/date";
import { resolveWebProxyUrl, proxyOriginOf, requestFrameText, isTrustedBridgeEvent } from "../../lib/webProxy";
import {
  WEB_BRIDGE_NS,
  parseWebBridgeMessage,
  type WebBridgeNavigatePayload,
  type WebBridgeReadyPayload,
  type WebBridgeSelectionPayload,
} from "../../lib/webview-extract-bridge";

interface WebExtract {
  id?: string;
  content: string;
  htmlContent?: string;
  url: string;
  pageTitle: string;
  timestamp: number;
  note?: string;
  tags?: string[];
}

interface ExtractDialogProps {
  extract: WebExtract;
  onSave: (data: { content: string; htmlContent?: string; note: string; tags: string[] }) => void;
  onClose: () => void;
}

function ExtractDialog({ extract, onSave, onClose }: ExtractDialogProps) {
  const toast = useToast();
  const { t } = useI18n();
  const [content, setContent] = useState(extract.content || "");
  const [note, setNote] = useState(extract.note || "");
  const [tags, setTags] = useState<string[]>(extract.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [color, setColor] = useState("yellow");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const isManualMode = !extract.content;

  const colors = [
    { name: "yellow", value: "#fef08a", bg: "bg-yellow-200", border: "border-yellow-400" },
    { name: "green", value: "#bbf7d0", bg: "bg-green-200", border: "border-green-400" },
    { name: "blue", value: "#bfdbfe", bg: "bg-blue-200", border: "border-blue-400" },
    { name: "purple", value: "#e9d5ff", bg: "bg-purple-200", border: "border-purple-400" },
    { name: "red", value: "#fecaca", bg: "bg-red-200", border: "border-red-400" },
    { name: "orange", value: "#fed7aa", bg: "bg-orange-200", border: "border-orange-400" },
  ];

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const handleSaveAsExtract = async () => {
    if (!content.trim()) {
      toast.error("Please enter some content");
      return;
    }
    setIsSaving(true);
    try {
      onSave({ content, htmlContent: extract.htmlContent, note, tags });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateFlashcard = async () => {
    setIsGenerating(true);
    try {
      await createLearningItem({
        item_type: "Qa",
        question: `What is the main point of: "${extract.content.slice(0, 100)}..."?`,
        answer: extract.content,
      });
      onClose();
    } catch (error) {
      console.error("Error creating flashcard:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  // Preview of the extract with color
  const selectedColor = colors.find(c => c.name === color) || colors[0];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card border border-border rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${selectedColor.bg}`}>
              <Highlighter className="w-5 h-5 text-foreground" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">{t("extracts.createTitle")}</h3>
              <p className="text-xs text-muted-foreground">{t("viewer.from")}: {extract.pageTitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Selected content preview / Manual input */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2 flex items-center gap-2">
              <BookOpen className="w-4 h-4 text-muted-foreground" />
              {isManualMode ? t("viewer.extractContent") : t("viewer.selectedContent")}
              {extract.htmlContent && !isManualMode && (
                <span className="text-xs text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  Rich formatting preserved
                </span>
              )}
            </label>

            {isManualMode ? (
              // Manual input mode — the user types the content themselves.
              // Selection capture now works directly on proxied pages, so the
              // old copy-and-paste caveat is gone.
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Type or paste the content you want to save..."
                className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground resize-none"
                rows={6}
              />
            ) : (
              // Auto-captured content mode
              <>
                <div className={`p-4 rounded-lg border-2 ${selectedColor.border} ${selectedColor.bg} bg-opacity-30 max-h-48 overflow-y-auto`}>
                  {extract.htmlContent ? (
                    <div
                      className="prose prose-sm max-w-none text-foreground"
                      dangerouslySetInnerHTML={{ __html: extract.htmlContent }}
                    />
                  ) : (
                    <p className="text-foreground whitespace-pre-wrap">{content}</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {content.length} characters selected
                </p>
              </>
            )}
          </div>

          {/* Color selection */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t("extracts.highlightColor")}
            </label>
            <div className="flex items-center gap-3">
              {colors.map((c) => (
                <button
                  key={c.name}
                  onClick={() => setColor(c.name)}
                  className={`w-10 h-10 rounded-full ${c.bg} border-2 transition-all ${
                    color === c.name ? `${c.border} ring-2 ring-offset-2 ring-offset-card ring-primary scale-110` : 'border-transparent hover:scale-105'
                  }`}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">
              {t("extracts.notes")} <span className="text-muted-foreground font-normal">({t("extracts.optional").toLowerCase()})</span>
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add your thoughts, context, or why this extract is important..."
              className="w-full px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground resize-none"
              rows={3}
            />
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2 flex items-center gap-2">
              <Tag className="w-4 h-4 text-muted-foreground" />
              Tags
            </label>
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyPress={(e) => e.key === "Enter" && handleAddTag()}
                placeholder="Add a tag..."
                className="flex-1 px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
              />
              <button
                onClick={handleAddTag}
                className="p-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-5 h-5" />
              </button>
            </div>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-secondary text-secondary-foreground rounded-full text-sm"
                  >
                    <Tag className="w-3 h-3" />
                    {tag}
                    <button
                      onClick={() => handleRemoveTag(tag)}
                      className="ml-1 hover:text-destructive transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Source info */}
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ArrowSquareOut className="w-3 h-3" />
              <span className="truncate">{extract.url}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-border bg-muted/30 space-y-2">
          <button
            onClick={handleSaveAsExtract}
            disabled={isSaving || !content.trim()}
            className="w-full px-4 py-2.5 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors flex items-center justify-center gap-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <>
                <div className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <BookmarkSimple className="w-4 h-4" />
                {isManualMode ? t("extracts.saveExtract") : t("extracts.saveAsExtract")}
              </>
            )}
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleCreateFlashcard}
              disabled={isGenerating}
              className="flex-1 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/90 transition-colors flex items-center justify-center gap-2 text-sm"
            >
              <Sparkle className="w-4 h-4" />
              {isGenerating ? "Creating..." : "Create Flashcard"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-card border border-border text-foreground rounded-lg hover:bg-muted transition-colors text-sm"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WebBrowserTab({ initialUrl }: { initialUrl?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [url, setUrl] = useState("");
  // `requestedUrl` drives proxy resolution; `currentUrl` is the displayed /
  // attributed upstream URL (reconciled to the final post-redirect URL on
  // `ready`). Splitting them means the proxy is only re-resolved on explicit
  // navigation, never when a redirect reconciles the URL bar.
  const [requestedUrl, setRequestedUrl] = useState("");
  const [currentUrl, setCurrentUrl] = useState("");
  const [pageTitle, setPageTitle] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [proxyFailure, setProxyFailure] = useState<{ reason: string; host: string } | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [extractDialog, setExtractDialog] = useState<WebExtract | null>(null);
  const [showSidebar, setShowSidebar] = useState(false);
  const [savedExtracts, setSavedExtracts] = useState<WebExtract[]>([]);
  const [showAssistant, setShowAssistant] = useState(false);
  const [iframeStatus, setIframeStatus] = useState<"idle" | "loading" | "loaded" | "blocked">("idle");
  const [readerContent, setReaderContent] = useState<{ html: string; title: string } | null>(null);
  const [isLoadingReader, setIsLoadingReader] = useState(false);
  // Mirror of `readerContent` kept in a ref so the assistant's context resolver
  // always reads the latest Reader View content at send time.
  const readerContentRef = useRef<{ html: string; title: string } | null>(null);
  readerContentRef.current = readerContent;
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [extractsExpanded, setExtractsExpanded] = useState(true);

  // Proxy state (Tauri path only). `proxyOrigin` is the origin the proxied
  // iframe runs under; inbound bridge messages must carry exactly it.
  const [proxyUrl, setProxyUrl] = useState<string | null>(null);
  const proxyOriginRef = useRef<string | null>(null);
  // Latest selection reported by the bridge, kept in a ref so extract
  // creation and the assistant always read the freshest value.
  const latestSelectionRef = useRef<WebBridgeSelectionPayload | null>(null);

  const currentUrlRef = useRef(currentUrl);
  currentUrlRef.current = currentUrl;
  const pageTitleRef = useRef(pageTitle);
  pageTitleRef.current = pageTitle;
  // Fresh snapshots for the bridge callbacks, which are registered once.
  const requestedUrlRef = useRef(requestedUrl);
  requestedUrlRef.current = requestedUrl;
  const historyIndexRef = useRef(historyIndex);
  historyIndexRef.current = historyIndex;

  const contextWindowTokens = useSettingsStore((state) => state.settings.ai.maxTokens);

  const assistantContext = useMemo<AssistantContext>(() => {
    if (!currentUrl) return { type: "web" };
    const maxTokens = contextWindowTokens && contextWindowTokens > 0 ? contextWindowTokens : 4000;

    // Strip tags to readable text (used for both Reader View and fetched HTML).
    const htmlToText = (html: string): string => {
      try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        return (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();
      } catch {
        return "";
      }
    };

    const resolveContextForPrompt = async (): Promise<ResolvedAssistantContext> => {
      let body = "";
      let source: AssistantContextSource = "document-content";

      // 0. Bridge text-request → text-response (Tauri proxy path): the live
      //    proxied page's text, no second network fetch (D6).
      if (isTauri() && iframeRef.current?.contentWindow && proxyOriginRef.current) {
        try {
          const frameText = await requestFrameText(
            iframeRef.current.contentWindow,
            proxyOriginRef.current,
            2500
          );
          if (frameText.trim()) {
            body = frameText;
            source = "document-content";
          }
        } catch {
          // Fall through to the ladder below.
        }
      }

      // 1. Reader View content — the reliable fallback for sites the proxy
      //    cannot render (paywalls, bot walls, heavy SPAs).
      if (!body && readerContentRef.current?.html) {
        body = htmlToText(readerContentRef.current.html);
      }

      // 2. Same-origin iframe: read the embedded document's text directly
      //    (browser/PWA direct-iframe path only — the proxied iframe is
      //    cross-origin and already covered by the bridge branch above).
      if (!body) {
        try {
          const doc = iframeRef.current?.contentDocument;
          if (doc?.body) {
            const text = (doc.body.innerText ?? doc.body.textContent ?? "")
              .replace(/\s+/g, " ")
              .trim();
            if (text) body = text;
          }
        } catch {
          // Cross-origin iframe — text is not readable; fall through to fetch.
        }
      }

      // 3. Last resort: fetch the page and run the same reader-view pipeline.
      if (!body) {
        try {
          const fetched = await fetchUrlContent(currentUrl);
          const rawHtml = fetched.html ?? (fetched.file_path
            ? new TextDecoder("utf-8").decode(await readDocumentFile(fetched.file_path))
            : "");
          if (rawHtml) {
            const processed = processHtmlContent(rawHtml, currentUrl, pageTitle || currentUrl, true);
            body = htmlToText(processed);
          }
        } catch {
          // Keep body empty → unavailable below.
        }
      }

      if (!body) {
        return {
          status: "unavailable",
          source: "none",
          message:
            "No readable text could be loaded from this page. Open Reader View first, then try again.",
        };
      }

      try {
        const trimmed = await trimToTokenWindow(body, maxTokens);
        return { ...resolveGenericAssistantContext(trimmed, source), status: "ready" as const };
      } catch {
        return { ...resolveGenericAssistantContext(body.slice(0, maxTokens * 4), source), status: "ready" as const };
      }
    };

    return {
      type: "web",
      url: currentUrl,
      contextWindowTokens: maxTokens,
      status: "ready",
      source: "document-content",
      resolveForPrompt: resolveContextForPrompt,
    };
  }, [currentUrl, contextWindowTokens, pageTitle]);

  // Some sites block the direct iframe (browser/PWA path) without firing its
  // error event, leaving a black box. If nothing has loaded within the grace
  // period, surface the blocked state (with Reader View / open-in-browser
  // actions) instead. On the Tauri path the same timeout doubles as the
  // watchdog for frames that escape the proxy: such a frame never posts a
  // trusted bridge `ready`, so the blocked state replaces a silent blank.
  const scheduleIframeBlockedFallback = useCallback(() => {
    window.setTimeout(() => {
      setIframeStatus((prev) => (prev === "loading" ? "blocked" : prev));
    }, 8000);
  }, []);

  const pushHistory = useCallback((entry: string) => {
    setHistory((prev) => {
      const next = prev.slice(0, historyIndex + 1);
      next.push(entry);
      setHistoryIndex(next.length - 1);
      return next;
    });
  }, [historyIndex]);

  // Bridge messages carry attacker-controlled payloads (the proxied page's own
  // scripts can post anything from the proxy origin). Only accept well-formed
  // http(s) URLs — never file:, javascript:, or malformed strings — in the URL
  // bar, history, bookmarks, extracts, and "open in system browser" paths.
  const isSafeWebUrl = useCallback((value: string): value is string => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }, []);

  const addTab = useTabsStore((state) => state.addTab);

  const openNewBrowserTab = useCallback((targetUrl: string) => {
    if (!isSafeWebUrl(targetUrl)) return;
    addTab({
      title: new URL(targetUrl).hostname,
      icon: "🌐",
      type: "web-browser",
      content: LazyWebBrowserTab,
      closable: true,
      data: { initialUrl: targetUrl },
    });
  }, [addTab, isSafeWebUrl]);

  const handleNavigate = useCallback(async (inputUrl: string) => {
    if (!inputUrl.trim()) return;

    let formattedUrl = inputUrl;
    if (!inputUrl.startsWith("http://") && !inputUrl.startsWith("https://")) {
      if (inputUrl.includes(" ")) {
        formattedUrl = `https://www.google.com/search?q=${encodeURIComponent(inputUrl)}`;
      } else {
        formattedUrl = `https://${inputUrl}`;
      }
    }

    setRequestedUrl(formattedUrl);
    setIsLoading(true);
    setProxyFailure(null);
    setReaderContent(null);
    latestSelectionRef.current = null;
    setCurrentUrl(formattedUrl);
    setUrl(formattedUrl);
    setIframeStatus("loading");
    scheduleIframeBlockedFallback();
    pushHistory(formattedUrl);
    setPageTitle(new URL(formattedUrl).hostname);
  }, [pushHistory, scheduleIframeBlockedFallback]);

  // Resolve the proxied URL whenever the user explicitly navigates (Tauri
  // path). `requestedUrl` changes only from handleNavigate / back / forward /
  // refresh / in-page navigate messages, so redirect reconciliation of
  // `currentUrl` never re-triggers this effect.
  useEffect(() => {
    if (!isTauri() || !requestedUrl) return;
    let cancelled = false;
    setIsLoading(true);
    setProxyFailure(null);
    resolveWebProxyUrl(requestedUrl)
      .then((resolved) => {
        if (cancelled) return;
        proxyOriginRef.current = proxyOriginOf(resolved);
        setProxyUrl(resolved);
        setIsLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("[WebBrowserTab] proxy resolution failed:", error);
        setProxyUrl(null);
        proxyOriginRef.current = null;
        setProxyFailure({
          reason: error instanceof Error ? error.message : String(error),
          host: (() => {
            try {
              return new URL(requestedUrl).hostname;
            } catch {
              return requestedUrl;
            }
          })(),
        });
        setIsLoading(false);
        setIframeStatus("idle");
      });
    return () => {
      cancelled = true;
    };
  }, [requestedUrl, refreshToken]);

  const handleBack = useCallback(() => {
    if (historyIndex <= 0) return;
    const newIndex = historyIndex - 1;
    const entry = history[newIndex];
    if (!entry) return;
    setHistoryIndex(newIndex);
    setRequestedUrl(entry);
    setCurrentUrl(entry);
    setUrl(entry);
    setPageTitle((() => { try { return new URL(entry).hostname; } catch { return entry; } })());
    setIsLoading(true);
    setProxyFailure(null);
    latestSelectionRef.current = null;
    setIframeStatus("loading");
    scheduleIframeBlockedFallback();
  }, [history, historyIndex, scheduleIframeBlockedFallback]);

  const handleForward = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    const newIndex = historyIndex + 1;
    const entry = history[newIndex];
    if (!entry) return;
    setHistoryIndex(newIndex);
    setRequestedUrl(entry);
    setCurrentUrl(entry);
    setUrl(entry);
    setPageTitle((() => { try { return new URL(entry).hostname; } catch { return entry; } })());
    setIsLoading(true);
    setProxyFailure(null);
    latestSelectionRef.current = null;
    setIframeStatus("loading");
    scheduleIframeBlockedFallback();
  }, [history, historyIndex, scheduleIframeBlockedFallback]);

  const handleRefresh = useCallback(() => {
    if (currentUrl) {
      setRefreshToken((token) => token + 1);
      setIsLoading(true);
      setIframeStatus("loading");
      scheduleIframeBlockedFallback();
    }
  }, [currentUrl, scheduleIframeBlockedFallback]);

  const handleOpenInBrowser = async () => {
    if (currentUrl) {
      try {
        if (isTauri()) {
          const { openUrl } = await import("@tauri-apps/plugin-opener");
          await openUrl(currentUrl);
        } else {
          window.open(currentUrl, "_blank");
        }
      } catch (error) {
        console.error("Error opening URL:", error);
      }
    }
  };

  const handleIframeLoad = () => {
    setIsLoading(false);
    setIframeStatus((prev) => {
      // On Tauri the proxy injects the bridge into every page it serves, so
      // a usable page always posts a trusted `ready`; the native load event
      // also fires for escaped/off-proxy frames and must not cancel the
      // watchdog.
      const next = prev === "loading" ? (isTauri() ? prev : "loaded") : prev;
      if (process.env.NODE_ENV !== "production") {
        console.log(`[WebBrowserTab] iframe load: status ${prev} -> ${next} (url=${currentUrl})`);
      }
      return next;
    });
  };

  const handleIframeError = () => {
    setIsLoading(false);
    setIframeStatus((prev) => {
      if (process.env.NODE_ENV !== "production") {
        console.log(`[WebBrowserTab] iframe error: status ${prev} -> blocked (url=${currentUrl})`);
      }
      return "blocked";
    });
  };

  const handleLoadReaderView = useCallback(async (targetUrl?: string) => {
    const urlToFetch = targetUrl || currentUrl;
    if (!urlToFetch) return;
    setIsLoadingReader(true);
    try {
      const fetched = await fetchUrlContent(urlToFetch);
      let html = "";
      if (fetched.html) {
        html = fetched.html;
      } else if (fetched.file_path) {
        const bytes = await readDocumentFile(fetched.file_path);
        html = new TextDecoder("utf-8").decode(bytes);
      }
      if (html) {
        const processed = processHtmlContent(html, urlToFetch, fetched.title || pageTitle || urlToFetch, true);
        setReaderContent({ html: processed, title: fetched.title || pageTitle || new URL(urlToFetch).hostname });
        setPageTitle(fetched.title || pageTitle || new URL(urlToFetch).hostname);
      }
    } catch (err) {
      toast.error("Failed to load reader view", err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoadingReader(false);
    }
  }, [currentUrl, pageTitle, toast]);

  const handleAddBookmark = () => {
    if (currentUrl && !bookmarks.includes(currentUrl)) {
      setBookmarks([...bookmarks, currentUrl]);
      toast.success("Bookmark added");
    }
  };

  /**
   * Intercept clicks on links inside Reader View. Without this, an `<a href>`
   * in the re-rendered article navigates the whole app document to the
   * external site — a full-window escape with no way back. Instead:
   * - plain clicks load the linked page straight into Reader View (the site
   *   likely refuses embedding too, so the iframe would just be a black box)
   *   and keep the URL bar + history in sync;
   * - Cmd/Ctrl/middle-click opens a new browser tab.
   */
  const handleReaderLinkClick = (event: React.MouseEvent<HTMLElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || !currentUrl) return;
    if (href.startsWith("#") || /^(javascript|mailto|tel):/i.test(href)) return;

    let target: string;
    try {
      target = new URL(href, currentUrl).toString();
    } catch {
      return;
    }
    // Same guard as the bridge navigate path: only http(s) URLs may enter the
    // URL bar, history, bookmarks, or the extractor.
    if (!isSafeWebUrl(target)) return;

    event.preventDefault();
    event.stopPropagation();

    if (event.metaKey || event.ctrlKey || event.button === 1) {
      openNewBrowserTab(target);
      return;
    }

    // Keep the URL bar, back/forward history and page title consistent with the
    // navigation, then render the linked article in Reader View.
    setRequestedUrl(target);
    setCurrentUrl(target);
    setUrl(target);
    setPageTitle(new URL(target).hostname);
    pushHistory(target);
    void handleLoadReaderView(target);
  };

  // ── Bridge message handling (Tauri proxy path) ───────────────────────────

  /** Open the extract dialog from a bridge selection payload. */
  const openExtractDialogFromSelection = useCallback((selection: WebBridgeSelectionPayload) => {
    setExtractDialog({
      content: selection.text,
      htmlContent: selection.html,
      url: selection.url || currentUrlRef.current,
      pageTitle: selection.title || pageTitleRef.current || (() => {
        try { return new URL(selection.url || currentUrlRef.current).hostname; } catch { return selection.url || currentUrlRef.current; }
      })(),
      timestamp: Date.now(),
    });
  }, []);

  // Push the user's configured extract-text shortcut into the proxied frame so
  // the in-page bridge honors the same key combo as the app itself.
  const pushShortcutToFrame = useCallback(() => {
    const frame = iframeRef.current?.contentWindow;
    const origin = proxyOriginRef.current;
    if (!frame || !origin) return;
    const combo = getShortcutCombo("edit.extract-text");
    if (!combo) return;
    try {
      frame.postMessage(
        {
          ns: WEB_BRIDGE_NS,
          type: "set-shortcut",
          payload: {
            ctrl: combo.ctrl || false,
            alt: combo.alt || false,
            shift: combo.shift || false,
            meta: combo.meta || false,
            key: combo.key,
          },
        },
        origin
      );
    } catch {
      // Frame may be gone; ignore.
    }
  }, []);

  const handleBridgeReady = useCallback((payload: WebBridgeReadyPayload) => {
    // The proxy followed redirects; the final upstream URL is the truth for
    // the URL bar, title, and history. Validate it: the page can post anything
    // from the proxy origin, and a crafted url must never reach the URL bar,
    // history, bookmarks, or "open in system browser".
    if (!isSafeWebUrl(payload.url)) {
      // Malformed/unsafe ready URL — keep the requested URL and ignore.
      setIsLoading(false);
      setIframeStatus("loaded");
      pushShortcutToFrame();
      return;
    }
    setPageTitle(payload.title);
    setUrl(payload.url);
    if (payload.url !== currentUrlRef.current) {
      // Keep the proxy resolution target in sync so refresh / back / forward
      // re-resolve the final URL directly instead of the pre-redirect request.
      setRequestedUrl(payload.url);
      setCurrentUrl(payload.url);
      // Replace the history entry that was the pre-redirect request (it sits
      // at the current history index — `pushHistory` advanced the index to it)
      // with the final URL. Only replace it when it actually matches the
      // requested URL, so a redirect landing on a *back* navigation never
      // clobbers the forward entry.
      const requestedAtLoad = requestedUrlRef.current;
      setHistory((prev) => {
        const idx = historyIndexRef.current;
        if (idx < 0 || idx >= prev.length) return prev;
        if (prev[idx] !== requestedAtLoad) return prev;
        const next = [...prev];
        next[idx] = payload.url;
        return next;
      });
    }
    setIsLoading(false);
    setIframeStatus("loaded");
    pushShortcutToFrame();
  }, [isSafeWebUrl, pushShortcutToFrame]);

  const handleBridgeNavigate = useCallback((payload: WebBridgeNavigatePayload) => {
    if (!isSafeWebUrl(payload.url)) return;
    // Unwrap search-result redirectors (`google.com/url?q=…` & friends) to
    // their target before navigating: the redirector itself renders a
    // cookie-less interstitial in the proxied frame. The unwrapped target
    // passes the same isSafeWebUrl check and the proxy's per-hop validation
    // as any direct navigation — malformed params fall back to the original.
    const targetUrl = unwrapSearchRedirector(payload.url);
    if (!isSafeWebUrl(targetUrl)) return;
    if (payload.newTab) {
      openNewBrowserTab(targetUrl);
      return;
    }
    setRequestedUrl(targetUrl);
    setCurrentUrl(targetUrl);
    setUrl(targetUrl);
    setPageTitle(new URL(targetUrl).hostname);
    setIsLoading(true);
    setProxyFailure(null);
    setReaderContent(null);
    latestSelectionRef.current = null;
    // Tauri watchdog: if the frame never posts a trusted bridge `ready`
    // (off-proxy navigation, dead interstitial), surface the blocked state
    // instead of a silent blank frame.
    setIframeStatus("loading");
    scheduleIframeBlockedFallback();
    pushHistory(targetUrl);
  }, [openNewBrowserTab, pushHistory, isSafeWebUrl, scheduleIframeBlockedFallback]);

  const handleBridgeProxyError = useCallback((payload: { reason: string; host: string }) => {
    setProxyFailure({ reason: payload.reason, host: payload.host });
    setIsLoading(false);
    setIframeStatus("idle");
  }, []);

  // Bridge message listener: validate source (must be the proxied iframe),
  // origin (must be the proxy origin), and payload shape before acting (D4,
  // task 3.3).
  useEffect(() => {
    if (!isTauri()) return;
    const handler = (event: MessageEvent) => {
      const frame = iframeRef.current?.contentWindow ?? null;
      const origin = proxyOriginRef.current;
      if (!isTrustedBridgeEvent(event, frame, origin)) return;
      const msg = parseWebBridgeMessage(event.data);
      if (!msg) return;

      switch (msg.type) {
        case "ready":
          handleBridgeReady(msg.payload);
          break;
        case "selection":
          latestSelectionRef.current = msg.payload.text ? msg.payload : null;
          break;
        case "navigate":
          handleBridgeNavigate(msg.payload);
          break;
        case "extract":
          latestSelectionRef.current = msg.payload.text ? msg.payload : null;
          if (msg.payload.text) openExtractDialogFromSelection(msg.payload);
          break;
        case "proxy-error":
          handleBridgeProxyError(msg.payload);
          break;
        case "text-response":
          // Handled by requestFrameText's own listener.
          break;
        default:
          break;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [handleBridgeNavigate, handleBridgeProxyError, handleBridgeReady, openExtractDialogFromSelection]);

  // Re-push the shortcut when the user changes it in settings.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    import("../common/KeyboardShortcuts").then(({ useShortcutStore }) => {
      unsub = useShortcutStore.subscribe(pushShortcutToFrame);
    });
    return () => unsub?.();
  }, [pushShortcutToFrame]);

  // Navigate on mount / when a new tab targets a new URL. handleNavigate's
  // identity changes with every history push (pushHistory depends on
  // historyIndex), so listing it as a dependency re-triggered the navigation
  // — an unbounded render loop whenever initialUrl was set. Read it through
  // a ref so the effect fires once per initialUrl value.
  const handleNavigateRef = useRef(handleNavigate);
  handleNavigateRef.current = handleNavigate;
  useEffect(() => {
    if (initialUrl) {
      void handleNavigateRef.current(initialUrl);
    }
  }, [initialUrl]);

  useEffect(() => {
    const saved = localStorage.getItem("web-browser-bookmarks");
    if (saved) setBookmarks(JSON.parse(saved));

    const savedExtractsData = localStorage.getItem("web-browser-extracts");
    if (savedExtractsData) setSavedExtracts(JSON.parse(savedExtractsData));
  }, []);

  // Persist bookmarks and extracts
  useEffect(() => {
    localStorage.setItem("web-browser-bookmarks", JSON.stringify(bookmarks));
  }, [bookmarks]);

  useEffect(() => {
    localStorage.setItem("web-browser-extracts", JSON.stringify(savedExtracts));
  }, [savedExtracts]);

  // "Create Extract" — uses the latest bridge selection on the Tauri path
  // (task 4.1). No webview polling, no clipboard branch.
  const handleCreateExtract = useCallback(() => {
    const selection = latestSelectionRef.current;

    if (selection?.text) {
      openExtractDialogFromSelection(selection);
      return;
    }

    // No selection: inform the user and open the manual dialog. Never save an
    // empty extract (spec: "No selection" scenario).
    toast.info(t("browser.selectionUnavailable"), t("browser.selectionUnavailableDesc"));
    setExtractDialog({
      content: "",
      htmlContent: undefined,
      url: currentUrlRef.current,
      pageTitle: pageTitleRef.current || (() => {
        try { return new URL(currentUrlRef.current).hostname; } catch { return currentUrlRef.current; }
      })(),
      timestamp: Date.now(),
    });
  }, [openExtractDialogFromSelection, t, toast]);

  const handleSaveExtract = async (data: { content: string; htmlContent?: string; note: string; tags: string[] }) => {
    // Never create an empty extract — the dialog already guards this, but the
    // save path is the final backstop.
    if (!data.content.trim()) {
      toast.error(t("extracts.enterContent"));
      return;
    }
    try {
      // The extract's source is the upstream page (from the bridge selection
      // payload), not the loopback proxy URL (task 4.2).
      const sourceUrl = extractDialog?.url || currentUrl;
      const sourceTitle = extractDialog?.pageTitle || pageTitle || new URL(currentUrl).hostname;
      let documentId: string;

      try {
        const doc = await createDocument(sourceTitle, sourceUrl, "web");
        documentId = doc.id;
      } catch (error) {
        console.warn("Failed to create document, using temp ID:", error);
        documentId = `web-${Date.now()}`;
      }

      const extractInput: CreateExtractInput = {
        document_id: documentId,
        content: data.content,
        html_content: data.htmlContent,
        source_url: sourceUrl,
        note: data.note,
        tags: data.tags,
        category: sourceTitle,
        color: "yellow",
      };

      const createdExtract = await createExtract(extractInput);

      // Add to saved extracts with the real ID
      const newExtract: WebExtract = {
        id: createdExtract.id,
        content: data.content,
        htmlContent: data.htmlContent,
        url: sourceUrl,
        pageTitle: sourceTitle,
        timestamp: Date.now(),
        note: data.note,
        tags: data.tags,
      };

      setSavedExtracts((prev) => [newExtract, ...prev]);

      toast.success(
        "Extract created successfully",
        `Extract saved with ${data.content.length} characters`,
        { duration: 5000 }
      );

      setExtractDialog(null);
      latestSelectionRef.current = null;
    } catch (error) {
      console.error("Error saving extract:", error);
      toast.error("Failed to create extract", error instanceof Error ? error.message : "Please try again");
    }
  };

  const handleDeleteExtract = (index: number) => {
    setSavedExtracts((prev) => prev.filter((_, i) => i !== index));
    toast.success("Extract removed");
  };

  // View extract details
  const handleViewExtract = (extract: WebExtract) => {
    setExtractDialog(extract);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        handleCreateExtract();
      }
    };

    const handleExtractTextEvent = () => {
      handleCreateExtract();
    };

    window.addEventListener('extract-text', handleExtractTextEvent);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('extract-text', handleExtractTextEvent);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleCreateExtract]);

  return (
    <div className="h-full w-full flex flex-col min-h-0">
      {/* Browser Toolbar */}
      <div className="p-2 border-b border-border space-y-2 flex-shrink-0 bg-card">
        {/* Navigation Row */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleBack}
            disabled={historyIndex <= 0}
            className="p-2 rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Back"
          >
            <CaretLeft className="w-4 h-4" />
          </button>
          <button
            onClick={handleForward}
            disabled={historyIndex >= history.length - 1}
            className="p-2 rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Forward"
          >
            <CaretRight className="w-4 h-4" />
          </button>
          <button
            onClick={handleRefresh}
            disabled={!currentUrl}
            className="p-2 rounded-lg hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            title="Refresh"
          >
            <ArrowClockwise className="w-4 h-4" />
          </button>

          {/* URL Input */}
          <div className="flex-1 flex gap-2">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyPress={(e) => e.key === "Enter" && handleNavigate(url)}
              placeholder="Enter URL or search..."
              className="flex-1 px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary text-foreground text-sm"
            />
            <button
              onClick={() => handleNavigate(url)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors text-sm font-medium"
            >
              Go
            </button>
          </div>

          {/* Action Buttons */}
          <button
            onClick={handleAddBookmark}
            disabled={!currentUrl || bookmarks.includes(currentUrl)}
            className="p-2 rounded-lg hover:bg-muted disabled:opacity-50 transition-colors"
            title="Add bookmark"
          >
            <BookmarkSimple className="w-4 h-4" />
          </button>
          <button
            onClick={() => readerContent ? setReaderContent(null) : handleLoadReaderView()}
            disabled={!currentUrl || isLoadingReader}
            className={`p-2 rounded-lg transition-colors ${readerContent ? "bg-primary text-primary-foreground" : "hover:bg-muted"} disabled:opacity-50`}
            title={readerContent ? "Close reader view" : "Reader view"}
          >
            <BookOpen className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowSidebar(!showSidebar)}
            className={`p-2 rounded-lg transition-colors ${showSidebar ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            title="Toggle sidebar"
          >
            <FolderOpen className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowAssistant(!showAssistant)}
            className={`p-2 rounded-lg transition-colors ${showAssistant ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            title="Toggle assistant"
          >
            <ChatCircle className="w-4 h-4" />
          </button>
          <button
            onClick={handleOpenInBrowser}
            disabled={!currentUrl}
            className="p-2 rounded-lg hover:bg-muted disabled:opacity-50 transition-colors"
            title="Open in system browser"
          >
            <ArrowSquareOut className="w-4 h-4" />
          </button>
        </div>

        {/* Extract Actions Row */}
        {currentUrl && (
          <div className="flex items-center gap-3 pl-1">
            <button
              onClick={handleCreateExtract}
              className="px-3 py-1.5 bg-secondary hover:bg-secondary/90 text-secondary-foreground rounded-lg transition-colors text-sm flex items-center gap-2 font-medium"
              title="Create extract from selected text (Ctrl/Cmd + Shift + E)"
            >
              <Highlighter className="w-4 h-4" />
              {t("extracts.createTitle")}
            </button>
            <span className="text-xs text-muted-foreground">
              {t("viewer.selectTextHint")}
              <kbd className="ml-1 px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Ctrl+Shift+E</kbd>
            </span>
            {savedExtracts.length > 0 && (
              <span className="ml-auto text-xs text-primary bg-primary/10 px-2 py-1 rounded-full flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                {t("extracts.extractSaved", { count: savedExtracts.length })}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Sidebar - Bookmarks & Extracts */}
        {showSidebar && (
          <div className="w-80 border-r border-border bg-card overflow-y-auto flex-shrink-0">
            {/* Extracts Section */}
            <div className="p-4 border-b border-border">
              <div
                className="flex items-center justify-between mb-3 cursor-pointer"
                onClick={() => setExtractsExpanded(!extractsExpanded)}
              >
                <h3 className="font-semibold text-foreground flex items-center gap-2">
                  <Highlighter className="w-4 h-4 text-primary" />
                  {t("extracts.recentExtracts")}
                  <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {savedExtracts.length}
                  </span>
                </h3>
                <span className="text-muted-foreground text-xs">
                  {extractsExpanded ? '▼' : '▶'}
                </span>
              </div>

              {extractsExpanded && (
                <>
                  {savedExtracts.length === 0 ? (
                    <div className="text-center py-6 bg-muted/30 rounded-lg">
                      <Highlighter className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                      <p className="text-sm text-muted-foreground">{t("extracts.noExtractsYet")}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("extracts.selectAndCreate")}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {savedExtracts.map((extract, index) => (
                        <div
                          key={index}
                          className="p-3 bg-muted/50 hover:bg-muted rounded-lg border border-border group transition-all"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-foreground line-clamp-3 mb-2">
                                {extract.content}
                              </p>
                              {extract.note && (
                                <p className="text-xs text-muted-foreground line-clamp-2 mb-2 bg-background/50 p-1.5 rounded">
                                  {extract.note}
                                </p>
                              )}
                              {extract.tags && extract.tags.length > 0 && (
                                <CompactTagEditor
                                  target={{ type: "extract", id: extract.id, tags: extract.tags }}
                                  previewLimit={3}
                                  className="mb-2"
                                />
                              )}
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Clock className="w-3 h-3" />
                                {formatRelativeTime(new Date(extract.timestamp))}
                              </div>
                            </div>
                            <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button
                                onClick={() => handleViewExtract(extract)}
                                className="p-1.5 hover:bg-background rounded transition-colors"
                                title="View extract"
                              >
                                <Eye className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteExtract(index)}
                                className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded transition-colors"
                                title="Delete extract"
                              >
                                <Trash className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Bookmarks Section */}
            <div className="p-4">
              <h3 className="font-semibold text-foreground mb-3 flex items-center gap-2">
                <BookmarkSimple className="w-4 h-4 text-primary" />
                {t("viewer.bookmarks")}
              </h3>
              {bookmarks.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("viewer.noBookmarksYet")}</p>
              ) : (
                <div className="space-y-2">
                  {bookmarks.map((bookmark, index) => (
                    <button
                      key={index}
                      onClick={() => handleNavigate(bookmark)}
                      className="block w-full text-left px-3 py-2 bg-muted hover:bg-muted/80 rounded-lg text-sm text-foreground truncate transition-colors"
                    >
                      {bookmark}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Browser Content */}
        <div className="flex-1 relative overflow-hidden" style={{ minHeight: '200px' }}>
          {!currentUrl ? (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/20">
              <div className="text-center max-w-md p-8">
                <div className="text-6xl mb-4">🌐</div>
                <h2 className="text-2xl font-bold text-foreground mb-2">
                  Web Browser
                </h2>
                <p className="text-muted-foreground mb-6">
                  Enter a URL above to browse the web and create extracts from any content.
                </p>
                <div className="bg-card border border-border rounded-lg p-4 text-left">
                  <p className="font-medium text-foreground mb-3">How to create extracts:</p>
                  <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                    <li>Navigate to any website</li>
                    <li>Select text you want to save</li>
                    <li>Click "Create Extract" or press <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Ctrl+Shift+E</kbd></li>
                    <li>Add notes and tags, then save</li>
                  </ol>
                </div>
              </div>
            </div>
          ) : (
            <>
              {isLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/50 z-50">
                  <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  </div>
                </div>
              )}
              {proxyFailure && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/95 z-50">
                  <div className="text-center max-w-md px-4 space-y-3">
                    <p className="text-sm text-destructive font-semibold">
                      {t("browser.proxyFailureTitle")}
                    </p>
                    <p className="text-xs text-muted-foreground break-all">
                      {t("browser.proxyFailureReason", { host: proxyFailure.host, reason: proxyFailure.reason })}
                    </p>
                    <div className="flex items-center justify-center gap-3">
                      <button
                        onClick={handleRefresh}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity text-sm"
                      >
                        <ArrowClockwise className="w-4 h-4" />
                        {t("browser.retry")}
                      </button>
                      <button
                        onClick={() => handleLoadReaderView()}
                        disabled={isLoadingReader}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 transition-opacity text-sm disabled:opacity-50"
                      >
                        <BookOpen className="w-4 h-4" />
                        {isLoadingReader ? t("browser.loading") : t("browser.readerView")}
                      </button>
                      <button
                        onClick={handleOpenInBrowser}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 transition-opacity text-sm"
                      >
                        <ArrowSquareOut className="w-4 h-4" />
                        {t("browser.openInSystemBrowser")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {iframeStatus === "blocked" && !readerContent && (
                <div className="absolute inset-0 flex items-center justify-center bg-background/95 z-50">
                  <div className="text-center max-w-md px-4 space-y-3">
                    <p className="text-sm text-foreground font-semibold">
                      {t("browser.embedBlockedTitle")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("browser.embedBlockedReason", { site: (() => { try { return new URL(currentUrl).hostname; } catch { return currentUrl; } })() })}
                    </p>
                    <div className="flex items-center justify-center gap-3">
                      <button
                        onClick={() => handleLoadReaderView()}
                        disabled={isLoadingReader}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 transition-opacity text-sm disabled:opacity-50"
                      >
                        <BookOpen className="w-4 h-4" />
                        {isLoadingReader ? t("browser.loading") : t("browser.readerView")}
                      </button>
                      <button
                        onClick={handleOpenInBrowser}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:opacity-90 transition-opacity text-sm"
                      >
                        <ArrowSquareOut className="w-4 h-4" />
                        {t("browser.openInSystemBrowser")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {readerContent && (
                <div className="absolute inset-0 overflow-y-auto bg-background z-40">
                  <div className="w-full px-8 py-8">
                    <div className="flex items-center justify-between mb-6">
                      <h1 className="text-xl font-bold text-foreground">{readerContent.title}</h1>
                      <button
                        onClick={() => setReaderContent(null)}
                        className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
                        title="Close reader view"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="text-xs text-muted-foreground mb-4 flex items-center gap-1">
                      <ArrowSquareOut className="w-3 h-3" />
                      <a href={currentUrl} target="_blank" rel="noopener noreferrer" className="hover:underline truncate">{currentUrl}</a>
                    </div>
                    <article
                      onClick={handleReaderLinkClick}
                      className="prose prose-sm dark:prose-invert max-w-none [&_a]:cursor-pointer [&_a]:text-blue-600 dark:[&_a]:text-blue-400 [&_a]:underline"
                      dangerouslySetInnerHTML={{ __html: readerContent.html }}
                    />
                  </div>
                </div>
              )}
              <div className="absolute inset-0 w-full h-full">
                {isTauri() ? (
                  proxyUrl && (
                    <iframe
                      key={`${proxyUrl}-${refreshToken}`}
                      ref={iframeRef}
                      src={proxyUrl}
                      className="w-full h-full border-0"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                      title="Web Browser"
                      onLoad={handleIframeLoad}
                      onError={handleIframeError}
                    />
                  )
                ) : (
                  currentUrl && (
                    <iframe
                      key={`${currentUrl}-${refreshToken}`}
                      ref={iframeRef}
                      src={currentUrl}
                      className="w-full h-full border-0"
                      sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                      title="Web Browser"
                      onLoad={handleIframeLoad}
                      onError={handleIframeError}
                    />
                  )
                )}
              </div>
            </>
          )}
        </div>

        {/* Assistant Panel */}
        {showAssistant && (
          <AssistantPanel
            context={assistantContext}
            className="flex-shrink-0 border-l-4 border-primary w-96"
          />
        )}
      </div>

      {/* Extract Dialog — rendered via portal to document.body so it always
          appears above iframes (which create their own stacking context). */}
      {extractDialog && createPortal(
        <ExtractDialog
          extract={extractDialog}
          onSave={handleSaveExtract}
          onClose={() => setExtractDialog(null)}
        />,
        document.body
      )}
    </div>
  );
}
