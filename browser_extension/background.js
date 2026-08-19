/* globals chrome */
// Background service worker for Incrementum Browser Sync
// Handles tab monitoring, bookmark syncing, and communication with Incrementum

if (typeof importScripts === 'function') {
  importScripts('shared.js');
}

let PLETHORA_BASE_URL = 'http://127.0.0.1:8766';
let ENABLE_CONTEXT_MENU = true;
let ENABLE_NOTIFICATIONS = true;
let AUTO_SAVE = false;
let SAVE_BOOKMARKS = true;
let SAVE_HISTORY = true;
let ENABLE_AUTO_SYNC = false;
let SYNC_FREQUENCY = 'manual';
let FLASHCARD_TYPES = ['qa', 'cloze'];
let FLASHCARD_COUNT = 5;
let keepAliveCount = 0;
const PENDING_EXTRACTS_KEY = 'pendingExtracts';
// Registrations of successfully created extracts that the background still
// owes to a tab's content script (context-menu / quick-extract flow). Kept in
// chrome.storage.local so a service-worker restart between the server create
// and the content-script registration cannot lose or double the increment.
const PENDING_EXTRACT_REGISTRATIONS_KEY = 'pendingExtractRegistrations';
let flushInProgress = false;

// Serializes read-modify-write on the pending-extract-registrations list.
// Every operation that reads then writes the list runs under this mutex, so a
// create persisting mid-flush (keepAlive fires every 20s and can overlap a
// context-menu create) can never be clobbered by the flush's stale snapshot,
// and two concurrent creates for different tabs cannot drop one another.
const PendingExtractRegistrationsMutex = (
  globalThis.IncrementumExtensionShared?.createMutex
) ? globalThis.IncrementumExtensionShared.createMutex() : null;

async function withPendingExtractRegistrationsLock(operation) {
  if (!PendingExtractRegistrationsMutex) {
    return operation();
  }
  return PendingExtractRegistrationsMutex(operation);
}

function isRuntimeAvailable() {
  return Boolean(globalThis.chrome?.runtime?.id);
}

function isExtensionContextInvalidatedError(error) {
  const message = error?.message || '';
  return message.includes('Extension context invalidated');
}

async function safeSendTabMessage(tabId, message) {
  if (!isRuntimeAvailable() || !tabId) {
    return null;
  }

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) {
      console.warn('[DEBUG] Extension context invalidated while sending tab message');
      return null;
    }
    throw error;
  }
}

async function resolveExtractToastTabId(sender, extract) {
  if (sender?.tab?.id) {
    return sender.tab.id;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && (!extract?.url || tab.url === extract.url)) {
      return tab.id;
    }
  } catch (error) {
    console.error('[DEBUG] Could not resolve toast tab id:', error.message);
  }

  return null;
}

function browserSyncEndpoint() {
  // Always hit the root path; QHttpServer is routed on "/"
  return new URL('/', PLETHORA_BASE_URL).toString();
}

async function getPendingExtracts() {
  const stored = await chrome.storage.local.get(PENDING_EXTRACTS_KEY);
  return Array.isArray(stored[PENDING_EXTRACTS_KEY]) ? stored[PENDING_EXTRACTS_KEY] : [];
}

async function setPendingExtracts(items) {
  await chrome.storage.local.set({ [PENDING_EXTRACTS_KEY]: items });
}

async function getPendingExtractRegistrations() {
  const stored = await chrome.storage.local.get(PENDING_EXTRACT_REGISTRATIONS_KEY);
  return Array.isArray(stored[PENDING_EXTRACT_REGISTRATIONS_KEY])
    ? stored[PENDING_EXTRACT_REGISTRATIONS_KEY]
    : [];
}

async function setPendingExtractRegistrations(items) {
  await chrome.storage.local.set({ [PENDING_EXTRACT_REGISTRATIONS_KEY]: items });
}

function createQueuedExtractPayload(data) {
  return {
    ...data,
    source: data.source || 'browser_extension',
    queuedAt: new Date().toISOString(),
    queueId: data.queueId || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  };
}

async function queueExtractForSync(data) {
  const queuedPayload = createQueuedExtractPayload(data);
  const pending = await getPendingExtracts();
  pending.push(queuedPayload);
  await setPendingExtracts(pending);
  return queuedPayload;
}

function isRetryableConnectionError(result) {
  if (!result || result.success) {
    return false;
  }

  if (result.retryable === true) {
    return true;
  }

  const message = (result.error || '').toLowerCase();
  return (
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network error') ||
    message.includes('connection refused') ||
    message.includes('econnrefused') ||
    message.includes('err_connection_refused') ||
    message.includes('timeout') ||
    message.includes('fetch failed')
  );
}

async function flushQueuedExtracts() {
  if (flushInProgress) {
    return { success: true, flushed: 0, remaining: (await getPendingExtracts()).length, skipped: true };
  }

  flushInProgress = true;
  try {
    const pending = await getPendingExtracts();
    if (pending.length === 0) {
      return { success: true, flushed: 0, remaining: 0 };
    }

    const remaining = [];
    let flushed = 0;

    for (const item of pending) {
      const result = await sendToIncrementum(item, { allowFlush: false });
      if (result.success) {
        flushed += 1;
      } else {
        remaining.push(item);
        if (isRetryableConnectionError(result)) {
          break;
        }
      }
    }

    const firstRemainingIndex = flushed + remaining.length < pending.length
      ? flushed + remaining.length
      : pending.length;
    if (firstRemainingIndex < pending.length) {
      remaining.push(...pending.slice(firstRemainingIndex));
    }

    await setPendingExtracts(remaining);
    return { success: true, flushed, remaining: remaining.length };
  } finally {
    flushInProgress = false;
  }
}

