/**
 * Webview Extract Bridge
 *
 * This script is injected by the Rust web proxy (`web_proxy.rs`) into every
 * proxied HTML document. It tracks the user's text selection, renders a
 * floating "Extract" button, and communicates with the app via `postMessage`
 * to `window.parent` — there is no `localStorage` sink and no native webview
 * anymore (the loopback proxy serves the page in a plain iframe).
 *
 * Message protocol (design D4 in
 * `openspec/changes/fix-in-app-browser-page-loading/design.md`), all tagged
 * with the fixed namespace `incrementum-web`:
 *
 * | Direction  | Type            | Payload                                       |
 * | ---------- | --------------- | --------------------------------------------- |
 * | frame→app  | `ready`         | `{ url, title }`                              |
 * | frame→app  | `selection`     | `{ text, html, url, title }` (empty when clear) |
 * | frame→app  | `navigate`      | `{ url, newTab }`                             |
 * | frame→app  | `extract`       | `{ text, html, url, title }` (button/shortcut) |
 * | frame→app  | `text-response` | `{ id, text }`                                |
 * | app→frame  | `text-request`  | `{ id }`                                      |
 * | app→frame  | `set-shortcut`  | `{ ctrl, meta, shift, alt, key }`             |
 *
 * `url` in every outbound message is `document.baseURI` — the proxy injects
 * `<base href="<final upstream URL>">`, so the bridge always reports the
 * upstream page URL, never the loopback proxy URL.
 */

