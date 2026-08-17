import { isTauri } from "./tauri";

import { createExtract, type CreateExtractInput } from '../api/extracts';
import * as db from './database';

/**
 * App<->extension postMessage protocol tokens (rebrand task 3.6).
 *
 * COMPAT WINDOW: the app ACCEPTS requests sourced with either the new
 * `plethora-extension` token or the legacy `incrementum-extension` token,
 * deduplicating by `requestId` (the paired extension release sends each
 * request under BOTH tokens so it works against old and new apps). Every
 * response/announcement is emitted TWICE, once per source token: the
 * extension's response map deletes the handler on first delivery, so the
 * duplicate is a no-op, while an OLD extension (which only recognizes the
 * legacy token) still receives its response.
 */
const EXTENSION_SOURCE_TOKENS = ['plethora-extension', 'incrementum-extension'] as const;
const PWA_SOURCE_TOKENS = ['plethora-pwa', 'incrementum-pwa'] as const;

/**
 * Request ids already handled during this session (dual-send dedupe).
 * Capped at MAX_HANDLED_REQUEST_IDS to prevent unbounded growth in long sessions.
 */
const handledRequestIds = new Set<string>();
const MAX_HANDLED_REQUEST_IDS = 1000;

// Message types from the browser extension
interface ExtensionMessage {
  source: (typeof EXTENSION_SOURCE_TOKENS)[number];
  action: 'saveExtract' | 'savePage' | 'ping' | 'getStatus';
  data?: {
    url: string;
    title: string;
    text: string;
    html_content?: string;
    context?: string;
    tags?: string[];
    priority?: number;
  };
  requestId?: string;
}

interface BridgeResponse {
  source: (typeof PWA_SOURCE_TOKENS)[number];
  action: string;
  success: boolean;
  error?: string;
  requestId?: string;
  data?: unknown;
}

// Track if bridge is initialized
let bridgeInitialized = false;

/**
 * Send a response back to the extension — once per source token (see the
 * compat-window note above).
 */
function sendResponse(response: Omit<BridgeResponse, 'source'>): void {
  for (const source of PWA_SOURCE_TOKENS) {
    window.postMessage({ ...response, source }, '*');
  }
}

/**
 * Handle incoming messages from the extension
 */