async function flushQueuedExtractsIfPossible() {
  const pending = await getPendingExtracts();
  if (pending.length === 0) {
    return { success: true, flushed: 0, remaining: 0 };
  }

  const status = await getStatus({ flushQueue: false });
  if (!status.connected) {
    return { success: false, flushed: 0, remaining: pending.length, error: status.error };
  }

  return flushQueuedExtracts();
}

async function loadSettings() {
  try {
    const settings = await chrome.storage.sync.get([
      'serverUrl',
      'browserSyncPort',
      'enableContextMenu',
      'enableNotifications',
      'autoSave',
      'saveBookmarks',
      'saveHistory',
      'enableAutoSync',
      'syncFrequency',
      'flashcardTypes',
      'flashcardCount'
    ]);

    let serverUrl = settings.serverUrl || '127.0.0.1';
    let port = settings.browserSyncPort || 8766;

    serverUrl = serverUrl.replace(/:\d+$/, '');

    // Ensure serverUrl has protocol
    if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
      serverUrl = `http://${serverUrl}`;
    }

    // Construct final URL with port
    const url = new URL(serverUrl);
    url.port = port.toString();
    // Use origin to avoid accidental double-slashes when appending "/"
    PLETHORA_BASE_URL = url.origin;

    ENABLE_CONTEXT_MENU = settings.enableContextMenu !== false;
    ENABLE_NOTIFICATIONS = settings.enableNotifications !== false;
    AUTO_SAVE = settings.autoSave === true;
    // History/bookmarks sync default OFF — they fire on every page visit /
    // bookmark creation and would otherwise silently flood the user's
    // library with one document per browsed page. Users who want this must
    // opt in from the options page.
    SAVE_BOOKMARKS = settings.saveBookmarks === true;
    SAVE_HISTORY = settings.saveHistory === true;
    ENABLE_AUTO_SYNC = settings.enableAutoSync === true;
    SYNC_FREQUENCY = settings.syncFrequency || 'manual';
    const configuredFlashcardTypes = Array.isArray(settings.flashcardTypes)
      ? settings.flashcardTypes.filter((type) => type === 'qa' || type === 'cloze')
      : [];
    FLASHCARD_TYPES = configuredFlashcardTypes.length > 0
      ? configuredFlashcardTypes
      : ['qa', 'cloze'];
    FLASHCARD_COUNT = Math.max(1, Math.min(20, Number(settings.flashcardCount) || 5));

    setupAutoSyncAlarm();
  } catch (error) {
    console.error('[DEBUG] Error loading settings:', error);
    PLETHORA_BASE_URL = 'http://127.0.0.1:8766'; // Fallback
    ENABLE_CONTEXT_MENU = true;
    ENABLE_NOTIFICATIONS = true;
    AUTO_SAVE = false;
    SAVE_BOOKMARKS = false;
    SAVE_HISTORY = false;
    ENABLE_AUTO_SYNC = false;
    SYNC_FREQUENCY = 'manual';
    FLASHCARD_TYPES = ['qa', 'cloze'];
    FLASHCARD_COUNT = 5;
  }
}

chrome.runtime.onInstalled.addListener(async () => {

  await loadSettings();

  refreshContextMenus();
  await flushQueuedExtractsIfPossible();
  await flushPendingExtractRegistrations();
});

// Service worker startup event
chrome.runtime.onStartup.addListener(async () => {
  await loadSettings();
  refreshContextMenus();
  await flushQueuedExtractsIfPossible();
  await flushPendingExtractRegistrations();
});

chrome.runtime.onSuspend.addListener(() => {
  keepAliveCount = 0;
});

// Keep service worker active when needed
chrome.action.onClicked.addListener((_tab) => {
  // Intentionally empty: placeholder for future popup toggle behavior
});

function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'save-page',
      title: '💾 Save to Plethora',
      contexts: ['page']
    });

    chrome.contextMenus.create({
      id: 'save-link',
      title: '🔗 Save Link to Plethora',
      contexts: ['link']
    });

    chrome.contextMenus.create({
      id: 'create-extract',
      title: '📝 Create Extract',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'ai-selection',
      title: '✨ Plethora AI',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'ai-summarize-selection',
      parentId: 'ai-selection',
      title: 'Summarize selection',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'ai-flashcards-selection',
      parentId: 'ai-selection',
      title: 'Generate and save flashcards',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      id: 'ai-image-occlusion',
      title: '🖼️ Create image occlusion card',
      contexts: ['image']
    });
  });
}

function refreshContextMenus() {
  if (!chrome?.contextMenus) {
    return;
  }
  if (ENABLE_CONTEXT_MENU) {
    createContextMenus();
  } else {
    chrome.contextMenus.removeAll();
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  switch (info.menuItemId) {
    case 'save-page':
      await saveCurrentTab();
      break;

    case 'save-link':
      if (info.linkUrl) {
        await saveLink(info.linkUrl, tab?.id, info.linkText);
      }
      break;

    case 'create-extract':
      if (info.selectionText) {
        await createExtractFromSelection(info.selectionText, tab);
      }
      break;

    case 'ai-summarize-selection':
      await processSelectionWithAI('summarize', info.selectionText, tab);
      break;

    case 'ai-flashcards-selection':
      await processSelectionWithAI('flashcards', info.selectionText, tab);
      break;

    case 'ai-image-occlusion':
      await openImageOcclusionEditor(info.srcUrl, tab);
      break;
  }
});