export const WEBVIEW_EXTRACT_BRIDGE_SCRIPT = `
(function() {
  'use strict';

  if (window.__incrementumExtractBridge) {
    return;
  }
  window.__incrementumExtractBridge = true;

  // Configuration
  var CONFIG = {
    MIN_SELECTION_LENGTH: 3,
    BUTTON_OFFSET_Y: -45,
    BUTTON_OFFSET_X: 0
  };

  var NS = 'incrementum-web';

  // State
  var floatingButton = null;
  var lastSelection = '';
  var lastSelectionHtml = '';
  var hideTimeout = null;

  function post(type, payload) {
    try {
      window.parent.postMessage({ ns: NS, type: type, payload: payload }, '*');
    } catch (e) {
      // postMessage may fail in restricted contexts; ignore.
    }
  }

  // The proxy injects <base href="<final upstream URL>">, so baseURI is the
  // real page URL after any redirects — never the loopback proxy URL.
  function upstreamUrl() {
    try {
      return document.baseURI || window.location.href;
    } catch (e) {
      return window.location.href;
    }
  }

  // Announce the page to the app as soon as the bridge is running.
  post('ready', { url: upstreamUrl(), title: document.title });

  function getSelectedHtml() {
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return '';

    var range = selection.getRangeAt(0);
    var fragment = range.cloneContents();
    var div = document.createElement('div');
    div.appendChild(fragment);
    return div.innerHTML;
  }

  function currentSelection() {
    var selection = window.getSelection();
    var text = selection ? selection.toString().trim() : '';
    var html = text ? (lastSelectionHtml || getSelectedHtml()) : '';
    return {
      text: text,
      html: html,
      url: upstreamUrl(),
      title: document.title
    };
  }

  function postSelection() {
    var data = currentSelection();
    post('selection', data);
  }

  // The user explicitly asked to extract (floating button or in-frame
  // shortcut): post the payload and let the app open the extract dialog.
  function requestExtract() {
    var data = currentSelection();
    if (data.text.length >= CONFIG.MIN_SELECTION_LENGTH) {
      post('extract', data);
    }
  }

  function createFloatingButton() {
    if (floatingButton) {
      return floatingButton;
    }

    var button = document.createElement('div');
    button.id = '__incrementum-extract-btn';
    button.innerHTML = \`
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 6px;">
        <path d="M12 5v14M5 12h14"/>
      </svg>
      <span>Extract</span>
    \`;

    button.style.cssText = \`
      position: fixed;
      z-index: 2147483647;
      display: none;
      align-items: center;
      padding: 8px 16px;
      background: #3b82f6;
      color: white;
      border-radius: 8px;
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      transition: transform 0.15s ease, opacity 0.15s ease;
      user-select: none;
      pointer-events: auto;
    \`;

    button.addEventListener('mouseenter', function () {
      button.style.transform = 'scale(1.05)';
      clearTimeout(hideTimeout);
    });

    button.addEventListener('mouseleave', function () {
      button.style.transform = 'scale(1)';
    });

    button.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      requestExtract();
      hideButton();
    });

    document.body.appendChild(button);
    floatingButton = button;
    return button;
  }

  function showButtonAtSelection() {
    var selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      hideButton();
      return;
    }

    var text = selection.toString().trim();
    if (text.length < CONFIG.MIN_SELECTION_LENGTH) {
      hideButton();
      return;
    }

    lastSelection = text;
    lastSelectionHtml = getSelectedHtml();

    var range = selection.getRangeAt(0);
    var rect = range.getBoundingClientRect();

    var button = createFloatingButton();

    var left = rect.left + (rect.width / 2) + CONFIG.BUTTON_OFFSET_X;
    var top = rect.top + CONFIG.BUTTON_OFFSET_Y;

    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;

    left = Math.max(60, Math.min(left, viewportWidth - 60));

    if (top < 50) {
      top = rect.bottom + 10;
    }

    button.style.left = left + 'px';
    button.style.top = top + 'px';
    button.style.transform = 'translateX(-50%)';
    button.style.display = 'flex';
    button.style.opacity = '1';

    clearTimeout(hideTimeout);
  }

  function hideButton() {
    if (floatingButton) {
      floatingButton.style.opacity = '0';
      hideTimeout = setTimeout(function () {
        if (floatingButton) {
          floatingButton.style.display = 'none';
        }
      }, 150);
    }
  }

  function handleSelectionChange() {
    setTimeout(function () {
      var selection = window.getSelection();
      var text = selection ? selection.toString().trim() : '';

      if (text.length >= CONFIG.MIN_SELECTION_LENGTH) {
        showButtonAtSelection();
      } else {
        hideButton();
      }
      // Always report the current selection (empty payload when cleared).
      postSelection();
    }, 10);
  }

  function handleMouseUp(e) {
    if (e.target.closest && e.target.closest('#__incrementum-extract-btn')) {
      return;
    }
    setTimeout(function () {
      var selection = window.getSelection();
      var text = selection ? selection.toString().trim() : '';
      if (text.length >= CONFIG.MIN_SELECTION_LENGTH) {
        showButtonAtSelection();
      }
    }, 10);
  }

  function handleMouseDown(e) {
    if (e.target.closest && e.target.closest('#__incrementum-extract-btn')) {
      return;
    }
    hideButton();
  }

  // Configurable shortcut — defaults to Ctrl/Cmd+Shift+E, updated via the
  // app's set-shortcut message when the user changes it in settings.
  var shortcutConfig = { ctrl: true, meta: true, shift: true, alt: false, key: 'E' };

  function matchesShortcut(e) {
    var sk = shortcutConfig;
    var wantCtrl = sk.ctrl || (sk.meta && !sk.ctrl);
    var wantMeta = sk.meta || (sk.ctrl && !sk.meta);
    var gotCtrl = e.ctrlKey || e.metaKey;
    return (
      gotCtrl === (wantCtrl || wantMeta) &&
      e.altKey === !!sk.alt &&
      e.shiftKey === !!sk.shift &&
      e.key.toUpperCase() === sk.key.toUpperCase()
    );
  }

  function handleKeyDown(e) {
    if (matchesShortcut(e)) {
      e.preventDefault();
      requestExtract();
    }
  }

  // In-page navigation: intercept anchor clicks and form submits, resolve the
  // target against the upstream base, and hand control to the app so the URL
  // bar / back-forward history stay authoritative in React (D4).
  function handleClick(e) {
    var node = e.target;
    var anchor = null;
    while (node && node !== document) {
      if (node.tagName === 'A') {
        anchor = node;
        break;
      }
      node = node.parentNode;
    }
    if (!anchor) return;
    var href = anchor.getAttribute('href');
    if (!href) return;
    if (href.charAt(0) === '#' || /^(javascript|mailto|tel):/i.test(href)) return;
    if (anchor.hasAttribute('download')) return;

    e.preventDefault();
    e.stopPropagation();

    var url;
    try {
      url = new URL(href, upstreamUrl()).href;
    } catch (err) {
      return;
    }
    var newTab = e.metaKey || e.ctrlKey || e.button === 1 || anchor.target === '_blank';
    post('navigate', { url: url, newTab: !!newTab });
  }

  function handleSubmit(e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    e.preventDefault();
    e.stopPropagation();

    var action = form.getAttribute('action') || '';
    var method = (form.getAttribute('method') || 'get').toLowerCase();
    var url;
    try {
      url = new URL(action, upstreamUrl());
      // GET forms: serialize their fields into the query string so search
      // forms actually work (e.g. https://example.com/search?q=…).
      if (method === 'get') {
        var params = new URLSearchParams();
        var fields = form.querySelectorAll('input, select, textarea');
        for (var i = 0; i < fields.length; i++) {
          var field = fields[i];
          if (!field.name) continue;
          if (field.disabled) continue;
          if (field.type === 'checkbox' || field.type === 'radio') {
            if (field.checked) params.append(field.name, field.value);
          } else {
            params.append(field.name, field.value);
          }
        }
        var merged = new URLSearchParams(url.search);
        params.forEach(function (value, key) {
          if (!merged.has(key)) merged.append(key, value);
        });
        url.search = merged.toString();
      }
      url = url.href;
    } catch (err) {
      return;
    }
    var newTab = form.target === '_blank';
    post('navigate', { url: url, newTab: !!newTab });
  }

  // Inbound requests from the app.
  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var msg = e.data;
    if (!msg || msg.ns !== NS) return;

    if (msg.type === 'text-request' && msg.payload && typeof msg.payload.id !== 'undefined') {
      var text = (document.body && document.body.innerText) || '';
      post('text-response', { id: msg.payload.id, text: text });
    } else if (msg.type === 'set-shortcut' && msg.payload) {
      shortcutConfig = {
        ctrl: !!msg.payload.ctrl,
        meta: !!msg.payload.meta,
        shift: !!msg.payload.shift,
        alt: !!msg.payload.alt,
        key: String(msg.payload.key || 'E')
      };
    }
  });

  document.addEventListener('selectionchange', handleSelectionChange);
  document.addEventListener('mouseup', handleMouseUp);
  document.addEventListener('mousedown', handleMouseDown);
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('click', handleClick);
  document.addEventListener('submit', handleSubmit, true);

  window.addEventListener('mouseup', handleMouseUp);
  window.addEventListener('mousedown', handleMouseDown);

  var scrollTimeout;
  window.addEventListener('scroll', function () {
    hideButton();
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(function () {
      var selection = window.getSelection();
      var text = selection ? selection.toString().trim() : '';
      if (text.length >= CONFIG.MIN_SELECTION_LENGTH) {
        showButtonAtSelection();
      }
    }, 100);
  }, { passive: true });
})();
`;