async function handleExtensionMessage(event: MessageEvent): Promise<void> {
  // Only handle messages from the same window (extension content script)
  if (event.source !== window) return;

  // Verify message is from our extension (either token during the compat
  // window) and drop the duplicate of an already-handled dual send.
  const message = event.data as ExtensionMessage;
  if (!message || !EXTENSION_SOURCE_TOKENS.includes(message.source)) return;
  if (message.requestId) {
    if (handledRequestIds.has(message.requestId)) return;
    // Cap the dedupe set: when it exceeds 1000 entries, clear it.
    // Oldest-entry eviction is not worth the complexity; a malicious page spamming
    // >1000 unique ids between two halves of one dual-send is not a realistic
    // compat-window threat.
    if (handledRequestIds.size >= MAX_HANDLED_REQUEST_IDS) {
      handledRequestIds.clear();
    }
    handledRequestIds.add(message.requestId);
  }

  try {
    switch (message.action) {
      case 'ping': {
        // Extension is checking if PWA is available
        sendResponse({
          action: 'pong',
          success: true,
          requestId: message.requestId,
          data: { version: '1.0.0', mode: 'pwa' }
        });
        break;
      }

      case 'getStatus': {
        sendResponse({
          action: 'status',
          success: true,
          requestId: message.requestId,
          data: { connected: true, mode: 'pwa' }
        });
        break;
      }

      case 'saveExtract': {
        if (!message.data) {
          sendResponse({
            action: 'saveExtract',
            success: false,
            error: 'No data provided',
            requestId: message.requestId
          });
          return;
        }

        const { url, title, text, html_content, context, tags } = message.data;

        let docId = `web-${Date.now()}`;

        // Try to find existing document by URL
        const existingDocs = await db.getDocuments();
        const existingDoc = existingDocs.find(d => d.file_path === url);
        if (existingDoc) {
          docId = existingDoc.id;
        } else {
          await db.createDocument({
            id: docId,
            title: title || 'Untitled',
            file_path: url,
            file_type: 'html',
            tags: tags || [],
            metadata: {
              source: 'browser_extension',
              fetchedAt: new Date().toISOString(),
              siteName: new URL(url).hostname,
              browserImportMode: 'text-editor',
            },
          });
        }

        const extractInput: CreateExtractInput = {
          document_id: docId,
          content: text,
          html_content: html_content,
          source_url: url,
          note: context,
          tags: tags,
          color: 'yellow',
        };

        const extract = await createExtract(extractInput);

        sendResponse({
          action: 'saveExtract',
          success: true,
          requestId: message.requestId,
          data: { extractId: extract.id }
        });

        // Show notification to user
        showNotification('Extract saved', `Saved from ${new URL(url).hostname}`);
        break;
      }

      case 'savePage': {
        if (!message.data) {
          sendResponse({
            action: 'savePage',
            success: false,
            error: 'No data provided',
            requestId: message.requestId
          });
          return;
        }

        const { url, title, text, html_content: _html_content, tags } = message.data;

        const doc = await db.createDocument({
          title: title || 'Untitled',
          file_path: url,
          file_type: 'html',
          content: text,
          tags: tags || [],
          metadata: {
            source: 'browser_extension',
            fetchedAt: new Date().toISOString(),
            siteName: new URL(url).hostname,
            browserImportMode: 'text-editor',
          },
        });

        sendResponse({
          action: 'savePage',
          success: true,
          requestId: message.requestId,
          data: { documentId: doc.id }
        });

        showNotification('Page saved', title || 'Untitled');
        break;
      }

      default:
        sendResponse({
          action: message.action,
          success: false,
          error: `Unknown action: ${message.action}`,
          requestId: message.requestId
        });
    }
  } catch (error) {
    console.error('[PWA Bridge] Error handling message:', error);
    sendResponse({
      action: message.action,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      requestId: message.requestId
    });
  }
}

/**
 * Show a notification to the user
 */
function showNotification(title: string, message: string): void {
  // Try native notification first
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body: message, icon: '/icon-192.png' });
  } else {
    // Fallback to custom toast notification
    const toast = document.createElement('div');
    toast.className = 'plethora-toast';
    toast.innerHTML = `
      <div style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 16px 24px;
        border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.2);
        z-index: 100000;
        opacity: 0;
        transform: translateY(20px);
        transition: all 0.3s ease;
      ">
        <div style="font-weight: 600; margin-bottom: 4px;">${title}</div>
        <div style="opacity: 0.9;">${message}</div>
      </div>
    `;
    document.body.appendChild(toast);

    // Animate in
    const toastEl = toast.firstElementChild as HTMLElement;
    requestAnimationFrame(() => {
      toastEl.style.opacity = '1';
      toastEl.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      toastEl.style.opacity = '0';
      toastEl.style.transform = 'translateY(20px)';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

/**
 * Initialize the browser extension bridge
 * Call this when the app starts in PWA mode
 */
export function initExtensionBridge(): void {
  if (bridgeInitialized) return;

  // Listen for messages from the extension content script
  window.addEventListener('message', handleExtensionMessage);

  // Announce that the PWA is ready to receive messages — once per token so
  // both current and pre-rebrand extension versions pick it up.
  for (const source of PWA_SOURCE_TOKENS) {
    window.postMessage({
      source,
      action: 'ready',
      success: true
    }, '*');
  }

  bridgeInitialized = true;
}

/**
 * Check if we're running in PWA mode (not Tauri desktop)
 */
export function isPWAMode(): boolean {
  return !isTauri();
}

/**
 * Cleanup the bridge (call on unmount)
 */
export function cleanupExtensionBridge(): void {
  if (!bridgeInitialized) return;
  window.removeEventListener('message', handleExtensionMessage);
  bridgeInitialized = false;
}