async function openImageOcclusionEditor(imageUrl, tab) {
  if (!imageUrl || !tab?.id) {
    showAINativeNotification('flashcards', false, 'Could not identify the selected image.');
    return;
  }
  const displayed = await sendAIStateToTab(tab.id, {
    action: 'showImageOcclusionEditor',
    imageUrl,
    pageUrl: tab.url,
    pageTitle: tab.title
  });
  if (!displayed) {
    showAINativeNotification(
      'flashcards',
      false,
      'This page does not allow the image-occlusion editor to open.'
    );
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

async function createImageOcclusionCard(data, senderTabId) {
  await loadSettings();
  try {
    const shared = globalThis.IncrementumExtensionShared;
    const imageResponse = await fetch(data.imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Could not download image (${imageResponse.status})`);
    }
    const blob = await imageResponse.blob();
    if (blob.type && !blob.type.startsWith('image/')) {
      throw new Error('The selected resource is not a supported image.');
    }
    if (blob.size > shared.TRANSPORT_LIMITS.IMAGE_OCCLUSION_DECODED_MAX_BYTES) {
      throw new Error('The selected image is larger than 7 MB.');
    }

    const requestBody = JSON.stringify({
      image_base64: arrayBufferToBase64(await blob.arrayBuffer()),
      mime_type: blob.type || undefined,
      file_name: data.fileName,
      question: data.question,
      answer: data.answer || '',
      regions: data.regions,
      source_url: data.pageUrl
    });

    // The 7 MB check above bounds the DECODED image; base64 encoding alone
    // inflates that to ~9.3 MB, leaving under 1 MB of headroom under the
    // server's 10 MB hard limit before the question/answer/regions fields are
    // even counted. Check what is actually about to go over the wire.
    const budgetCheck = shared.checkRequestBudget(requestBody);
    if (!budgetCheck.ok) {
      throw new Error(`The occlusion card is too large to send. ${budgetCheck.message}`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(`${PLETHORA_BASE_URL}/ai/image-occlusion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: requestBody
      });
    } finally {
      clearTimeout(timeout);
    }

    // A response body can only be read once, so parse it ourselves instead of
    // calling response.json() (which would leave nothing for a text fallback
    // to read if the body isn't valid JSON — e.g. a plain-text rejection from
    // a layer other than the one this extension's own budget check covers).
    const rawBody = await response.text().catch(() => '');
    let result = {};
    try {
      result = rawBody ? JSON.parse(rawBody) : {};
    } catch {
      result = {};
    }
    if (!response.ok || !result.success) {
      throw new Error(result.error || rawBody || `Plethora returned ${response.status}`);
    }

    const displayed = await sendAIStateToTab(senderTabId, {
      action: 'showImageOcclusionSaved',
      result
    });
    if (!displayed) {
      showAINativeNotification('flashcards', true, 'Image occlusion card saved to Plethora.');
    }
    return result;
  } catch (error) {
    const message = aiFailureMessage(error?.message);
    const displayed = await sendAIStateToTab(senderTabId, {
      action: 'showAIError',
      operation: 'flashcards',
      error: message
    });
    if (!displayed) {
      showAINativeNotification('flashcards', false, message);
    }
    return { success: false, error: message };
  }
}

// NOTE: In MV3, onMessage listeners must not be `async`, otherwise the returned Promise
// can cause Chrome to close the message channel before `sendResponse()` runs.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  (async () => {
    try {
      switch (message.action) {
        case 'getStatus': {
          const statusResponse = await getStatus();
          sendResponse(statusResponse);
          break;
        }

        case 'saveCurrentTab': {
          try {
            const tab = message.tab || sender.tab;
            const saveResponse = await saveCurrentTab(tab);
            sendResponse(saveResponse);
          } catch (error) {
            console.error('[DEBUG] Error in saveCurrentTab handler:', error);
            sendResponse({ success: false, error: error.message });
            console.error('[DEBUG] saveCurrentTab error response sent');
          }
          break;
        }

        case 'saveAllTabs':
          sendResponse(await saveAllTabs());
          break;

        case 'testConnection':
          sendResponse(await testConnection());
          break;

        case 'keepAlive':
          keepAliveCount += 1;
          await flushQueuedExtractsIfPossible();
          // Content scripts ping every 20s; piggyback the registration retry
          // so an extract created in a tab whose content script was briefly
          // unavailable is still registered as soon as it comes back.
          await flushPendingExtractRegistrations();
          sendResponse({ success: true, keepAliveCount, timestamp: new Date().toISOString() });
          break;

        case 'sendToIncrementum':
          sendResponse(await sendToIncrementum(message.data));
          break;

        case 'createImageOcclusionCard':
          sendResponse(await createImageOcclusionCard(message.data || {}, sender.tab?.id));
          break;

        case 'createExtract': {
          if (message.data && message.data.text) {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
              sendResponse(await createExtractFromSelection(message.data.text, tab));
            } else {
              sendResponse({ success: false, error: 'No active tab found' });
            }
          } else {
            sendResponse({ success: false, error: 'No text provided for extract' });
          }
          break;
        }

        case 'toggleExtractModeForActiveTab':
          sendResponse(await toggleExtractMode());
          break;

        case 'settingsChanged':
          // Reload settings when they change
          await loadSettings();

          if (message.settings && message.settings.enableContextMenu !== undefined) {
            ENABLE_CONTEXT_MENU = message.settings.enableContextMenu !== false;
            refreshContextMenus();
          }
          if (message.settings && message.settings.enableNotifications !== undefined) {
            ENABLE_NOTIFICATIONS = message.settings.enableNotifications !== false;
          }

          sendResponse({ success: true });
          break;

        case 'saveExtract':
        case 'saveExtractWithPriority': {
          const extract = message.extract || {};
          const text = (extract.text || '').trim();
          const url = extract.url || sender?.tab?.url || '';
          const title = extract.title || sender?.tab?.title || 'Untitled';
          const toastTabId = await resolveExtractToastTabId(sender, extract);

          if (!text) {
            sendResponse({ success: false, error: 'No text provided for extract' });
            break;
          }

          if (!url) {
            sendResponse({ success: false, error: 'No URL provided for extract' });
            break;
          }

          const payload = {
            url,
            title,
            text,
            html_content: extract.html_content, // Include rich HTML content
            type: 'extract',
            context: extract.context,
            tags: extract.tags,
            priority: extract.priority,
            analysis: extract.analysis,
            fsrs_data: extract.fsrs_data
          };

          const response = await sendToIncrementum(payload);

          if (!response.success && isRetryableConnectionError(response)) {
            const queuedItem = await queueExtractForSync(payload);
            await sendInPageToast(
              toastTabId,
              true,
              'Extract cached locally and will sync when Plethora launches.'
            );
            sendResponse({
              success: true,
              queued: true,
              queueId: queuedItem.queueId,
              message: 'Extract cached locally and will sync when Plethora launches.'
            });
            break;
          }

          await sendInPageToast(
            toastTabId,
            response.success,
            response.success && response.degraded ? response.message : 'Extract sent to Plethora!'
          );
          sendResponse(response);
          break;
        }

        case 'generateAISummary': {
          const data = message.data || {};
          if (!data.content) {
            sendResponse({ success: false, error: 'No content provided for analysis' });
            break;
          }

          const aiResponse = await requestAIAnalysis(data);
          sendResponse(aiResponse);
          break;
        }

        case 'getAIStatus': {
          const statusResult = await checkAIStatus();
          sendResponse(statusResult);
          break;
        }

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('[DEBUG] Error in message handler:', error);
      sendResponse({ success: false, error: error.message });
    }
  })();

  return true; // Keep message channel open for async response
});