/**
 * Namespace field carried by every bridge message.
 */
export const WEB_BRIDGE_NS = "incrementum-web";

export interface WebBridgeSelectionPayload {
  text: string;
  html: string;
  url: string;
  title: string;
}

export interface WebBridgeReadyPayload {
  url: string;
  title: string;
}

export interface WebBridgeNavigatePayload {
  url: string;
  newTab: boolean;
}

export interface WebBridgeTextResponsePayload {
  id: number;
  text: string;
}

export interface WebBridgeProxyErrorPayload {
  reason: string;
  host: string;
}

/**
 * Shape-check a raw `message` payload against the bridge protocol. Returns a
 * typed message or `null` for anything that does not match the expected shape
 * (task 3.3 / 7.1: malformed payloads are ignored).
 */
export function parseWebBridgeMessage(
  data: unknown
):
  | { ns: string; type: "ready"; payload: WebBridgeReadyPayload }
  | { ns: string; type: "selection"; payload: WebBridgeSelectionPayload }
  | { ns: string; type: "navigate"; payload: WebBridgeNavigatePayload }
  | { ns: string; type: "extract"; payload: WebBridgeSelectionPayload }
  | { ns: string; type: "text-response"; payload: WebBridgeTextResponsePayload }
  | { ns: string; type: "proxy-error"; payload: WebBridgeProxyErrorPayload }
  | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Record<string, unknown>;
  if (msg.ns !== WEB_BRIDGE_NS) return null;
  if (typeof msg.type !== "string") return null;
  if (typeof msg.payload !== "object" || msg.payload === null) return null;
  const payload = msg.payload as Record<string, unknown>;

  switch (msg.type) {
    case "ready": {
      if (typeof payload.url !== "string" || typeof payload.title !== "string") return null;
      return { ns: WEB_BRIDGE_NS, type: "ready", payload: { url: payload.url, title: payload.title } };
    }
    case "selection":
    case "extract": {
      if (
        typeof payload.text !== "string" ||
        typeof payload.html !== "string" ||
        typeof payload.url !== "string" ||
        typeof payload.title !== "string"
      ) {
        return null;
      }
      return {
        ns: WEB_BRIDGE_NS,
        type: msg.type as "selection" | "extract",
        payload: {
          text: payload.text,
          html: payload.html,
          url: payload.url,
          title: payload.title,
        },
      };
    }
    case "navigate": {
      if (typeof payload.url !== "string" || typeof payload.newTab !== "boolean") return null;
      return { ns: WEB_BRIDGE_NS, type: "navigate", payload: { url: payload.url, newTab: payload.newTab } };
    }
    case "text-response": {
      if (typeof payload.id !== "number" || typeof payload.text !== "string") return null;
      return { ns: WEB_BRIDGE_NS, type: "text-response", payload: { id: payload.id, text: payload.text } };
    }
    case "proxy-error": {
      if (typeof payload.reason !== "string" || typeof payload.host !== "string") return null;
      return { ns: WEB_BRIDGE_NS, type: "proxy-error", payload: { reason: payload.reason, host: payload.host } };
    }
    default:
      return null;
  }
}