async function getStatus(options = {}) {
  try {
    await loadSettings();

    // Since BrowserSyncServer only handles POST requests, test connectivity differently
    // Try to make a simple POST request with minimal data to test server availability
    const response = await fetch(browserSyncEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ test: true, source: 'status_check' })
    });

    // Any response (including 400) means the server is reachable
    if (options.flushQueue !== false) {
      await flushQueuedExtracts();
    }
    const pending = await getPendingExtracts();
    return { connected: true, status: response.status, pendingExtracts: pending.length };
  } catch (error) {
    console.error('Error checking status:', error);
    const pending = await getPendingExtracts();
    return { connected: false, error: error.message, pendingExtracts: pending.length };
  }
}

// Test connection
async function testConnection() {
  try {
    await loadSettings();

    const requestBody = JSON.stringify({ test: true, source: 'connection_test', timestamp: new Date().toISOString() });

    // Test with a simple POST request since that's what the server expects
    const response = await fetch(browserSyncEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: requestBody
    });

    // Any response means the server is running
    const flushResult = await flushQueuedExtracts();
    const pending = await getPendingExtracts();
    return { connected: true, status: response.status, pendingExtracts: pending.length, flushedExtracts: flushResult.flushed || 0 };
  } catch (error) {
    console.error('[DEBUG] Error testing connection:', error);
    console.error('[DEBUG] Error details:', error.name, error.message);
    const pending = await getPendingExtracts();
    return { connected: false, error: error.message, pendingExtracts: pending.length };
  }
}

async function saveCurrentTab(passedTab) {
  try {
    let tab = passedTab;
    if (!tab) {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tab = activeTab;
    }

    if (!tab || isInternalUrl(tab.url)) {
      console.error('[DEBUG] Cannot save - internal URL or no tab');
      return { success: false, error: 'Cannot save internal browser pages' };
    }

    const result = await savePage(tab.url, tab.title, tab.id);

    if (result.success) {
      await sendInPageToast(
        tab.id,
        true,
        result.degraded ? result.message : 'Page saved to Plethora!'
      );
    }

    return result;
  } catch (error) {
    console.error('[DEBUG] Error in saveCurrentTab:', error);
    return { success: false, error: error.message };
  }
}

async function saveAllTabs() {
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const validTabs = tabs.filter(tab => tab.url && !isInternalUrl(tab.url));

    let successful = 0;
    const results = await Promise.allSettled(
      validTabs.map(tab => savePage(tab.url, tab.title, tab.id))
    );

    results.forEach(result => {
      if (result.status === 'fulfilled' && result.value.success) {
        successful++;
      }
    });

    return {
      success: true,
      successful,
      total: validTabs.length
    };
  } catch (error) {
    console.error('Error saving all tabs:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Read an error response body as a message a user can be shown.
 *
 * The desktop server returns a JSON body (`{success:false, error:"..."}`) for
 * most rejections, but callers used to display the RAW response text
 * verbatim — which meant a JSON-shaped error rendered as a stringified
 * object in a toast. Also handles the one response that is legitimately
 * empty: RequestBodyLimitLayer's own Content-Length pre-check, for a request
 * that reaches it despite this extension's own budgeting (see
 * annotate_oversized_request in browser_sync_server.rs, which gives that
 * specific case a JSON body too — this function is the fallback for whatever
 * that layer doesn't cover).
 */
async function readErrorMessage(response) {
  const text = await response.text().catch(() => '');
  if (!text) return '';
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.error === 'string' && parsed.error) {
      return parsed.error;
    }
  } catch {
    // Not JSON; fall through to the raw text.
  }
  return text;
}

async function sendToIncrementum(data, options = {}) {
  try {
    await loadSettings();

    // Use the root endpoint as expected by BrowserSyncServer
    const endpoint = browserSyncEndpoint();
    const shared = globalThis.IncrementumExtensionShared;
    let fitted = shared.fitPayloadToBudget(data);
    if (fitted.compactedHtml || fitted.droppedHtml || fitted.droppedImages || fitted.truncatedText) {
      console.warn('[Incrementum] Page payload was reduced to fit the desktop import limit.', {
        compactedHtml: fitted.compactedHtml,
        droppedHtml: fitted.droppedHtml,
        droppedImages: fitted.droppedImages,
        truncatedText: fitted.truncatedText,
        byteLength: fitted.byteLength
      });
    }

    const postPayload = async (target, body) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        return await fetch(target, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body,
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    let response;
    let requestEndpoint = endpoint;
    try {
      response = await postPayload(endpoint, fitted.requestBody);
    } catch (firstError) {
      const endpointUrl = new URL(endpoint);
      if (endpointUrl.hostname === '127.0.0.1') {
        endpointUrl.hostname = 'localhost';
      } else if (endpointUrl.hostname === 'localhost') {
        endpointUrl.hostname = '127.0.0.1';
      } else {
        throw firstError;
      }
      console.warn('[Incrementum] Primary loopback address failed; retrying the alternate address.');
      requestEndpoint = endpointUrl.toString();
      response = await postPayload(requestEndpoint, fitted.requestBody);
    }

    // Retry any oversized request with progressively reduced content. This is
    // unconditional now — it used to be gated on html_content/extracted_images
    // still being present in the first fit, so a request that overflowed for
    // any other reason, or one that had already shed everything the
    // extension's own 8 MB budget required, got no second chance and
    // surfaced a bare 413. Re-fitting against a much smaller budget forces
    // every shedding step (compact styles, drop html, drop images, truncate
    // text) rather than assuming which step is still needed.
    if (response.status === 413) {
      const RETRY_BUDGET_BYTES = 512 * 1024;
      fitted = shared.fitPayloadToBudget(data, RETRY_BUDGET_BYTES);
      response = await postPayload(requestEndpoint, fitted.requestBody);
    }

    if (response.ok) {
      // The desktop BrowserSyncServer answers 200 with a small JSON body
      // carrying the persisted ids ({ success, document_id, extract_id });
      // tolerate an empty/non-JSON body (older deployments) and just skip the
      // ids in that case.
      let serverMeta = {};
      try {
        const body = await response.text();
        if (body) {
          const parsed = JSON.parse(body);
          if (parsed && typeof parsed === 'object') {
            if (parsed.document_id) serverMeta.document_id = parsed.document_id;
            if (parsed.extract_id) serverMeta.extract_id = parsed.extract_id;
          }
        }
      } catch {
        // Not JSON / empty body — fine, we simply have no server-provided id.
      }
      if (options.allowFlush !== false) {
        await flushQueuedExtractsIfPossible();
      }
      const degradedMessage = shared.describeDegradation(fitted);
      return {
        success: true,
        message: degradedMessage || 'Data sent successfully',
        degraded: Boolean(degradedMessage),
        ...serverMeta
      };
    } else {
      const errorText = await readErrorMessage(response);
      console.error('Server response error:', errorText);
      return {
        success: false,
        error: errorText || `Server error: ${response.status}`,
        retryable: response.status >= 500 || response.status === 408 || response.status === 429
      };
    }
  } catch (error) {
    console.error('[DEBUG] Network error in sendToIncrementum:', error);
    console.error('[DEBUG] Network error details:', error.name, error.message);
    return { success: false, error: error.message, retryable: true };
  }
}

async function capturePageContentFallback(tabId) {
  if (!tabId || !chrome.scripting?.executeScript) return null;

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const root =
          document.querySelector('#mw-content-text .mw-parser-output, .mw-parser-output, article, [itemprop="articleBody"], .article-body, .post-content, .entry-content, .article-content, [role="main"], main, #content, #main') ||
          document.body;
        const text = (root?.innerText || root?.textContent || document.body?.innerText || '')
          .replace(/\r/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
          .slice(0, 250000);
        const html = root?.outerHTML || '';
        const images = Array.from(root?.querySelectorAll?.('img') || [])
          .map((img) => {
            const src =
              img.currentSrc ||
              img.getAttribute('data-src') ||
              img.getAttribute('data-lazy-src') ||
              img.getAttribute('data-original') ||
              img.getAttribute('src') ||
              '';
            if (!src || src.startsWith('data:')) return null;
            try {
              return {
                src: new URL(src, window.location.href).href,
                alt: (img.getAttribute('alt') || '').trim() || undefined
              };
            } catch {
              return { src, alt: (img.getAttribute('alt') || '').trim() || undefined };
            }
          })
          .filter(Boolean)
          .slice(0, 24);

        return {
          text,
          title: document.title || location.hostname,
          html_content: html.length <= 4 * 1024 * 1024 ? html : undefined,
          extracted_images: images
        };
      }
    });
    return results?.[0]?.result || null;
  } catch (error) {
    console.warn('[Incrementum] Direct page capture fallback failed:', error.message);
    return null;
  }
}

async function saveLink(url, sourceTabId, linkText) {
  // Resolve a title without opening a tab — use link text or hostname
  let fallbackTitle = '';
  try {
    fallbackTitle = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    fallbackTitle = 'Saved link';
  }

  const resolvedLinkText = typeof linkText === 'string' ? linkText.trim() : '';
  const title = resolvedLinkText || fallbackTitle;

  try {
    const result = await sendToIncrementum({
      url,
      title,
      text: '',
      type: 'page'
    });
    const msg = result.success ? 'Link sent to Plethora!' : 'Failed to save link';
    await sendInPageToast(sourceTabId, result.success, msg);
    return result;
  } catch (error) {
    console.error('[DEBUG] Error in saveLink:', error);
    await sendInPageToast(sourceTabId, false, 'Failed to save link — server unreachable');
    return { success: false, error: error.message };
  }
}

/**
 * Save an X post/thread tab as a URL-only typed capture. x.com's DOM is
 * JS-rendered and useless for parsing, and the app's ThreadReaderApp-first
 * pipeline is authoritative — so no page content is requested from the
 * content script or transmitted; the desktop app resolves, enriches, and
 * persists the thread itself. An unreachable server goes through the shared
 * offline queue so the capture flushes when the app starts; failures reuse
 * the in-page toast plumbing and name the typed reason the server returned.
 */
async function saveXThreadCapture(url, title, tabId = null) {
  const payload = { url, title, text: '', type: 'x-thread' };
  const result = await sendToIncrementum(payload);

  if (!result.success && isRetryableConnectionError(result)) {
    const queuedItem = await queueExtractForSync(payload);
    return {
      success: true,
      queued: true,
      queueId: queuedItem.queueId,
      message: 'Thread capture cached and will sync when Plethora is available.'
    };
  }

  if (!result.success) {
    await sendInPageToast(tabId, false, `X thread capture failed: ${result.error || 'unknown error'}`);
  }
  return result;
}

async function savePage(url, title, tabId = null) {
  try {
    // X status URLs are captured URL-only (see saveXThreadCapture) — before
    // any page-content request, so the content script is never asked to
    // scrape x.com. Covers single-tab save, save-all-tabs, and context-menu
    // save, which all funnel through here.
    if (globalThis.IncrementumExtensionShared?.isXStatusURL?.(url)) {
      return saveXThreadCapture(url, title, tabId);
    }

    let resolvedTabId = tabId;
    if (!resolvedTabId) {
      const tabs = await chrome.tabs.query({ url: url });
      if (tabs.length > 0) {
        resolvedTabId = tabs[0].id;
      }
    }

    let pageContent = '';
    let pageHtml = undefined;
    let extractedImages = undefined;

    if (resolvedTabId) {
      try {
        // Request content from the content script
        const response = await safeSendTabMessage(resolvedTabId, {
          action: 'getPageContent'
        });
        if (response && response.success) {
          pageContent = response.page?.text || response.content || '';
          pageHtml = response.page?.html_content;
          extractedImages = response.page?.extracted_images;
        }
      } catch (error) {
        console.error('[DEBUG] Could not get content from content script:', error.message);
      }
    }

    if (resolvedTabId && !pageContent.trim() && !pageHtml) {
      const fallback = await capturePageContentFallback(resolvedTabId);
      if (fallback) {
        pageContent = fallback.text || '';
        pageHtml = fallback.html_content;
        extractedImages = fallback.extracted_images;
        title = fallback.title || title;
      }
    }

    // Whole-page save: always a "page", never an "extract" (extracts are
    // text selections/highlights). Without this, sendToIncrementum's
    // heuristic would classify the non-empty page text as an extract.
    const payload = {
      url,
      title,
      text: pageContent,
      html_content: pageHtml,
      extracted_images: extractedImages,
      type: 'page'
    };
    const result = await sendToIncrementum(payload);
    if (!result.success && isRetryableConnectionError(result)) {
      const queuedItem = await queueExtractForSync(payload);
      return {
        success: true,
        queued: true,
        queueId: queuedItem.queueId,
        message: 'Page cached and will sync when Plethora is available.'
      };
    }
    return result;
  } catch (error) {
    console.error('[DEBUG] Error in savePage:', error);
    // Fallback to basic save without content
    return await sendToIncrementum({ url, title, text: '', type: 'page' });
  }
}

// Create extract from selection (context menu)
async function createExtractFromSelection(selectedText, tab) {
  const text = (selectedText || '').trim();
  if (!text) {
    return { success: false, error: 'No selection provided' };
  }
  const payload = { url: tab.url, title: tab.title, text, type: 'extract' };
  const result = await sendToIncrementum(payload);
  if (!result.success && isRetryableConnectionError(result)) {
    const queuedItem = await queueExtractForSync(payload);
    await sendInPageToast(tab?.id, true, 'Extract cached and will sync when Plethora launches.');
    return {
      success: true,
      queued: true,
      queueId: queuedItem.queueId,
      message: 'Extract cached locally and will sync when Plethora launches.'
    };
  }
  await sendInPageToast(
    tab?.id,
    result.success,
    result.success && result.degraded ? result.message : 'Extract sent to Plethora!'
  );

  // Join the shared success path: only a server-confirmed create registers in
  // the tab's pageExtracts (never the queued/offline branch, never a failure),
  // so the derived counter increments exactly once and not optimistically.
  const shouldRegister = Boolean(result.success && !result.queued && tab?.id);
  if (shouldRegister) {
    const record = buildExtractRecord(text, tab, result);
    await persistExtractRegistration(tab.id, record);
    const registered = await notifyTabRegisterExtract(tab.id, record);
    if (registered) {
      await removeExtractRegistration(tab.id, record.id);
    }
  }

  return result;
}

// Build the first-class pageExtracts record for a background-created extract,
// using the server-confirmed extract id when available so re-delivery after a
// service-worker restart dedupes to the same record.
function buildExtractRecord(text, tab, result) {
  const shared = globalThis.IncrementumExtensionShared;
  return shared.normalizeExtractRecord(
    { text, url: tab.url, title: tab.title },
    { id: result?.extract_id }
  );
}

async function persistExtractRegistration(tabId, record) {
  if (!tabId || !record?.id) return;
  await withPendingExtractRegistrationsLock(async () => {
    const pending = await getPendingExtractRegistrations();
    const already = pending.some(
      (item) => item.tabId === tabId && item.extract?.id === record.id
    );
    if (already) return;
    pending.push({ tabId, extract: record });
    await setPendingExtractRegistrations(pending);
  });
}

async function removeExtractRegistration(tabId, recordId) {
  await withPendingExtractRegistrationsLock(async () => {
    const pending = await getPendingExtractRegistrations();
    const remaining = pending.filter(
      (item) => !(item.tabId === tabId && item.extract?.id === recordId)
    );
    await setPendingExtractRegistrations(remaining);
  });
}

// Tell the tab's content script to register a server-confirmed extract into
// pageExtracts. Returns true only when the content script confirmed it. Any
// failure (tab gone, content script not injected, service worker mid-restart)
// leaves the registration pending so flushPendingExtractRegistrations() can
// re-deliver it idempotently.
async function notifyTabRegisterExtract(tabId, record) {
  if (!tabId || !record?.id) return false;
  try {
    const response = await safeSendTabMessage(tabId, {
      action: 'registerExtracts',
      extracts: [record]
    });
    return Boolean(response && response.success);
  } catch (error) {
    console.warn('[DEBUG] Could not register extract in tab:', error.message);
    return false;
  }
}

// Re-deliver registrations the background owed to tabs when a service-worker
// restart interrupted them. Idempotent end to end: the content script dedupes
// by extract id, so re-sending the same record never double-counts. Records for
// tabs that no longer exist are dropped (per-tab state cannot be updated once
// the tab is gone).
//
// Runs under the same mutex as persist/remove so the read-then-write of the
// pending list is atomic with respect to a concurrent create: a registration
// that lands while a flush is in progress is never clobbered by the flush's
// stale snapshot, and a flush that observes it re-delivers it exactly once.
async function flushPendingExtractRegistrations() {
  return withPendingExtractRegistrationsLock(async () => {
    const stored = await getPendingExtractRegistrations();
    if (stored.length === 0) {
      return { success: true, registered: 0, remaining: 0 };
    }
    const seen = new Set();
    const pending = stored.filter((item) => {
      if (!item || !item.extract?.id) return false;
      const key = `${item.tabId}:${item.extract.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const remaining = [];
    let registered = 0;
    for (const item of pending) {
      let tabExists = true;
      try {
        await chrome.tabs.get(item.tabId);
      } catch {
        tabExists = false;
      }
      if (!tabExists) {
        continue;
      }
      if (await notifyTabRegisterExtract(item.tabId, item.extract)) {
        registered += 1;
      } else {
        remaining.push(item);
      }
    }
    await setPendingExtractRegistrations(remaining);
    return { success: true, registered, remaining: remaining.length };
  });
}

async function sendInPageToast(tabId, success, message) {
  if (!ENABLE_NOTIFICATIONS) {
    return;
  }
  try {
    if (tabId) {
      await safeSendTabMessage(tabId, {
        action: 'showSaveIndicator',
        text: message,
        type: success ? 'success' : 'error'
      });
    } else {
      // Fallback to native notification when no tab context is available
      if (chrome.notifications) {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Plethora',
          message: message
        });
      }
    }
  } catch (error) {
    console.error('[DEBUG] Could not send in-page toast:', error.message);
  }
}

async function sendAIStateToTab(tabId, message) {
  if (!tabId) {
    return false;
  }

  try {
    const response = await safeSendTabMessage(tabId, message);
    if (response?.success === true) {
      return true;
    }
  } catch (error) {
    console.warn('[DEBUG] Existing content script could not show AI state:', error.message);
  }

  // Reloading/updating an extension invalidates content scripts in tabs that
  // were already open. Reinstall the current script on demand so users do not
  // have to know that every page must also be refreshed after an extension
  // reload.
  try {
    if (chrome.scripting?.executeScript) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js']
      });
      const response = await safeSendTabMessage(tabId, message);
      return response?.success === true;
    }
  } catch (error) {
    console.warn('[DEBUG] Could not inject the AI result UI into the page:', error.message);
  }

  return false;
}

function aiProgressMessage(operation) {
  return operation === 'flashcards'
    ? 'Generating and saving flashcards…'
    : 'Summarizing the selected text…';
}

function aiSuccessMessage(operation) {
  return operation === 'flashcards'
    ? 'Flashcards were generated and saved to Plethora.'
    : 'The selected text was summarized.';
}

function aiFailureMessage(error) {
  const message = String(error || 'Plethora AI request failed.').trim();
  return message.length > 240 ? `${message.slice(0, 237)}…` : message;
}

function showAINativeNotification(operation, success, message) {
  if (!chrome.notifications) {
    return false;
  }
  chrome.notifications.create({
    type: 'basic',
    iconUrl: 'icons/icon48.png',
    title: operation === 'flashcards'
      ? (success ? 'Plethora AI flashcards' : 'Flashcard generation failed')
      : (success ? 'Plethora AI summary' : 'Summarization failed'),
    message
  });
  return true;
}

async function processSelectionWithAI(operation, selectedText, tab) {
  const content = (selectedText || '').trim();
  if (!content || !tab?.id) {
    const message = 'Select some text before using Plethora AI.';
    const displayed = await sendAIStateToTab(tab?.id, {
      action: 'showAIError',
      operation,
      error: message
    });
    if (!displayed) {
      showAINativeNotification(operation, false, message);
    }
    return { success: false, error: 'No selection provided' };
  }

  const progressDisplayed = await sendAIStateToTab(tab.id, {
    action: 'showAIProgress',
    operation
  });
  if (!progressDisplayed) {
    showAINativeNotification(operation, true, aiProgressMessage(operation));
  }

  try {
    const result = await requestAIAnalysis({
      content,
      operation,
      count: FLASHCARD_COUNT,
      max_words: 150,
      save_flashcards: operation === 'flashcards',
      card_types: operation === 'flashcards' ? FLASHCARD_TYPES : undefined,
      url: tab.url,
      title: tab.title
    });

    if (!result?.success) {
      const message = aiFailureMessage(result?.error);
      const displayed = await sendAIStateToTab(tab.id, {
        action: 'showAIError',
        operation,
        error: message
      });
      if (!displayed) {
        showAINativeNotification(operation, false, message);
      }
      return result;
    }

    const displayed = await sendAIStateToTab(tab.id, {
      action: 'showAIResult',
      operation,
      result
    });
    if (!displayed) {
      showAINativeNotification(operation, true, aiSuccessMessage(operation));
    }

    return result;
  } catch (error) {
    const message = aiFailureMessage(error?.message);
    const displayed = await sendAIStateToTab(tab.id, {
      action: 'showAIError',
      operation,
      error: message
    });
    if (!displayed) {
      showAINativeNotification(operation, false, message);
    }
    return { success: false, error: message };
  }
}

// Helper function to check if URL is internal
function isInternalUrl(url) {
  if (!url) return true;

  const internalPrefixes = [
    'chrome://',
    'chrome-extension://',
    'moz-extension://',
    'about:',
    'edge://',
    'opera://',
    'brave://'
  ];

  return internalPrefixes.some(prefix => url.startsWith(prefix));
}

chrome.commands.onCommand.addListener(async (command) => {
  switch (command) {
    case 'save-current-tab':
      await saveCurrentTab();
      break;

    case 'toggle-extract-mode':
      await toggleExtractMode();
      break;

    case 'quick-extract':
      await quickExtract();
      break;

    case 'toggle-highlights':
      await toggleHighlights();
      break;

    case 'save-all-tabs':
      await saveAllTabs();
      break;
  }
});

// Toggle extract mode
async function toggleExtractMode() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      const response = await sendAIStateToTab(tab.id, { action: 'toggleExtractMode' });
      return response
        ? { success: true }
        : { success: false, error: 'Could not activate extract mode on this page.' };
    }
    return { success: false, error: 'No active tab found.' };
  } catch (error) {
    console.error('Error toggling extract mode:', error);
    return { success: false, error: error.message };
  }
}

// Quick extract from selection
async function quickExtract() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      const response = await safeSendTabMessage(tab.id, { action: 'getSelection' });
      if (response && response.success && response.text) {
        await createExtractFromSelection(response.text, tab);
      } else {
        console.warn('[DEBUG] No selection text available for quick extract');
      }
    }
  } catch (error) {
    console.error('Error in quick extract:', error);
  }
}

// Toggle highlights
async function toggleHighlights() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      await safeSendTabMessage(tab.id, { action: 'toggleHighlights' });
    }
  } catch (error) {
    console.error('Error toggling highlights:', error);
  }
}

// Request AI analysis from desktop app
async function requestAIAnalysis(data) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  try {
    await loadSettings();
    const endpoint = `${PLETHORA_BASE_URL}/ai/process`;

    // Every request this extension sends should be fitted to the transport
    // budget on principle, this one included — even though its only current
    // callers bound `content` to a user's manual text selection, which is not
    // a realistic overflow.
    const shared = globalThis.IncrementumExtensionShared;
    const fitted = shared.fitAiRequestToBudget({
      content: data.content,
      operation: data.operation || 'all',
      max_words: data.max_words || 150,
      count: data.count || 5,
      save_flashcards: Boolean(data.save_flashcards),
      card_types: Array.isArray(data.card_types) ? data.card_types : undefined,
      url: data.url,
      title: data.title
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      signal: controller.signal,
      body: fitted.requestBody
    });

    if (!response.ok) {
      const errorText = await readErrorMessage(response);
      console.error('[DEBUG] AI request failed:', response.status, errorText);
      return {
        success: false,
        error: response.status === 503
          ? 'AI is not configured. Please configure an AI provider in the desktop app settings.'
          : response.status === 413
            ? (errorText || 'The selected text is too large for Plethora AI to process.')
            : `AI request failed: ${response.status}`
      };
    }

    const result = await response.json();
    return result;

  } catch (error) {
    console.error('[DEBUG] AI analysis error:', error);
    return {
      success: false,
      error: error?.name === 'AbortError'
        ? 'Plethora AI took longer than 60 seconds to respond. Please try again.'
        : (error.message || 'Could not reach Plethora. Make sure the desktop app and Browser Extension Server are running.')
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkAIStatus() {
  try {
    await loadSettings();
    const endpoint = `${PLETHORA_BASE_URL}/ai/status`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      return { configured: false, error: 'Failed to check AI status' };
    }

    const result = await response.json();
    return result;

  } catch (error) {
    console.error('[DEBUG] AI status check error:', error);
    return { configured: false, error: error.message };
  }
}

// Setup alarm for auto sync
function setupAutoSyncAlarm() {
  if (!chrome.alarms) return;
  chrome.alarms.clear('autoSyncAlarm', () => {
    if (ENABLE_AUTO_SYNC) {
      let minutes = 15;
      if (SYNC_FREQUENCY === 'realtime') minutes = 1;
      else if (SYNC_FREQUENCY === 'hourly') minutes = 60;
      else if (SYNC_FREQUENCY === 'daily') minutes = 1440;
      
      chrome.alarms.create('autoSyncAlarm', { periodInMinutes: minutes });
    }
  });
}

if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'autoSyncAlarm') {
      await flushQueuedExtractsIfPossible();
    }
  });
}

// Bookmarks sync listener
if (chrome.bookmarks) {
  chrome.bookmarks.onCreated.addListener(async (id, bookmark) => {
    if (SAVE_BOOKMARKS && bookmark.url) {
      await savePage(bookmark.url, bookmark.title);
    }
  });
}

// History sync listener
if (chrome.history) {
  chrome.history.onVisited.addListener(async (historyItem) => {
    if (SAVE_HISTORY && historyItem.url && !isInternalUrl(historyItem.url)) {
      await sendToIncrementum({
        url: historyItem.url,
        title: historyItem.title || 'Visited Page',
        text: '',
        type: 'page',
        source: 'browser_history'
      });
    }
  });
}

// Auto-save pages navigation listener
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !isInternalUrl(tab.url)) {
    if (AUTO_SAVE) {
      await savePage(tab.url, tab.title);
    }
  }
});
