/* globals chrome */
// Content script for Incrementum Browser Sync
// Provides additional functionality when injected into web pages

(function() {
  'use strict';

  // Only run on actual web pages, not extension pages
  if (window.location.protocol === 'chrome-extension:' ||
      window.location.protocol === 'moz-extension:') {
    return;
  }

  let isPWAAvailable = false;
  let pwaMessageQueue = [];
  let pwaResponseHandlers = new Map();
  let keepAliveIntervalId = null;
  let priorityDialogStyleAdded = false;

  function isRuntimeAvailable() {
    return Boolean(globalThis.chrome?.runtime?.id);
  }

  function startRuntimeKeepAlive() {
    if (keepAliveIntervalId !== null || !isRuntimeAvailable()) {
      return;
    }

    keepAliveIntervalId = window.setInterval(() => {
      if (!isRuntimeAvailable()) {
        stopRuntimeKeepAlive();
        return;
      }

      chrome.runtime.sendMessage({ action: 'keepAlive', source: 'content_script' }, () => {
        const lastError = chrome.runtime.lastError;
        if (!lastError) {
          return;
        }

        if (lastError.message.includes('Extension context invalidated')) {
          stopRuntimeKeepAlive();
        }
      });
    }, 20000);
  }

  function stopRuntimeKeepAlive() {
    if (keepAliveIntervalId !== null) {
      window.clearInterval(keepAliveIntervalId);
      keepAliveIntervalId = null;
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve) => {
      if (!isRuntimeAvailable()) {
        resolve({ success: false, error: 'Extension context invalidated' });
        return;
      }

      chrome.runtime.sendMessage(message, (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          resolve({ success: false, error: lastError.message });
          return;
        }

        resolve(response);
      });
    });
  }

  /**
   * Check if current page is the Incrementum PWA
   */
  function isIncrementumPWA() {
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1';
    // Compat window (rebrand task 3.6): the app writes BOTH marker attributes
    // and either product title may appear during the transition.
    const hasAppMarker =
      document.querySelector('[data-plethora-app]') !== null ||
      document.querySelector('[data-incrementum-app]') !== null;
    const hasAppTitle =
      document.title.includes('Plethora') || document.title.includes('Incrementum');

    return hasAppMarker || (isLocalhost && hasAppTitle);
  }

  /**
   * Listen for messages from the PWA
   */
  function setupPWABridge() {
    window.addEventListener('message', (event) => {
      // Only handle messages from same window
      if (event.source !== window) return;

      const message = event.data;
      // Compat window: accept responses from both the new and the legacy
      // PWA source token. The handler map deletes on first delivery, so the
      // duplicate of a dual-send is a no-op.
      if (!message || (message.source !== 'plethora-pwa' && message.source !== 'incrementum-pwa')) return;

      if (message.action === 'ready' || message.action === 'pong') {
        isPWAAvailable = true;

        while (pwaMessageQueue.length > 0) {
          const queuedMsg = pwaMessageQueue.shift();
          sendToPWA(queuedMsg.message, queuedMsg.callback);
        }
      }

      if (message.requestId && pwaResponseHandlers.has(message.requestId)) {
        const handler = pwaResponseHandlers.get(message.requestId);
        pwaResponseHandlers.delete(message.requestId);
        handler(message);
      }
    });

    // Ping PWA to check if it's available — under BOTH source tokens so the
    // ping reaches old and new app builds alike.
    for (const source of ['plethora-extension', 'incrementum-extension']) {
      window.postMessage({
        source,
        action: 'ping',
        requestId: generateRequestId()
      }, '*');
    }
  }

  /**
   * Generate unique request ID
   */
  function generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Send message to PWA
   */
  // Source tokens sent during the compat window (rebrand task 3.6). Both
  // old and new app builds accept the legacy token; the new app dedupes by
  // requestId.
  const EXTENSION_SOURCE_TOKENS = ['plethora-extension', 'incrementum-extension'];

  function sendToPWA(message, callback) {
    const requestId = generateRequestId();

    if (callback) {
      pwaResponseHandlers.set(requestId, callback);
    }

    const send = () => {
      for (const source of EXTENSION_SOURCE_TOKENS) {
        window.postMessage({ source, ...message, requestId }, '*');
      }
    };

    if (isPWAAvailable) {
      send();
    } else {
      pwaMessageQueue.push({ message, callback });
    }
  }

  /**
   * Capture HTML content with computed styles from selection
   */
  function captureSelectionHTML(customRange) {
    let range = customRange;
    if (!range) {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return null;
      range = selection.getRangeAt(0);
    }

    try {
      const fragment = range.cloneContents();

      const tempDiv = document.createElement('div');
      tempDiv.appendChild(fragment.cloneNode(true));

      // Inline computed styles for visual fidelity
      const clonedElements = Array.from(tempDiv.querySelectorAll('*'));
      
      // Get all elements that intersect the range to retrieve original computed styles
      const originalElements = [];
      const container = range.commonAncestorContainer;
      const rootNode = container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement;
      if (rootNode) {
        const walker = document.createTreeWalker(
          rootNode,
          NodeFilter.SHOW_ELEMENT,
          {
            acceptNode: (node) => {
              if (range.intersectsNode(node)) {
                return NodeFilter.FILTER_ACCEPT;
              }
              return NodeFilter.FILTER_REJECT;
            }
          }
        );
        
        let node = walker.currentNode;
        if (node && node.nodeType === Node.ELEMENT_NODE && range.intersectsNode(node)) {
          originalElements.push(node);
        }
        while ((node = walker.nextNode())) {
          originalElements.push(node);
        }
      }

      clonedElements.forEach((clonedEl, i) => {
        if (clonedEl instanceof HTMLElement) {
          // Find matching original element
          let originalEl = null;
          for (let j = 0; j < originalElements.length; j++) {
            const candidate = originalElements[j];
            if (candidate.tagName === clonedEl.tagName && candidate.textContent.trim() === clonedEl.textContent.trim()) {
              originalEl = candidate;
              originalElements.splice(j, 1);
              break;
            }
          }

          if (!originalEl && originalElements.length > i) {
            originalEl = originalElements[i];
          }

          if (originalEl) {
            const computed = window.getComputedStyle(originalEl);
            const essentialStyles = [
              'display', 'margin', 'padding', 'border', 'border-radius',
              'list-style-type', 'white-space', 'overflow-x'
            ];

            const inlineStyles = essentialStyles
              .map((prop) => {
                const value = computed.getPropertyValue(prop);
                if (value && value !== 'none' && value !== 'normal' && value !== '0px') {
                  return `${prop}: ${value}`;
                }
                return null;
              })
              .filter(Boolean)
              .join('; ');

            if (inlineStyles) {
              clonedEl.setAttribute('style', inlineStyles);
            }
          }
        }
      });

      return tempDiv.innerHTML;
    } catch (error) {
      console.warn('[Content] Could not capture HTML:', error);
      return null;
    }
  }

  setupPWABridge();

  // State management
  let extractMode = false;
  let highlights = [];
  let highlightsVisible = true;
  let pageExtracts = [];
  
  loadPageExtracts();
  
  // Add visual indicator when page is saved
  function showSaveIndicator(message, type = 'success', options = {}) {
    const existing = document.getElementById('plethora-save-indicator');
    if (existing) {
      existing.remove();
    }

    const backgrounds = {
      success: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      error: 'linear-gradient(135deg, #e74c3c 0%, #c0392b 100%)'
    };

    const indicator = document.createElement('div');
    indicator.id = 'plethora-save-indicator';
    indicator.setAttribute('role', 'status');
    indicator.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${backgrounds[type] || backgrounds.success};
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      opacity: 0;
      transform: translateY(-10px);
      transition: all 0.3s ease;
      max-width: 340px;
    `;

    const line = document.createElement('div');
    line.textContent = message;
    indicator.appendChild(line);

    // Optional tag chips ("Saved to Image Registry" + assigned tags)
    if (Array.isArray(options.tags) && options.tags.length > 0) {
      const tagRow = document.createElement('div');
      tagRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;margin-top:8px;';
      for (const tag of options.tags.slice(0, 6)) {
        const chip = document.createElement('span');
        chip.textContent = `#${tag}`;
        chip.style.cssText =
          'background:rgba(255,255,255,0.22);border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600;';
        tagRow.appendChild(chip);
      }
      if (options.tags.length > 6) {
        const more = document.createElement('span');
        more.textContent = `+${options.tags.length - 6}`;
        more.style.cssText = 'font-size:11px;opacity:0.85;align-self:center;';
        tagRow.appendChild(more);
      }
      indicator.appendChild(tagRow);
    }

    // Optional "View in Plethora" action link
    if (options.actionLabel) {
      const actionRow = document.createElement('div');
      actionRow.style.cssText = 'margin-top:8px;';
      const action = document.createElement('button');
      action.type = 'button';
      action.textContent = options.actionLabel;
      action.style.cssText =
        'background:white;color:#4c51bf;border:none;border-radius:6px;padding:4px 12px;font-size:12px;font-weight:700;cursor:pointer;';
      action.addEventListener('click', () => {
        if (options.actionUrl) {
          window.open(options.actionUrl, '_blank');
        } else if (typeof options.onAction === 'function') {
          options.onAction();
        }
      });
      actionRow.appendChild(action);
      indicator.appendChild(actionRow);
    }

    document.body.appendChild(indicator);

    setTimeout(() => {
      indicator.style.opacity = '1';
      indicator.style.transform = 'translateY(0)';
    }, 10);

    // Animate out and remove
    setTimeout(() => {
      indicator.style.opacity = '0';
      indicator.style.transform = 'translateY(-10px)';
      setTimeout(() => {
        if (indicator.parentNode) {
          indicator.parentNode.removeChild(indicator);
        }
      }, 300);
    }, 4500);
  }

  function getPrimaryContentRoot() {
    const contentSelectors = [
      '#mw-content-text .mw-parser-output',
      '.mw-parser-output',
      'article',
      '[itemprop="articleBody"]',
      '.article-body',
      '.post-content',
      '.entry-content',
      '.article-content',
      '[role="main"]',
      '.main-content',
      '#content',
      '#main',
      'main',
      '.content'
    ];

    for (const selector of contentSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element;
      }
    }

    return document.body;
  }

  function normalizeArticleText(text) {
    return (text || '')
      .replace(/\r/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .trim()
      .slice(0, 250000);
  }

  function captureStyledArticleHtml(root) {
    if (!root) return '';

    const clone = root.cloneNode(true);
    const originalElements = [root, ...root.querySelectorAll('*')];
    const clonedElements = [clone, ...clone.querySelectorAll('*')];
    // Structural properties only — cosmetic properties (color, font, etc.)
    // are handled by the app's theme system at render time
    const styleProps = [
      'display',
      'flex-direction',
      'flex-wrap',
      'justify-content',
      'align-items',
      'grid-template-columns',
      'grid-template-rows',
      'margin-top',
      'margin-right',
      'margin-bottom',
      'margin-left',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'width',
      'max-width',
      'min-width',
      'border-collapse',
      'list-style-type',
      'white-space',
      'overflow-x'
    ];

    for (let i = 0; i < originalElements.length; i++) {
      const originalEl = originalElements[i];
      const clonedEl = clonedElements[i];
      if (!(originalEl instanceof HTMLElement) || !(clonedEl instanceof HTMLElement)) continue;

      Array.from(clonedEl.attributes).forEach((attr) => {
        if (attr.name.startsWith('on')) {
          clonedEl.removeAttribute(attr.name);
        }
      });

      const computed = window.getComputedStyle(originalEl);
      const inlineStyles = styleProps
        .map((prop) => {
          const value = computed.getPropertyValue(prop);
          if (!value || value === 'none' || value === 'normal' || value === 'rgba(0, 0, 0, 0)') {
            return null;
          }
          return `${prop}: ${value}`;
        })
        .filter(Boolean)
        .join('; ');

      if (inlineStyles) {
        clonedEl.setAttribute('style', inlineStyles);
      } else {
        clonedEl.removeAttribute('style');
      }

      if (originalEl instanceof HTMLAnchorElement) {
        const href = originalEl.href || originalEl.getAttribute('href');
        if (href) {
          clonedEl.setAttribute('href', href);
        }
      }

      if (originalEl instanceof HTMLImageElement) {
        const src = [
          originalEl.currentSrc,
          originalEl.getAttribute('data-src'),
          originalEl.getAttribute('data-lazy-src'),
          originalEl.getAttribute('data-original'),
          originalEl.getAttribute('src')
        ].find((candidate) => candidate && !candidate.startsWith('data:'));
        if (src) {
          try {
            clonedEl.setAttribute('src', new URL(src, window.location.href).href);
          } catch {
            clonedEl.setAttribute('src', src);
          }
        }
        clonedEl.removeAttribute('srcset');
        clonedEl.removeAttribute('data-src');
        clonedEl.removeAttribute('data-lazy-src');
        clonedEl.removeAttribute('data-original');
        clonedEl.setAttribute('loading', 'eager');
        clonedEl.setAttribute('referrerpolicy', 'no-referrer');
      }
    }

    if (clone instanceof HTMLElement) {
      return clone.outerHTML;
    }
    return clone.textContent || '';
  }

  function captureCompactArticleHtml(root) {
    if (!root) return '';

    const clone = root.cloneNode(true);
    if (!(clone instanceof HTMLElement)) {
      return clone.textContent || '';
    }

    const originalElements = [root, ...root.querySelectorAll('*')];
    const elements = [clone, ...clone.querySelectorAll('*')];
    for (let index = 0; index < elements.length; index++) {
      const originalElement = originalElements[index];
      const element = elements[index];
      if (!(element instanceof HTMLElement)) continue;

      if (element instanceof HTMLAnchorElement) {
        const originalAnchor = originalElement instanceof HTMLAnchorElement
          ? originalElement
          : null;
        const href = originalAnchor?.href || element.getAttribute('href');
        if (href) {
          try {
            element.setAttribute('href', new URL(href, window.location.href).href);
          } catch {
            // Keep the captured href when URL resolution is not possible.
          }
        }
      }

      if (element instanceof HTMLImageElement) {
        const originalImage = originalElement instanceof HTMLImageElement
          ? originalElement
          : null;
        const src = [
          originalImage?.currentSrc,
          originalImage?.getAttribute('data-src'),
          originalImage?.getAttribute('data-lazy-src'),
          originalImage?.getAttribute('data-original'),
          originalImage?.getAttribute('src'),
          element.getAttribute('src')
        ].find((candidate) => candidate && !candidate.startsWith('data:'));
        if (src) {
          try {
            element.setAttribute('src', new URL(src, window.location.href).href);
          } catch {
            element.setAttribute('src', src);
          }
        }
        element.setAttribute('loading', 'eager');
        element.setAttribute('referrerpolicy', 'no-referrer');
      }

      Array.from(element.attributes).forEach((attr) => {
        if (
          attr.name.startsWith('on') ||
          attr.name.startsWith('data-') ||
          attr.name === 'style' ||
          attr.name === 'srcset'
        ) {
          element.removeAttribute(attr.name);
        }
      });
    }

    clone.querySelectorAll(
      'script, iframe, object, embed, form, .mw-editsection, .mw-jump-link, .navbox, .metadata, .sistersitebox, .catlinks, .printfooter, .mw-indicators, .vector-page-toolbar'
    ).forEach((element) => element.remove());

    return clone.outerHTML;
  }

  function extractArticleImages(root) {
    if (!root) return [];

    const seen = new Set();
    const images = [];
    const nodes = root.querySelectorAll('img');

    for (const img of nodes) {
      const rawSrc = [
        img.currentSrc,
        img.getAttribute('data-src'),
        img.getAttribute('data-lazy-src'),
        img.getAttribute('data-original'),
        img.getAttribute('src')
      ].find((candidate) => candidate && !candidate.startsWith('data:')) || '';
      if (!rawSrc || rawSrc.startsWith('data:')) continue;

      let absoluteSrc = rawSrc;
      try {
        absoluteSrc = new URL(rawSrc, window.location.href).href;
      } catch {
        // Keep original src if URL resolution fails.
      }

      if (seen.has(absoluteSrc)) continue;
      seen.add(absoluteSrc);

      images.push({
        src: absoluteSrc,
        alt: (img.getAttribute('alt') || '').trim() || undefined
      });

      if (images.length >= 24) break;
    }

    return images;
  }

  // Small, structured evidence envelope for Smart Tagging. It intentionally
  // captures the nearest useful context instead of shipping a second copy of
  // the page body to the native endpoint.
  function captureBrowserContext(root, selectedText = '') {
    const headings = [];
    const anchor = selectedText ? window.getSelection()?.anchorNode : null;
    let node = anchor?.nodeType === Node.ELEMENT_NODE ? anchor : anchor?.parentElement;
    while (node && headings.length < 6) {
      const heading = node.matches?.('h1, h2, h3, h4, h5, h6')
        ? node
        : node.querySelector?.('h1, h2, h3, h4, h5, h6');
      const text = heading?.textContent?.trim();
      if (text && !headings.includes(text)) headings.unshift(text);
      node = node.parentElement;
    }
    if (headings.length === 0) {
      root?.querySelectorAll?.('h1, h2, h3, h4, h5, h6').forEach((heading) => {
        const text = heading.textContent?.trim();
        if (text && headings.length < 12) headings.push(text);
      });
    }

    const nearbyRoot = anchor?.parentElement || root;
    const nearbyText = (nearbyRoot?.textContent || root?.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
    const captionParts = Array.from((nearbyRoot || root || document).querySelectorAll?.('figcaption, img[alt], img[title]') || [])
      .slice(0, 12)
      .map((element) => element.textContent?.trim() || element.getAttribute?.('alt') || element.getAttribute?.('title') || '')
      .filter(Boolean);
    const author = document.querySelector('[rel="author"], [itemprop="author"], .author, .byline')?.textContent?.trim();
    const context = {
      version: 1,
      sourceUrl: window.location.href,
      domain: window.location.hostname.replace(/^www\./i, ''),
      pageTitle: document.title?.trim(),
      author,
      headingPath: headings.slice(0, 12),
      nearbyText: selectedText
        ? nearbyText.slice(Math.max(0, nearbyText.indexOf(selectedText) - 700), nearbyText.indexOf(selectedText) + selectedText.length + 700)
        : nearbyText.slice(0, 1800),
      captionAltText: captionParts.join(' ').slice(0, 1200),
      contentKind: root?.matches?.('article, [itemprop="articleBody"], main, [role="main"]') ? 'article' : 'page',
      selector: selectedText && window.getSelection()?.anchorNode ? getElementSelector(window.getSelection().anchorNode) : undefined
    };
    return globalThis.IncrementumExtensionShared?.normalizeCaptureContext
      ? globalThis.IncrementumExtensionShared.normalizeCaptureContext(context)
      : context;
  }

  // ---------------------------------------------------------------------------
  // Image capture for the Image Registry ("Save Image to Plethora")
  // ---------------------------------------------------------------------------

  function normalizeImageUrl(url) {
    if (!url) return '';
    try {
      return decodeURIComponent(new URL(url, window.location.href).href);
    } catch {
      return url;
    }
  }

  function findImageElement(imageUrl) {
    const target = normalizeImageUrl(imageUrl);
    if (!target) return null;

    // Canvas: Chrome exposes the serialized bitmap as the context-menu URL.
    if (target.startsWith('data:image/')) {
      const canvas = Array.from(document.querySelectorAll('canvas')).find((element) => {
        try {
          return normalizeImageUrl(element.toDataURL('image/png')) === target;
        } catch {
          return false;
        }
      });
      if (canvas) return { element: canvas, kind: 'canvas' };
    }

    const candidateUrls = (element) => {
      const urls = [];
      if (element.currentSrc) urls.push(element.currentSrc);
      if (element.src) urls.push(element.src);
      if (element.srcset) {
        for (const part of element.srcset.split(',')) {
          const candidate = part.trim().split(/\s+/)[0];
          if (candidate) urls.push(candidate);
        }
      }
      return urls;
    };

    const img = Array.from(document.images || []).find((element) =>
      candidateUrls(element).some((url) => normalizeImageUrl(url) === target)
    );
    if (img) return { element: img, kind: 'img' };

    const source = Array.from(document.querySelectorAll('picture source')).find((element) =>
      candidateUrls(element).some((url) => normalizeImageUrl(url) === target)
    );
    if (source) {
      const img = source.closest('picture')?.querySelector('img') || null;
      return { element: source, kind: 'source', img };
    }

    // CSS background-image match
    const cssMatch = Array.from(document.querySelectorAll('body *')).find((element) => {
      const background = getComputedStyle(element).backgroundImage;
      return background && background !== 'none' && background.includes(target);
    });
    if (cssMatch) return { element: cssMatch, kind: 'css' };

    return null;
  }

  function nearestCaption(element) {
    const figure = element?.closest?.('figure');
    const figcaption = figure?.querySelector?.('figcaption');
    if (figcaption?.textContent?.trim()) {
      return figcaption.textContent.replace(/\s+/g, ' ').trim().slice(0, 1200);
    }
    // Walk up a few ancestors looking for a short nearby paragraph.
    let node = element?.parentElement;
    for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (text && text.length <= 600) return text.slice(0, 1200);
    }
    return '';
  }

  function fileNameFromImageUrl(imageUrl) {
    try {
      const name = decodeURIComponent(new URL(imageUrl).pathname.split('/').pop() || '').trim();
      return name || undefined;
    } catch {
      return undefined;
    }
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(reader.result), { once: true });
      reader.addEventListener('error', () => reject(reader.error || new Error('Could not read image')), {
        once: true
      });
      reader.readAsDataURL(blob);
    });
  }

  function loadImageBitmap(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.addEventListener('load', () => resolve(image), { once: true });
      image.addEventListener('error', () => reject(new Error('The image could not be loaded from the page.')), {
        once: true
      });
      image.src = url;
    });
  }

  async function serializeImageToDataUrl(resolvedUrl) {
    // 1) Page-context fetch: runs with the page's cookies and CORS headers,
    //    so authenticated / same-site CDN images usually succeed.
    try {
      const response = await fetch(resolvedUrl, { credentials: 'include', mode: 'cors' });
      if (response.ok) {
        const blob = await response.blob();
        if (blob.type && !blob.type.startsWith('image/')) {
          throw new Error('The selected resource is not a supported image.');
        }
        if (blob.size === 0) throw new Error('The selected image is empty.');
        const dataUrl = await blobToDataUrl(blob);
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
          return { dataUrl, mimeType: blob.type || 'image/png' };
        }
      }
    } catch (error) {
      if (error?.message?.includes('not a supported image')) throw error;
      // Fall through to the canvas path for CORS-restricted resources.
    }

    // 2) Canvas export fallback: works for same-origin and CORS-enabled
    //    images; tainted canvases throw a clear, actionable error.
    try {
      const bitmap = await loadImageBitmap(resolvedUrl);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.naturalWidth || bitmap.width;
      canvas.height = bitmap.naturalHeight || bitmap.height;
      if (canvas.width === 0 || canvas.height === 0) {
        throw new Error('The image has no renderable size.');
      }
      const context = canvas.getContext('2d');
      context.drawImage(bitmap, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length <= 64) {
        throw new Error('The image is protected by the site and cannot be captured.');
      }
      return { dataUrl, mimeType: 'image/png' };
    } catch (error) {
      if (error?.name === 'SecurityError' || /tainted|protected/i.test(error?.message || '')) {
        throw new Error(
          'This image is protected by the site (CORS) and cannot be captured from the page. Try opening the image in a new tab first.'
        );
      }
      throw error;
    }
  }

  /**
   * Extract the image at `imageUrl` inside the page DOM, returning a base64
   * data URL plus provenance metadata (alt text, caption, file name, rendered
   * dimensions). Handles `<img>`, `<picture>`/`srcset`, `<canvas>`, and CSS
   * background images; validates the decoded size against the 7 MB transport
   * limit before returning.
   */
  async function extractImageForRegistry(imageUrl) {
    const shared = globalThis.IncrementumExtensionShared;
    if (!imageUrl) {
      throw new Error('Could not identify the selected image.');
    }

    const found = findImageElement(imageUrl);
    if (!found) {
      // Blob/data URLs or dynamically injected images: serialize by URL.
      const serialized = await serializeImageToDataUrl(imageUrl);
      return finalizeImageCapture(serialized, {
        alt: '',
        caption: '',
        fileName: fileNameFromImageUrl(imageUrl),
        width: undefined,
        height: undefined,
      });
    }

    const element = found.element;
    if (element instanceof HTMLCanvasElement) {
      return captureSerializedCanvas(element);
    }

    const resolvedUrl = element.currentSrc || element.src || imageUrl;
    const serialized = await serializeImageToDataUrl(resolvedUrl);
    return finalizeImageCapture(serialized, {
      alt: (element.getAttribute?.('alt') || element.getAttribute?.('title') || '').trim(),
      caption: nearestCaption(found.img || element),
      fileName: fileNameFromImageUrl(resolvedUrl) || fileNameFromImageUrl(imageUrl),
      width: element.naturalWidth || undefined,
      height: element.naturalHeight || undefined,
    });
  }

  async function captureSerializedCanvas(canvas) {
    let dataUrl;
    try {
      dataUrl = canvas.toDataURL('image/png');
    } catch {
      throw new Error('The canvas is protected by the site and cannot be captured.');
    }
    if (!dataUrl.startsWith('data:image/png;base64,') || dataUrl.length <= 64) {
      throw new Error('The canvas could not be exported.');
    }
    return finalizeImageCapture(
      { dataUrl, mimeType: 'image/png' },
      {
        alt: canvas.getAttribute?.('alt') || '',
        caption: nearestCaption(canvas),
        fileName: fileNameFromImageUrl(window.location.href) || 'canvas-image.png',
        width: canvas.width,
        height: canvas.height,
      }
    );
  }

  function finalizeImageCapture(serialized, provenance) {
    const shared = globalThis.IncrementumExtensionShared;
    const match = /^data:(image\/[\w.+-]+)?;base64,(.+)$/s.exec(serialized.dataUrl || '');
    const base64 = match ? match[2].replace(/\s+/g, '') : '';
    const decodedBytes = shared?.estimateBase64DecodedBytes
      ? shared.estimateBase64DecodedBytes(base64)
      : Math.floor((base64.length * 3) / 4);
    const sizeCheck = shared?.validateImageDecodedSize
      ? shared.validateImageDecodedSize(decodedBytes)
      : { ok: decodedBytes > 0 && decodedBytes <= 7 * 1024 * 1024 };
    if (!sizeCheck.ok) {
      throw new Error(sizeCheck.message || 'The selected image exceeds the size limit.');
    }
    return {
      success: true,
      dataUrl: serialized.dataUrl,
      mimeType: serialized.mimeType,
      fileName: provenance.fileName,
      alt: provenance.alt,
      caption: provenance.caption,
      width: provenance.width,
      height: provenance.height,
    };
  }

  function getPageContent() {
    try {
      const root = getPrimaryContentRoot();
      const text = normalizeArticleText(root?.innerText || root?.textContent || document.body.innerText || '');
      
      const isYoutube = window.location.hostname.includes('youtube.com') || window.location.hostname.includes('youtu.be');
      
      let htmlContent = '';
      let extractedImages = [];
      
      if (!isYoutube) {
        const isMediaWikiArticle =
          root?.matches?.('.mw-parser-output') ||
          root?.classList?.contains('mw-parser-output');
        // MediaWiki articles can contain thousands of nodes. Copying computed
        // styles onto every one balloons otherwise compact semantic HTML past
        // the transport limit and causes the app to receive text only.
        htmlContent = isMediaWikiArticle
          ? captureCompactArticleHtml(root)
          : captureStyledArticleHtml(root);
        extractedImages = extractArticleImages(root);
      }
      
      // Cap html_content size to 5MB to avoid HTTP 413 Payload Too Large
      const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5MB
      if (htmlContent && htmlContent.length > MAX_HTML_SIZE) {
        const compactHtml = captureCompactArticleHtml(root);
        if (compactHtml.length <= MAX_HTML_SIZE) {
          console.warn('[Content] Captured HTML was compacted to preserve article structure.');
          htmlContent = compactHtml;
        } else {
          console.warn('[Content] Captured HTML is too large, skipping html_content to avoid HTTP 413.');
          htmlContent = '';
        }
      }

      const title =
        document.title?.trim() ||
        root?.querySelector?.('h1')?.textContent?.trim() ||
        window.location.hostname;

      return {
        text,
        title,
        html_content: htmlContent || undefined,
        extracted_images: extractedImages,
        capture_context: captureBrowserContext(root)
      };
    } catch (error) {
      console.error('Error extracting page content:', error);
      return {
        text: normalizeArticleText(document.body.innerText || document.body.textContent || `Title: ${document.title}\nURL: ${window.location.href}`),
        title: document.title?.trim() || window.location.hostname,
        html_content: undefined,
        extracted_images: [],
        capture_context: captureBrowserContext(document.body)
      };
    }
  }

  // Smart text analysis
  function analyzeSelectedText(text) {
    const analysis = {
      wordCount: text.split(/\s+/).length,
      charCount: text.length,
      hasNumbers: /\d/.test(text),
      hasUrls: /https?:\/\/[^\s]+/.test(text),
      hasEmails: /\S+@\S+\.\S+/.test(text),
      language: detectLanguage(text),
      sentiment: analyzeSentiment(text),
      keywords: extractKeywords(text)
    };
    
    return analysis;
  }

  function detectLanguage(text) {
    // Simple language detection based on common words
    const patterns = {
      english: /\b(the|and|or|but|in|on|at|to|for|of|with|by)\b/gi,
      spanish: /\b(el|la|y|o|pero|en|de|con|por|para)\b/gi,
      french: /\b(le|la|et|ou|mais|dans|de|avec|par|pour)\b/gi,
      german: /\b(der|die|das|und|oder|aber|in|von|mit|für)\b/gi
    };
    
    let maxMatches = 0;
    let detectedLang = 'unknown';
    
    for (const [lang, pattern] of Object.entries(patterns)) {
      const matches = (text.match(pattern) || []).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        detectedLang = lang;
      }
    }
    
    return detectedLang;
  }

  function analyzeSentiment(text) {
    const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'like', 'happy', 'positive'];
    const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'dislike', 'sad', 'negative', 'wrong', 'problem'];
    
    const words = text.toLowerCase().split(/\s+/);
    let positiveCount = 0;
    let negativeCount = 0;
    
    words.forEach(word => {
      if (positiveWords.includes(word)) positiveCount++;
      if (negativeWords.includes(word)) negativeCount++;
    });
    
    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  function extractKeywords(text) {
    const stopWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those']);
    
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 3 && !stopWords.has(word));
    
    const wordCount = {};
    words.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });
    
    return Object.entries(wordCount)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([word]) => word);
  }

  // Enhanced extract creation with smart features
  function createSmartExtract(text, selection, options = {}) {
    const analysis = analyzeSelectedText(text);
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const context = container.textContent || container.innerText || '';

    // Calculate priority based on text analysis and user selection
    let calculatedPriority = calculateExtractPriority(text, analysis, options.priority);

    // Capture HTML content with computed styles for visual fidelity
    const html_content = captureSelectionHTML(range);

    const extractData = {
      id: generateExtractId(),
      text: text,
      // Rich HTML content for 1:1 visual fidelity
      html_content: html_content,
      context: context.substring(Math.max(0, context.indexOf(text) - 200),
                                context.indexOf(text) + text.length + 200),
      url: window.location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      selector: getElementSelector(range.startContainer),
      range: {
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        startContainer: getElementPath(range.startContainer),
        endContainer: getElementPath(range.endContainer)
      },
      analysis: analysis,
      tags: options.tags || [],
      category: options.category || 'general',
      priority: calculatedPriority,
      priority_source: options.priority_source || 'automatic',
      fsrs_data: {
        initial_difficulty: calculateInitialDifficulty(text, analysis),
        initial_stability: calculateInitialStability(text, analysis),
        estimated_review_time: estimateReviewTime(text, analysis)
      },
      capture_context: captureBrowserContext(getPrimaryContentRoot(), text)
    };

    pageExtracts.push(extractData);
    savePageExtracts();

    // Send to background script
    sendRuntimeMessage({
      action: 'saveExtractWithPriority',
      extract: extractData
    }).then((response) => {
      if (response && response.success) {
        chrome.storage.sync.get(['enableHighlights'], (settings) => {
          if (settings && settings.enableHighlights !== false) {
            highlightText(range, extractData.id, getPriorityColor(calculatedPriority));
          }
        });
        showSaveIndicator(`Extract queued (Priority: ${calculatedPriority}): "${text.substring(0, 50)}..."`);
      } else if (response?.error && response.error.includes('Extension context invalidated')) {
        showSaveIndicator('Extension reloaded. Reopen the page and try again.');
        pageExtracts = pageExtracts.filter(e => e.id !== extractData.id);
        savePageExtracts();
      } else {
        showSaveIndicator('Failed to save extract');
        pageExtracts = pageExtracts.filter(e => e.id !== extractData.id);
        savePageExtracts();
      }
    });

    // Clear selection
    selection.removeAllRanges();
  }

  // Calculate extract priority based on text analysis
  function calculateExtractPriority(text, analysis, userPriority = null) {
    // If user explicitly set priority, use it
    if (userPriority) {
      const priorityMap = {
        'low': 25,
        'normal': 50,
        'high': 75,
        'urgent': 95
      };
      return priorityMap[userPriority] || 50;
    }

    let priorityScore = 50; // Base priority

    // Adjust based on text length (medium-length content gets higher priority)
    const wordCount = analysis.wordCount;
    if (wordCount < 10) {
      priorityScore -= 10; // Very short text might be less important
    } else if (wordCount >= 10 && wordCount <= 50) {
      priorityScore += 15; // Good length for quick reviews
    } else if (wordCount > 200) {
      priorityScore -= 5; // Very long text might be overwhelming
    }

    // Adjust based on content type indicators
    if (analysis.hasNumbers) {
      priorityScore += 10; // Contains data/numbers
    }

    if (analysis.hasUrls || analysis.hasEmails) {
      priorityScore += 8; // Contains references or contact info
    }

    if (analysis.sentiment === 'positive') {
      priorityScore += 5; // Positive content might be more motivating
    } else if (analysis.sentiment === 'negative') {
      priorityScore += 8; // Negative content might be important warnings/problems
    }

    // Keyword relevance
    const importantKeywords = [
      'important', 'critical', 'urgent', 'key', 'essential', 'must',
      'remember', 'note', 'warning', 'caution', 'attention',
      'summary', 'conclusion', 'result', 'finding', 'discovery',
      'definition', 'concept', 'principle', 'rule', 'formula',
      'TODO', 'FIXME', 'NOTE', 'HACK', 'XXX'
    ];

    const textLower = text.toLowerCase();
    const foundKeywords = importantKeywords.filter(keyword =>
      textLower.includes(keyword.toLowerCase())
    );

    priorityScore += foundKeywords.length * 12; // +12 for each important keyword

    // Question or definition indicators
    if (textLower.includes('?') || textLower.includes('what is') ||
        textLower.includes('define') || textLower.includes('meaning of')) {
      priorityScore += 15; // Questions and definitions are high value
    }

    // Technical content indicators
    const technicalKeywords = [
      'algorithm', 'function', 'method', 'class', 'variable', 'code',
      'formula', 'equation', 'theorem', 'proof', 'hypothesis',
      'data', 'analysis', 'research', 'study', 'experiment',
      'API', 'database', 'system', 'architecture', 'design'
    ];

    const foundTechnicalKeywords = technicalKeywords.filter(keyword =>
      textLower.includes(keyword.toLowerCase())
    );

    priorityScore += foundTechnicalKeywords.length * 8; // +8 for each technical keyword

    // Ensure priority stays within bounds (1-100)
    return Math.max(1, Math.min(100, Math.round(priorityScore)));
  }

  // Calculate initial difficulty for FSRS based on text characteristics
  function calculateInitialDifficulty(text, analysis) {
    let difficulty = 5.0; // Base difficulty (medium)

    // Adjust based on text complexity
    const wordCount = analysis.wordCount;
    const avgWordLength = text.replace(/\s/g, '').length / wordCount;

    // Longer words and complex sentences increase difficulty
    if (avgWordLength > 6) {
      difficulty += 0.5;
    }

    // Technical content increases difficulty
    const technicalIndicators = ['algorithm', 'formula', 'equation', 'theorem', 'proof'];
    const hasTechnical = technicalIndicators.some(indicator =>
      text.toLowerCase().includes(indicator)
    );

    if (hasTechnical) {
      difficulty += 1.0;
    }

    // Numbers and data can make content harder to remember
    if (analysis.hasNumbers) {
      difficulty += 0.3;
    }

    // Multiple concepts increase difficulty
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    if (sentences.length > 3) {
      difficulty += 0.2 * (sentences.length - 3);
    }

    return Math.max(1.0, Math.min(10.0, difficulty));
  }

  // Calculate initial stability for FSRS
  function calculateInitialStability(text, analysis) {
    let stability = 5.0; // Base stability

    // Shorter content is easier to retain initially
    if (analysis.wordCount < 20) {
      stability += 2.0;
    } else if (analysis.wordCount > 100) {
      stability -= 1.0;
    }

    // Familiar concepts (common words) are easier to retain
    const commonWords = ['the', 'and', 'is', 'are', 'was', 'were', 'have', 'has', 'will', 'would'];
    const commonWordCount = commonWords.filter(word =>
      text.toLowerCase().includes(word)
    ).length;

    if (commonWordCount > 5) {
      stability += 0.5;
    }

    return Math.max(1.0, stability);
  }

  // Estimate review time in seconds
  function estimateReviewTime(text, analysis) {
    const baseReadingSpeed = 200; // words per minute
    const reviewMultiplier = 2; // Review takes longer than initial reading

    const readingTimeMinutes = analysis.wordCount / baseReadingSpeed;
    const reviewTimeSeconds = (readingTimeMinutes * reviewMultiplier) * 60;

    // Add time for comprehension based on complexity
    let comprehensionTime = 0;
    if (analysis.hasNumbers) {
      comprehensionTime += 10; // Extra time to process numbers/data
    }

    const technicalIndicators = ['algorithm', 'formula', 'equation', 'theorem'];
    const hasTechnical = technicalIndicators.some(indicator =>
      text.toLowerCase().includes(indicator)
    );

    if (hasTechnical) {
      comprehensionTime += 15; // Extra time for technical content
    }

    return Math.max(5, Math.round(reviewTimeSeconds + comprehensionTime));
  }

  function getPriorityColor(priority) {
    if (priority >= 80) {
      return '#ff6b6b'; // Red for urgent
    } else if (priority >= 60) {
      return '#ffd93d'; // Yellow for high
    } else if (priority >= 40) {
      return '#6bcf7f'; // Green for normal
    } else {
      return '#74c0fc'; // Blue for low
    }
  }

  // Show priority selection dialog
  function showPrioritySelectionDialog(text, selection) {
    const existingDialog = document.getElementById('plethora-priority-dialog');
    if (existingDialog) {
      existingDialog.remove();
    }

    const dialog = document.createElement('div');
    dialog.id = 'plethora-priority-dialog';
    dialog.innerHTML = `
      <div class="priority-dialog-content">
        <div class="priority-dialog-header">
          <h3>📚 Create Extract with Priority</h3>
          <button type="button" class="priority-dialog-close" data-action="close-dialog" aria-label="Close dialog">&times;</button>
        </div>
        <div class="priority-dialog-body">
          <div class="extract-preview">
            <strong>Selected Text:</strong>
            <p>"${escapeHtml(text.substring(0, 200))}${text.length > 200 ? '...' : ''}"</p>
          </div>
          <div class="priority-selection">
            <label><strong>Priority Level:</strong></label>
            <div class="priority-options">
              <label class="priority-option">
                <input type="radio" name="priority" value="urgent" checked>
                <span class="priority-urgent">🔴 Urgent (95)</span>
              </label>
              <label class="priority-option">
                <input type="radio" name="priority" value="high">
                <span class="priority-high">🟡 High (75)</span>
              </label>
              <label class="priority-option">
                <input type="radio" name="priority" value="normal">
                <span class="priority-normal">🟢 Normal (50)</span>
              </label>
              <label class="priority-option">
                <input type="radio" name="priority" value="low">
                <span class="priority-low">🔵 Low (25)</span>
              </label>
              <label class="priority-option">
                <input type="radio" name="priority" value="auto">
                <span class="priority-auto">🤖 Auto-calculate</span>
              </label>
            </div>
          </div>
          <div class="extract-tags">
            <label><strong>Tags (optional):</strong></label>
            <input type="text" id="extract-tags" placeholder="Enter tags separated by commas">
          </div>
        </div>
        <div class="priority-dialog-footer">
          <button type="button" class="priority-btn-cancel" data-action="close-dialog">Cancel</button>
          <button type="button" class="priority-btn-create" data-action="create-extract">Create Extract</button>
        </div>
      </div>
    `;

    dialog.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10003;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Add styles for dialog content
    if (!priorityDialogStyleAdded) {
      const style = document.createElement('style');
      style.id = 'plethora-priority-dialog-style';
      style.textContent = `
      .priority-dialog-content {
        background: white;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        max-width: 500px;
        width: 90%;
        max-height: 80vh;
        overflow-y: auto;
      }

      .priority-dialog-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 20px 10px 20px;
        border-bottom: 1px solid #eee;
      }

      .priority-dialog-header h3 {
        margin: 0;
        color: #333;
        font-size: 18px;
      }

      .priority-dialog-close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #999;
        padding: 0;
        width: 30px;
        height: 30px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .priority-dialog-close:hover {
        color: #333;
      }

      .priority-dialog-body {
        padding: 20px;
      }

      .extract-preview {
        margin-bottom: 20px;
      }

      .extract-preview p {
        background: #f8f9fa;
        padding: 12px;
        border-radius: 6px;
        border-left: 4px solid #007bff;
        margin: 8px 0 0 0;
        font-style: italic;
        color: #555;
      }

      .priority-selection {
        margin-bottom: 20px;
      }

      .priority-selection label {
        display: block;
        margin-bottom: 8px;
        color: #333;
      }

      .priority-options {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .priority-option {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        border-radius: 6px;
        cursor: pointer;
        transition: background-color 0.2s;
      }

      .priority-option:hover {
        background: #f0f0f0;
      }

      .priority-option input[type="radio"] {
        margin: 0;
      }

      .extract-tags {
        margin-bottom: 20px;
      }

      .extract-tags label {
        display: block;
        margin-bottom: 8px;
        color: #333;
      }

      .extract-tags input {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 6px;
        font-size: 14px;
      }

      .priority-dialog-footer {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        padding: 20px;
        border-top: 1px solid #eee;
        background: #f8f9fa;
        border-radius: 0 0 12px 12px;
      }

      .priority-btn-cancel, .priority-btn-create {
        padding: 10px 20px;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .priority-btn-cancel {
        background: #6c757d;
        color: white;
      }

      .priority-btn-cancel:hover {
        background: #5a6268;
      }

      .priority-btn-create {
        background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
        color: white;
      }

      .priority-btn-create:hover {
        background: linear-gradient(135deg, #0056b3 0%, #004085 100%);
      }
    `;
      document.head.appendChild(style);
      priorityDialogStyleAdded = true;
    }

    const selectionRange = selection.getRangeAt(0).cloneRange();

    const closeDialog = () => {
      dialog.remove();
    };

    dialog.addEventListener('click', (event) => {
      const action = event.target?.dataset?.action;
      if (action === 'close-dialog' || event.target === dialog) {
        closeDialog();
        return;
      }

      if (action === 'create-extract') {
        const selectedPriority = dialog.querySelector('input[name="priority"]:checked');
        const tagsInput = dialog.querySelector('#extract-tags');
        const options = {
          priority: selectedPriority ? selectedPriority.value : 'normal',
          priority_source: 'user_selected',
          tags: tagsInput ? tagsInput.value.split(',').map(tag => tag.trim()).filter(tag => tag) : []
        };

        const staticSelection = {
          getRangeAt(index) {
            if (index !== 0) {
              throw new Error('Only a single range is supported');
            }
            return selectionRange.cloneRange();
          },
          removeAllRanges() {}
        };

        createSmartExtract(text, staticSelection, options);
        closeDialog();
      }
    });

    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        closeDialog();
      }
    });

    document.body.appendChild(dialog);
    dialog.querySelector('input[name="priority"]:checked')?.focus();
  }

  // Page structure analysis
  function analyzePageStructure() {
    const structure = {
      headings: [],
      links: [],
      images: [],
      forms: [],
      tables: [],
      lists: [],
      codeBlocks: [],
      quotes: []
    };
    
    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(heading => {
      structure.headings.push({
        level: parseInt(heading.tagName.charAt(1)),
        text: heading.textContent.trim(),
        id: heading.id || null
      });
    });
    
    document.querySelectorAll('a[href]').forEach(link => {
      structure.links.push({
        text: link.textContent.trim(),
        href: link.href,
        external: !link.href.startsWith(window.location.origin)
      });
    });
    
    document.querySelectorAll('img').forEach(img => {
      structure.images.push({
        src: img.src,
        alt: img.alt || '',
        title: img.title || ''
      });
    });
    
    document.querySelectorAll('form').forEach(form => {
      const inputs = Array.from(form.querySelectorAll('input, textarea, select')).map(input => ({
        type: input.type || input.tagName.toLowerCase(),
        name: input.name || '',
        placeholder: input.placeholder || ''
      }));
      
      structure.forms.push({
        action: form.action || '',
        method: form.method || 'get',
        inputs: inputs
      });
    });
    
    document.querySelectorAll('table').forEach(table => {
      const headers = Array.from(table.querySelectorAll('th')).map(th => th.textContent.trim());
      const rowCount = table.querySelectorAll('tr').length;
      
      structure.tables.push({
        headers: headers,
        rowCount: rowCount
      });
    });
    
    document.querySelectorAll('ul, ol').forEach(list => {
      const items = Array.from(list.querySelectorAll('li')).map(li => li.textContent.trim());
      
      structure.lists.push({
        type: list.tagName.toLowerCase(),
        itemCount: items.length,
        items: items.slice(0, 5) // First 5 items
      });
    });
    
    document.querySelectorAll('pre, code').forEach(code => {
      structure.codeBlocks.push({
        language: code.className.match(/language-(\w+)/)?.[1] || 'unknown',
        content: code.textContent.trim().substring(0, 100)
      });
    });
    
    document.querySelectorAll('blockquote').forEach(quote => {
      structure.quotes.push({
        text: quote.textContent.trim(),
        cite: quote.cite || ''
      });
    });
    
    return structure;
  }

  // Reading time estimation
  function estimateReadingTime() {
    const text = document.body.innerText || document.body.textContent || '';
    const words = text.split(/\s+/).length;
    const wordsPerMinute = 200; // Average reading speed
    const minutes = Math.ceil(words / wordsPerMinute);
    
    return {
      words: words,
      minutes: minutes,
      readingTime: minutes === 1 ? '1 minute' : `${minutes} minutes`
    };
  }

  function enableExtractMode() {
    extractMode = true;
    document.body.style.cursor = 'crosshair';
    
    // Add extract mode indicator
    const indicator = document.createElement('div');
    indicator.id = 'plethora-extract-indicator';
    indicator.innerHTML = '📝 Extract Mode Active - Select text to create extracts';
    indicator.style.cssText = `
      position: fixed;
      top: 10px;
      left: 50%;
      transform: translateX(-50%);
      background: linear-gradient(135deg, #4caf50 0%, #45a049 100%);
      color: white;
      padding: 8px 16px;
      border-radius: 6px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 12px;
      font-weight: 500;
      z-index: 10001;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      animation: glow 2s infinite;
    `;
    
    // Add glow animation
    const style = document.createElement('style');
    style.textContent = `
      @keyframes glow {
        0%, 100% { box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3); }
        50% { box-shadow: 0 2px 20px rgba(76, 175, 80, 0.6); }
      }
    `;
    document.head.appendChild(style);
    
    document.body.appendChild(indicator);
    
    // Add selection listener
    document.addEventListener('mouseup', handleTextSelection);
  }

  function disableExtractMode() {
    extractMode = false;
    document.body.style.cursor = '';
    
    const indicator = document.getElementById('plethora-extract-indicator');
    if (indicator) {
      indicator.remove();
    }
    
    document.removeEventListener('mouseup', handleTextSelection);
  }

  function handleTextSelection(_event) {
    if (!extractMode) return;

    const selection = window.getSelection();
    const selectedText = selection.toString().trim();

    if (selectedText.length > 0) {
      chrome.storage.sync.get(['autoExtract'], (settings) => {
        if (settings && settings.autoExtract) {
          createExtract(selectedText, selection);
        } else {
          showPrioritySelectionDialog(selectedText, selection);
        }
      });
    }
  }

  function createExtract(text, selection) {
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const context = container.textContent || container.innerText || '';

    // Capture HTML content with computed styles for visual fidelity
    const html_content = captureSelectionHTML(range);

    const extractData = {
      id: generateExtractId(),
      text: text,
      // Rich HTML content for 1:1 visual fidelity
      html_content: html_content,
      context: context.substring(Math.max(0, context.indexOf(text) - 100),
                                context.indexOf(text) + text.length + 100),
      url: window.location.href,
      title: document.title,
      timestamp: new Date().toISOString(),
      selector: getElementSelector(range.startContainer),
      range: {
        startOffset: range.startOffset,
        endOffset: range.endOffset,
        startContainer: getElementPath(range.startContainer),
        endContainer: getElementPath(range.endContainer)
      },
      capture_context: captureBrowserContext(getPrimaryContentRoot(), text)
    };
    
    pageExtracts.push(extractData);
    savePageExtracts();
    
    // Send to background script
    chrome.runtime.sendMessage({
      action: 'saveExtract',
      extract: extractData
    }, (response) => {
      if (response && response.success) {
        chrome.storage.sync.get(['enableHighlights'], (settings) => {
          if (settings && settings.enableHighlights !== false) {
            highlightText(range, extractData.id);
          }
        });
        showSaveIndicator(`Extract saved: "${text.substring(0, 50)}..."`);
      } else {
        showSaveIndicator('Failed to save extract');
        pageExtracts = pageExtracts.filter(e => e.id !== extractData.id);
        savePageExtracts();
      }
    });
    
    // Clear selection
    selection.removeAllRanges();
  }

  function createQuickExtract() {
    const selection = window.getSelection();
    const selectedText = selection.toString().trim();
    
    if (selectedText.length === 0) {
      return { success: false, error: 'No text selected' };
    }
    
    createExtract(selectedText, selection);
    return { success: true };
  }

  // Register extracts created in the background (context-menu / quick-extract
  // command) into the authoritative pageExtracts source of truth so the
  // derived counter and per-host storage stay consistent with the popup flow.
  // The background only sends after the server confirmed the create, and this
  // is idempotent (dedupe by extract id), so re-delivery after a service-worker
  // restart never double-counts. Mirrors mergeExtracts in shared.js — keep the
  // two in sync by hand.
  function registerExtracts(records) {
    const incoming = Array.isArray(records) ? records : [];
    const seen = new Set(pageExtracts.map((item) => item && item.id).filter(Boolean));
    const added = [];
    const duplicates = [];
    for (const record of incoming) {
      if (!record || typeof record !== 'object' || !record.id) {
        continue;
      }
      if (seen.has(record.id)) {
        duplicates.push(record);
        continue;
      }
      seen.add(record.id);
      pageExtracts.push(record);
      added.push(record);
    }
    if (added.length > 0) {
      savePageExtracts();
    }
    return { success: true, added: added.length, duplicates: duplicates.length };
  }

  function highlightText(range, extractId, color = null) {
    try {
      const span = document.createElement('span');
      // Both classes during the compat window: pre-rebrand app CSS only
      // styles the legacy name, Plethora styles both.
      span.className = 'plethora-highlight incrementum-highlight';
      span.dataset.extractId = extractId;
      
      const highlightColor = color || '#ffd3a5';
      span.style.cssText = `
        background: linear-gradient(135deg, ${highlightColor} 0%, ${adjustColor(highlightColor, -20)} 100%);
        padding: 2px 4px;
        border-radius: 3px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        cursor: pointer;
        position: relative;
      `;
      
      // Add click handler for highlight
      span.addEventListener('click', (e) => {
        e.preventDefault();
        showExtractTooltip(span, extractId);
      });
      
      range.surroundContents(span);
      highlights.push({ element: span, extractId: extractId });
    } catch (error) {
      console.error('Error highlighting text:', error);
    }
  }

  function adjustColor(color, percent) {
    // Simple color adjustment function
    const num = parseInt(color.replace("#", ""), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return "#" + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 +
      (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 +
      (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
  }

  function showExtractTooltip(element, extractId) {
    const extract = pageExtracts.find(e => e.id === extractId);
    if (!extract) return;

    const existingTooltip = document.getElementById('plethora-extract-tooltip');
    if (existingTooltip) {
      existingTooltip.remove();
    }

    const tooltip = document.createElement('div');
    tooltip.id = 'plethora-extract-tooltip';
    tooltip.innerHTML = `
      <div class="tooltip-content">
        <div class="tooltip-text">${escapeHtml(extract.text)}</div>
        <div class="tooltip-meta">
          <span>Created: ${new Date(extract.timestamp).toLocaleString()}</span>
          <button class="tooltip-delete" data-extract-id="${extractId}">🗑️ Delete</button>
        </div>
      </div>
    `;
    tooltip.style.cssText = `
      position: absolute;
      background: rgba(0, 0, 0, 0.9);
      color: white;
      padding: 12px;
      border-radius: 8px;
      font-size: 12px;
      max-width: 300px;
      z-index: 10002;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `;

    // Position tooltip
    const rect = element.getBoundingClientRect();
    tooltip.style.left = rect.left + 'px';
    tooltip.style.top = (rect.bottom + 5) + 'px';

    document.body.appendChild(tooltip);

    // Add delete handler
    tooltip.querySelector('.tooltip-delete').addEventListener('click', () => {
      deleteExtractById(extractId);
      tooltip.remove();
    });

    // Auto-hide after 5 seconds
    setTimeout(() => {
      if (tooltip.parentNode) {
        tooltip.remove();
      }
    }, 5000);
  }

  function deleteExtractById(extractId) {
    pageExtracts = pageExtracts.filter(e => e.id !== extractId);
    savePageExtracts();

    const highlight = highlights.find(h => h.extractId === extractId);
    if (highlight) {
      const element = highlight.element;
      const parent = element.parentNode;
      if (parent) {
        // Replace highlighted element with its text content
        parent.replaceChild(document.createTextNode(element.textContent), element);
        parent.normalize(); // Merge adjacent text nodes
      }
      highlights = highlights.filter(h => h.extractId !== extractId);
    }

    showSaveIndicator('Extract deleted');
  }

  function toggleHighlights() {
    highlightsVisible = !highlightsVisible;
    
    highlights.forEach(highlight => {
      highlight.element.style.display = highlightsVisible ? 'inline' : 'none';
    });
    
    return { success: true, enabled: highlightsVisible };
  }

  function getPageStats() {
    return {
      success: true,
      extractsCount: pageExtracts.length,
      highlightsCount: highlights.length,
      extracts: pageExtracts
    };
  }

  function highlightExtractById(extractId) {
    const extract = pageExtracts.find(e => e.id === extractId);
    if (!extract) {
      return { success: false, error: 'Extract not found' };
    }

    // Try to find and highlight the text
    const textNodes = getTextNodes(document.body);
    for (const node of textNodes) {
      const text = node.textContent;
      const index = text.indexOf(extract.text);
      if (index !== -1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + extract.text.length);
        
        // Temporarily highlight
        const span = document.createElement('span');
        span.style.cssText = `
          background: yellow;
          animation: flash 2s ease-in-out;
        `;
        
        try {
          range.surroundContents(span);
          
          // Add flash animation
          const style = document.createElement('style');
          style.textContent = `
            @keyframes flash {
              0%, 100% { background: yellow; }
              50% { background: orange; }
            }
          `;
          document.head.appendChild(style);
          
          setTimeout(() => {
            if (span.parentNode) {
              span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
            }
            if (style.parentNode) {
              style.remove();
            }
          }, 2000);
          
          span.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          return { success: true };
        } catch (error) {
          console.error('Error highlighting extract:', error);
        }
      }
    }

    return { success: false, error: 'Text not found on page' };
  }

  function clearAllExtracts() {
    highlights.forEach(highlight => {
      const element = highlight.element;
      const parent = element.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(element.textContent), element);
        parent.normalize();
      }
    });

    // Clear arrays
    pageExtracts = [];
    highlights = [];
    
    // Clear storage
    savePageExtracts();

    return { success: true };
  }

  function getElementSelector(node) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    if (!element) return '';
    if (element.id) {
      return `#${element.id}`;
    }
    
    if (element.className && typeof element.className === 'string') {
      return `.${element.className.split(' ')[0]}`;
    }
    
    return element.tagName ? element.tagName.toLowerCase() : '';
  }

  function getElementPath(node) {
    let element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const path = [];
    while (element && element.nodeType === Node.ELEMENT_NODE) {
      let selector = element.tagName.toLowerCase();
      if (element.id) {
        selector += '#' + element.id;
        path.unshift(selector);
        break;
      } else {
        let sibling = element;
        let nth = 1;
        while ((sibling = sibling.previousElementSibling)) {
          if (sibling.tagName.toLowerCase() === selector) nth++;
        }
        if (nth !== 1) selector += `:nth-of-type(${nth})`;
      }
      path.unshift(selector);
      element = element.parentElement;
    }
    return path.join(' > ');
  }

  function getTextNodes(element) {
    const textNodes = [];
    const walker = document.createTreeWalker(
      element,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim()) {
        textNodes.push(node);
      }
    }
    
    return textNodes;
  }

  function generateExtractId() {
    return 'extract_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function pageExtractsKeys() {
    return {
      current: `plethora_extracts_${window.location.hostname}`,
      legacy: `incrementum_extracts_${window.location.hostname}`
    };
  }

  function savePageExtracts() {
    const { current, legacy } = pageExtractsKeys();
    localStorage.setItem(current, JSON.stringify(pageExtracts));
    // Remove the legacy key only after the new one round-trips.
    try {
      if (localStorage.getItem(current) !== null && localStorage.getItem(legacy) !== null) {
        localStorage.removeItem(legacy);
      }
    } catch (err) {
      // best-effort cleanup
    }
  }

  function loadPageExtracts() {
    try {
      const { current, legacy } = pageExtractsKeys();
      const stored = localStorage.getItem(current) ?? localStorage.getItem(legacy);
      if (stored) {
        pageExtracts = JSON.parse(stored);
        
        // Restore highlights for existing extracts if enabled
        chrome.storage.sync.get(['enableHighlights'], (settings) => {
          if (settings && settings.enableHighlights !== false) {
            pageExtracts.forEach(extract => {
              restoreHighlight(extract);
            });
          }
        });
      }
    } catch (error) {
      console.error('Error loading page extracts:', error);
      pageExtracts = [];
    }
  }

  function restoreHighlight(extract) {
    // Try to find and restore highlight for existing extract
    const textNodes = getTextNodes(document.body);
    for (const node of textNodes) {
      const text = node.textContent;
      const index = text.indexOf(extract.text);
      if (index !== -1) {
        try {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + extract.text.length);
          highlightText(range, extract.id);
          break;
        } catch (error) {
          console.warn('[Content] Could not restore highlight for extract:', error.message);
        }
      }
    }
  }

  function showAIResult(operation, result, state = 'result', error = '') {
    document.getElementById('plethora-ai-result-host')?.remove();

    const host = document.createElement('div');
    host.id = 'plethora-ai-result-host';
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147483647';
    const shadow = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .backdrop {
        position: fixed; inset: 0; display: grid; place-items: center;
        padding: 24px; background: rgba(2, 6, 23, .72);
        backdrop-filter: blur(8px);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .panel {
        width: min(620px, 100%); max-height: min(720px, 88vh);
        display: flex; flex-direction: column; overflow: hidden;
        color: #e5e7eb; background: #111827;
        border: 1px solid rgba(148, 163, 184, .3); border-radius: 16px;
        box-shadow: 0 24px 80px rgba(0, 0, 0, .5);
      }
      .header {
        display: flex; align-items: center; justify-content: space-between;
        gap: 16px; padding: 16px 18px; border-bottom: 1px solid rgba(148, 163, 184, .2);
      }
      h2 { margin: 0; color: #f8fafc; font-size: 17px; font-weight: 700; }
      .close {
        width: 34px; height: 34px; border: 0; border-radius: 9px;
        color: #cbd5e1; background: rgba(148, 163, 184, .12);
        font-size: 22px; line-height: 1; cursor: pointer;
      }
      .body { padding: 18px; overflow: auto; }
      .summary { white-space: pre-wrap; font-size: 15px; line-height: 1.65; color: #e2e8f0; }
      .saved {
        margin-bottom: 14px; padding: 10px 12px; border-radius: 10px;
        color: #86efac; background: rgba(34, 197, 94, .12);
        border: 1px solid rgba(34, 197, 94, .3); font-size: 13px;
      }
      .card {
        padding: 14px; margin-bottom: 12px; border-radius: 12px;
        background: rgba(30, 41, 59, .8); border: 1px solid rgba(148, 163, 184, .2);
      }
      .label {
        margin-bottom: 5px; color: #94a3b8; font-size: 10px;
        font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
      }
      .question { margin-bottom: 12px; color: #f8fafc; font-size: 14px; font-weight: 650; line-height: 1.45; }
      .answer { color: #cbd5e1; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
      .empty { color: #fca5a5; font-size: 14px; }
      .progress { display: flex; align-items: center; gap: 14px; color: #e2e8f0; font-size: 15px; }
      .spinner {
        width: 22px; height: 22px; flex: 0 0 auto; border-radius: 50%;
        border: 3px solid rgba(148, 163, 184, .28); border-top-color: #f59e0b;
        animation: plethora-spin .8s linear infinite;
      }
      .error {
        padding: 12px 14px; border-radius: 10px; color: #fecaca;
        background: rgba(239, 68, 68, .11); border: 1px solid rgba(239, 68, 68, .3);
        font-size: 14px; line-height: 1.55; white-space: pre-wrap;
      }
      .help { margin-top: 14px; color: #cbd5e1; font-size: 13px; line-height: 1.55; }
      @keyframes plethora-spin { to { transform: rotate(360deg); } }
    `;

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Plethora AI result');

    const header = document.createElement('div');
    header.className = 'header';
    const title = document.createElement('h2');
    title.textContent = state === 'progress'
      ? (operation === 'flashcards' ? '🧠 Generating flashcards…' : '✨ Summarizing selection…')
      : state === 'error'
        ? 'Plethora AI could not finish'
        : operation === 'flashcards'
          ? '🧠 Plethora AI Flashcards'
          : '✨ Plethora AI Summary';
    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';

    const body = document.createElement('div');
    body.className = 'body';
    const remove = () => {
      document.removeEventListener('keydown', handleEscape, true);
      host.remove();
    };
    close.addEventListener('click', remove);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) remove();
    });
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        remove();
      }
    };
    document.addEventListener('keydown', handleEscape, true);

    if (state === 'progress') {
      const progress = document.createElement('div');
      progress.className = 'progress';
      const spinner = document.createElement('span');
      spinner.className = 'spinner';
      const message = document.createElement('span');
      message.textContent = operation === 'flashcards'
        ? 'Creating and saving flashcards in Plethora. This can take a moment.'
        : 'Generating a summary. This can take a moment.';
      progress.append(spinner, message);
      body.appendChild(progress);
    } else if (state === 'error') {
      const errorMessage = document.createElement('div');
      errorMessage.className = 'error';
      errorMessage.textContent = error || 'Plethora AI request failed.';
      const help = document.createElement('div');
      help.className = 'help';
      help.textContent = 'Make sure Plethora is open, its Browser Extension Server is running on the configured port, and an AI provider is configured in Settings.';
      body.append(errorMessage, help);
    } else if (operation === 'flashcards') {
      const cards = Array.isArray(result?.flashcards) ? result.flashcards : [];
      const savedCount = cards.filter((card) => card?.saved_id).length;
      const saved = document.createElement('div');
      saved.className = savedCount > 0 ? 'saved' : 'empty';
      saved.textContent = savedCount > 0
        ? `${savedCount} flashcard${savedCount === 1 ? '' : 's'} saved to Plethora.`
        : 'No flashcards were saved.';
      body.appendChild(saved);

      cards.forEach((card, index) => {
        const cardElement = document.createElement('article');
        cardElement.className = 'card';
        const questionLabel = document.createElement('div');
        questionLabel.className = 'label';
        questionLabel.textContent = `Question ${index + 1}`;
        const question = document.createElement('div');
        question.className = 'question';
        question.textContent = card?.question || '';
        const answerLabel = document.createElement('div');
        answerLabel.className = 'label';
        answerLabel.textContent = 'Answer';
        const answer = document.createElement('div');
        answer.className = 'answer';
        answer.textContent = card?.answer || '';
        cardElement.append(questionLabel, question, answerLabel, answer);
        body.appendChild(cardElement);
      });
    } else {
      const summary = document.createElement('div');
      summary.className = result?.summary ? 'summary' : 'empty';
      summary.textContent = result?.summary || 'Plethora AI did not return a summary.';
      body.appendChild(summary);
    }

    header.append(title, close);
    panel.append(header, body);
    backdrop.appendChild(panel);
    shadow.append(style, backdrop);
    document.documentElement.appendChild(host);
    close.focus();
  }

  function showImageOcclusionEditor(data) {
    document.getElementById('plethora-image-occlusion-host')?.remove();

    const host = document.createElement('div');
    host.id = 'plethora-image-occlusion-host';
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147483647';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      .backdrop {
        position: fixed; inset: 0; display: grid; place-items: center; padding: 20px;
        background: rgba(2, 6, 23, .8); backdrop-filter: blur(8px);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .panel {
        width: min(900px, 100%); max-height: 94vh; overflow: auto;
        color: #e5e7eb; background: #111827; border: 1px solid rgba(148,163,184,.32);
        border-radius: 16px; box-shadow: 0 24px 80px rgba(0,0,0,.55);
      }
      .header { display:flex; align-items:center; justify-content:space-between; padding:16px 18px; border-bottom:1px solid rgba(148,163,184,.2); }
      h2 { margin:0; color:#f8fafc; font-size:17px; }
      .close { width:34px; height:34px; border:0; border-radius:9px; color:#cbd5e1; background:rgba(148,163,184,.12); font-size:22px; cursor:pointer; }
      .body { padding:18px; }
      .hint { margin:0 0 14px; color:#cbd5e1; font-size:13px; line-height:1.5; }
      .viewport { display:flex; justify-content:center; padding:12px; border-radius:12px; background:#020617; overflow:auto; }
      .stage { position:relative; display:inline-block; line-height:0; user-select:none; touch-action:none; cursor:crosshair; }
      .stage img { display:block; max-width:min(780px, 82vw); max-height:48vh; width:auto; height:auto; pointer-events:none; }
      .drawing { position:absolute; inset:0; z-index:1; cursor:crosshair; }
      .region {
        position:absolute; border:2px solid #f59e0b; background:rgba(15,23,42,.9);
        box-sizing:border-box; pointer-events:none; box-shadow:0 0 0 1px rgba(0,0,0,.45);
      }
      .region.preview { border-style:dashed; background:rgba(245,158,11,.48); }
      .fields { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:14px; }
      label { display:block; color:#cbd5e1; font-size:12px; font-weight:650; }
      input { width:100%; margin-top:6px; padding:10px 11px; box-sizing:border-box; border:1px solid rgba(148,163,184,.35); border-radius:9px; color:#f8fafc; background:#0f172a; font:inherit; }
      .actions { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:14px; }
      .tools, .submit { display:flex; gap:8px; }
      button { border:0; border-radius:9px; padding:9px 13px; color:#e2e8f0; background:#334155; font:600 13px inherit; cursor:pointer; }
      button.primary { color:#111827; background:#f59e0b; }
      button:disabled { opacity:.45; cursor:not-allowed; }
      .status { min-height:20px; margin-top:10px; color:#fca5a5; font-size:13px; }
      @media (max-width: 650px) { .fields { grid-template-columns:1fr; } .actions { align-items:stretch; flex-direction:column; } }
    `;

    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    const header = document.createElement('div');
    header.className = 'header';
    const title = document.createElement('h2');
    title.textContent = '🖼️ Create image occlusion card';
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'Close');
    header.append(title, close);

    const body = document.createElement('div');
    body.className = 'body';
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent =
      'Click and drag to draw a rectangular mask. The shaded area will be hidden during review.';
    const viewport = document.createElement('div');
    viewport.className = 'viewport';
    const stage = document.createElement('div');
    stage.className = 'stage';
    const image = document.createElement('img');
    image.src = data.imageUrl;
    image.alt = data.pageTitle || 'Image selected for occlusion';
    const drawing = document.createElement('div');
    drawing.className = 'drawing';
    stage.append(image, drawing);
    viewport.appendChild(stage);

    const fields = document.createElement('div');
    fields.className = 'fields';
    const promptLabel = document.createElement('label');
    promptLabel.textContent = 'Prompt';
    const prompt = document.createElement('input');
    prompt.value = 'Identify the hidden part of this image.';
    prompt.placeholder = 'What should you recall?';
    promptLabel.appendChild(prompt);
    const answerLabel = document.createElement('label');
    answerLabel.textContent = 'Answer / hidden label';
    const answer = document.createElement('input');
    answer.placeholder = 'Optional answer shown after reveal';
    answerLabel.appendChild(answer);
    fields.append(promptLabel, answerLabel);

    const actions = document.createElement('div');
    actions.className = 'actions';
    const tools = document.createElement('div');
    tools.className = 'tools';
    const undo = document.createElement('button');
    undo.textContent = 'Undo region';
    const clear = document.createElement('button');
    clear.textContent = 'Clear';
    tools.append(undo, clear);
    const submitGroup = document.createElement('div');
    submitGroup.className = 'submit';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    const save = document.createElement('button');
    save.className = 'primary';
    save.textContent = 'Create card';
    submitGroup.append(cancel, save);
    actions.append(tools, submitGroup);
    const status = document.createElement('div');
    status.className = 'status';

    body.append(hint, viewport, fields, actions, status);
    panel.append(header, body);
    backdrop.appendChild(panel);
    shadow.append(style, backdrop);
    document.documentElement.appendChild(host);

    let regions = [];
    let start = null;
    let previewRegion = null;
    let activePointerId = null;
    const renderRegions = () => {
      drawing.replaceChildren();
      const renderRegion = (region, preview = false) => {
        const element = document.createElement('div');
        element.className = preview ? 'region preview' : 'region';
        element.style.left = `${region.x}%`;
        element.style.top = `${region.y}%`;
        element.style.width = `${region.width}%`;
        element.style.height = `${region.height}%`;
        drawing.appendChild(element);
      };
      regions.forEach((region) => renderRegion(region));
      if (previewRegion) {
        renderRegion(previewRegion, true);
      }
      undo.disabled = regions.length === 0;
      clear.disabled = regions.length === 0;
    };
    const point = (event) => {
      const rect = drawing.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
        y: Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
      };
    };
    const regionBetween = (first, second) => ({
      x: Math.min(first.x, second.x),
      y: Math.min(first.y, second.y),
      width: Math.abs(second.x - first.x),
      height: Math.abs(second.y - first.y)
    });
    drawing.addEventListener('pointerdown', (event) => {
      if (!image.complete || !image.naturalWidth || (event.pointerType === 'mouse' && event.button !== 0)) {
        return;
      }
      event.preventDefault();
      start = point(event);
      previewRegion = { x: start.x, y: start.y, width: 0, height: 0 };
      activePointerId = event.pointerId;
      drawing.setPointerCapture(event.pointerId);
      renderRegions();
    });
    drawing.addEventListener('pointermove', (event) => {
      if (!start || event.pointerId !== activePointerId) return;
      event.preventDefault();
      previewRegion = regionBetween(start, point(event));
      renderRegions();
    });
    const finishDrawing = (event, commit) => {
      if (!start || event.pointerId !== activePointerId) return;
      event.preventDefault();
      const completedRegion = regionBetween(start, point(event));
      if (drawing.hasPointerCapture(event.pointerId)) {
        drawing.releasePointerCapture(event.pointerId);
      }
      start = null;
      previewRegion = null;
      activePointerId = null;
      if (commit && completedRegion.width >= 1 && completedRegion.height >= 1) {
        regions.push({
          id: `region-${Date.now()}-${regions.length + 1}`,
          ...completedRegion,
          label: answer.value.trim() || undefined
        });
      }
      renderRegions();
    };
    drawing.addEventListener('pointerup', (event) => finishDrawing(event, true));
    drawing.addEventListener('pointercancel', (event) => finishDrawing(event, false));

    const remove = () => host.remove();
    close.addEventListener('click', remove);
    cancel.addEventListener('click', remove);
    undo.addEventListener('click', () => {
      regions = regions.slice(0, -1);
      renderRegions();
    });
    clear.addEventListener('click', () => {
      regions = [];
      renderRegions();
    });
    save.addEventListener('click', async () => {
      if (regions.length === 0) {
        status.textContent = 'Draw at least one region on the image.';
        return;
      }
      if (!prompt.value.trim()) {
        status.textContent = 'Enter a prompt for the card.';
        prompt.focus();
        return;
      }
      save.disabled = true;
      save.textContent = 'Saving…';
      status.textContent = '';
      try {
        const url = new URL(data.imageUrl, window.location.href);
        const fileName = decodeURIComponent(url.pathname.split('/').pop() || 'browser-image');
        let transferableImageUrl = data.imageUrl;
        if (url.protocol === 'blob:') {
          const imageResponse = await fetch(data.imageUrl);
          if (!imageResponse.ok) {
            throw new Error('Could not read this page-local image.');
          }
          const blob = await imageResponse.blob();
          transferableImageUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.addEventListener('load', () => resolve(reader.result), { once: true });
            reader.addEventListener('error', () => reject(new Error('Could not prepare this image.')), {
              once: true
            });
            reader.readAsDataURL(blob);
          });
        }
        const result = await chrome.runtime.sendMessage({
          action: 'createImageOcclusionCard',
          data: {
            imageUrl: transferableImageUrl,
            pageUrl: data.pageUrl || window.location.href,
            fileName,
            question: prompt.value.trim(),
            answer: answer.value.trim(),
            regions,
            capture_context: captureBrowserContext(getPrimaryContentRoot(), prompt.value.trim()),
            title: document.title
          }
        });
        if (!result?.success) {
          throw new Error(result?.error || 'Plethora could not save the card.');
        }
        if (!host.isConnected) return;
        remove();
        showSaveIndicator('Image occlusion card saved to Plethora.', 'success');
      } catch (error) {
        status.textContent = error?.message || 'Could not save image occlusion card.';
        save.disabled = false;
        save.textContent = 'Create card';
      }
    });
    renderRegions();
    prompt.focus();
  }
  
  // Listen for messages from background script and popup
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message.action) {
      case 'showSaveIndicator':
        showSaveIndicator(message.text || 'Saved to Plethora', message.type || 'success', {
          tags: message.tags,
          actionLabel: message.actionLabel,
          actionUrl: message.actionUrl
        });
        sendResponse({ success: true });
        break;

      case 'showAIResult':
        showAIResult(message.operation, message.result);
        sendResponse({ success: true });
        break;

      case 'showAIProgress':
        showAIResult(message.operation, null, 'progress');
        sendResponse({ success: true });
        break;

      case 'showAIError':
        showAIResult(message.operation, null, 'error', message.error);
        sendResponse({ success: true });
        break;

      case 'showImageOcclusionEditor':
        showImageOcclusionEditor(message);
        sendResponse({ success: true });
        break;

      case 'showImageOcclusionSaved':
        document.getElementById('plethora-image-occlusion-host')?.remove();
        showSaveIndicator('Image occlusion card saved to Plethora.', 'success');
        sendResponse({ success: true });
        break;
        
      case 'enableExtractMode':
        enableExtractMode();
        sendResponse({ success: true });
        break;
        
      case 'disableExtractMode':
        disableExtractMode();
        sendResponse({ success: true });
        break;
        
      case 'createQuickExtract':
        const result = createQuickExtract();
        sendResponse(result);
        break;

      case 'getSelection': {
        const selectionText = window.getSelection().toString().trim();
        if (selectionText.length > 0) {
          sendResponse({ success: true, text: selectionText });
        } else {
          sendResponse({ success: false, text: '' });
        }
        break;
      }
        
      case 'toggleHighlights':
        const toggleResult = toggleHighlights();
        sendResponse(toggleResult);
        break;
        
      case 'toggleExtractMode':
        if (extractMode) {
          disableExtractMode();
          sendResponse({ success: true, enabled: false });
        } else {
          enableExtractMode();
          sendResponse({ success: true, enabled: true });
        }
        break;

      case 'getExtractModeStatus':
        sendResponse({ success: true, extractMode: extractMode });
        break;

      case 'getPageStats':
        const stats = getPageStats();
        sendResponse(stats);
        break;

      case 'registerExtracts':
        sendResponse(registerExtracts(message.extracts || (message.extract ? [message.extract] : [])));
        break;

      case 'highlightExtract':
        const highlightResult = highlightExtractById(message.extract.id);
        sendResponse(highlightResult);
        break;

      case 'deleteExtract':
        deleteExtractById(message.extract.id);
        sendResponse({ success: true });
        break;

      case 'clearAllExtracts':
        const clearResult = clearAllExtracts();
        sendResponse(clearResult);
        break;

      case 'getPageContent':
        const content = getPageContent();
        sendResponse({ success: true, content: content.text, page: content });
        break;

      case 'getCaptureContext':
        sendResponse({
          success: true,
          capture_context: captureBrowserContext(getPrimaryContentRoot(), message.selectedText || '')
        });
        break;

      case 'serializeImageUrl':
        (async () => {
          try {
            const response = await fetch(message.imageUrl);
            if (!response.ok) throw new Error(`Image request failed (${response.status})`);
            const blob = await response.blob();
            const dataUrl = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.addEventListener('load', () => resolve(reader.result), { once: true });
              reader.addEventListener('error', () => reject(reader.error || new Error('Could not read image')), {
                once: true
              });
              reader.readAsDataURL(blob);
            });
            sendResponse({ success: true, dataUrl });
          } catch (error) {
            sendResponse({ success: false, error: error?.message || 'Could not read image' });
          }
        })();
        break;

      case 'extractImageForRegistry':
        (async () => {
          try {
            const result = await extractImageForRegistry(message.imageUrl);
            sendResponse(result);
          } catch (error) {
            sendResponse({ success: false, error: error?.message || 'Could not capture the selected image.' });
          }
        })();
        break;

      case 'analyzePageStructure':
        const structure = analyzePageStructure();
        sendResponse({ success: true, structure: structure });
        break;

      case 'getReadingTime':
        const readingTime = estimateReadingTime();
        sendResponse({ success: true, readingTime: readingTime });
        break;

      case 'createSmartExtract':
        const selection = window.getSelection();
        const selectedText = selection.toString().trim();

        if (selectedText.length === 0) {
          sendResponse({ success: false, error: 'No text selected' });
        } else {
          createSmartExtract(selectedText, selection, message.options || {});
          sendResponse({ success: true });
        }
        break;

      case 'createPriorityExtract':
        const prioritySelection = window.getSelection();
        const priorityText = prioritySelection.toString().trim();

        if (priorityText.length === 0) {
          sendResponse({ success: false, error: 'No text selected' });
        } else {
          showPrioritySelectionDialog(priorityText, prioritySelection);
          sendResponse({ success: true });
        }
        break;

      case 'analyzeSelection':
        const currentSelection = window.getSelection();
        const currentText = currentSelection.toString().trim();
        
        if (currentText.length === 0) {
          sendResponse({ success: false, error: 'No text selected' });
        } else {
          const analysis = analyzeSelectedText(currentText);
          sendResponse({ success: true, analysis: analysis });
        }
        break;
        
      default:
        sendResponse({ success: false, error: 'Unknown action' });
    }
    
    return true;
  });
  
  // Add keyboard shortcut listeners
  document.addEventListener('keydown', (event) => {
    const key = (event.key || '').toLowerCase();

    // Ctrl+Shift+S (or Cmd+Shift+S on Mac) - Save current page
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 's') {
      event.preventDefault();

      sendRuntimeMessage({ action: 'saveCurrentTab' }).then((response) => {
        if (response && response.success) {
          showSaveIndicator('Page saved to Plethora!');
        } else if (response?.error && response.error.includes('Extension context invalidated')) {
          showSaveIndicator('Extension reloaded. Refresh the page to continue.');
        } else {
          showSaveIndicator('Failed to save page');
        }
      });
    }

    // Ctrl+Shift+E (or Cmd+Shift+E on Mac) - Toggle extract mode
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'e') {
      event.preventDefault();

      if (extractMode) {
        disableExtractMode();
        showSaveIndicator('Extract mode disabled');
      } else {
        enableExtractMode();
        showSaveIndicator('Extract mode enabled');
      }
    }

    // Ctrl+Shift+X (or Cmd+Shift+X on Mac) - Quick extract with priority
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'x') {
      event.preventDefault();

      const selection = window.getSelection();
      const selectedText = selection.toString().trim();

      if (selectedText.length === 0) {
        showSaveIndicator('No text selected for extract');
      } else {
        // Show priority selection dialog for quick extract
        showPrioritySelectionDialog(selectedText, selection);
      }
    }

    // Ctrl+Shift+H (or Cmd+Shift+H on Mac) - Toggle highlights
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'h') {
      event.preventDefault();

      const result = toggleHighlights();
      showSaveIndicator(result.enabled ? 'Highlights shown' : 'Highlights hidden');
    }

    // Ctrl+Shift+P (or Cmd+Shift+P on Mac) - Priority extract (alternative shortcut)
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && key === 'p') {
      event.preventDefault();

      const selection = window.getSelection();
      const selectedText = selection.toString().trim();

      if (selectedText.length === 0) {
        showSaveIndicator('No text selected for priority extract');
      } else {
        // Show priority selection dialog
        showPrioritySelectionDialog(selectedText, selection);
      }
    }
  });
  
  // Add context menu enhancement (visual feedback)
  document.addEventListener('contextmenu', (event) => {
    // Store the context menu position for potential use
    window.plethoraContextPos = {
      x: event.clientX,
      y: event.clientY,
      target: event.target
    };
  });

  window.addEventListener('beforeunload', stopRuntimeKeepAlive);
  startRuntimeKeepAlive();

  // YouTube-specific functionality
  function initYouTubeIntegration() {
    if (!window.location.hostname.includes('youtube.com')) {
      return;
    }

    function createYouTubeSaveButton() {
      const existingButton = document.getElementById('plethora-youtube-save-btn');
      if (existingButton) {
        existingButton.remove();
      }

      // Wait for the video title and actions to load
      const titleElement = document.querySelector('#title h1 yt-formatted-string, #container h1 yt-formatted-string');
      const actionsContainer = document.querySelector('#actions, #top-level-buttons, #menu-container');
      
      if (!titleElement || !actionsContainer) {
        // Retry after a short delay
        setTimeout(createYouTubeSaveButton, 1000);
        return;
      }

      const saveButton = document.createElement('button');
      saveButton.id = 'plethora-youtube-save-btn';
      saveButton.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/>
        </svg>
        <span>Save to Plethora</span>
      `;
      
      saveButton.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 16px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 18px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'YouTube Sans', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        z-index: 1000;
        margin-left: 8px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      `;

      // Add hover effects
      saveButton.addEventListener('mouseenter', () => {
        saveButton.style.transform = 'translateY(-1px)';
        saveButton.style.boxShadow = '0 4px 8px rgba(0,0,0,0.15)';
      });

      saveButton.addEventListener('mouseleave', () => {
        saveButton.style.transform = 'translateY(0)';
        saveButton.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
      });

      // Add click handler
      saveButton.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        
        // Temporarily disable button and show loading state
        saveButton.disabled = true;
        const originalContent = saveButton.innerHTML;
        saveButton.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="animation: spin 1s linear infinite;">
            <path d="M12,4V2A10,10 0 0,0 2,12H4A8,8 0 0,1 12,4Z"/>
          </svg>
          <span>Saving...</span>
        `;
        
        const videoData = getYouTubeVideoData();
        let savedSuccessfully = false;
        
        const performFallbackSave = async () => {
          let fallbackSuccessful = false;
          let INCREMENTUM_BASE_URL = 'http://127.0.0.1:8766'; // fallback to user's server

          // Method 1: Try storage API first (might fail if context invalid)
          try {
            if (chrome.storage && chrome.storage.sync) {
              const settings = await new Promise((resolve, reject) => {
                try {
                  chrome.storage.sync.get(['serverUrl', 'browserSyncPort'], (result) => {
                    if (chrome.runtime.lastError) {
                      reject(new Error(chrome.runtime.lastError.message));
                    } else {
                      resolve(result);
                    }
                  });
                } catch (e) { reject(e); }
              });

              let serverUrl = settings.serverUrl || '127.0.0.1';
              let port = settings.browserSyncPort || 8766;
              serverUrl = serverUrl.replace(/:\d+$/, '');
              if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
                serverUrl = `http://${serverUrl}`;
              }
              const url = new URL(serverUrl);
              url.port = port.toString();
              INCREMENTUM_BASE_URL = url.toString();

              try {
                localStorage.setItem('plethora_settings', JSON.stringify(settings));
              } catch (cacheError) {
                console.error('Failed to cache settings:', cacheError.message);
              }
            }
          } catch (settingsError) {
            console.error('Storage API failed, trying localStorage:', settingsError.message);
            // Method 2: Try to read settings from localStorage
            try {
              const storedSettings = localStorage.getItem('plethora_settings') ?? localStorage.getItem('incrementum_settings');
              if (storedSettings) {
                const settings = JSON.parse(storedSettings);
                let serverUrl = settings.serverUrl || '127.0.0.1';
                let port = settings.browserSyncPort || 8766;
                serverUrl = serverUrl.replace(/:\d+$/, '');
                if (!serverUrl.startsWith('http://') && !serverUrl.startsWith('https://')) {
                  serverUrl = `http://${serverUrl}`;
                }
                const url = new URL(serverUrl);
                url.port = port.toString();
                INCREMENTUM_BASE_URL = url.toString();
              }
            } catch (localError) {
              console.error('LocalStorage also failed:', localError.message);
            }
          }

          // Method 3: Try direct fetch
          try {
            const currentUrl = window.location.href;
            const currentTitle = videoData.title || document.title;
            
            const response = await fetch(`${INCREMENTUM_BASE_URL}/`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: currentUrl,
                title: currentTitle,
                content: '',
                type: 'page',
                source: 'browser_extension_youtube_fallback',
                timestamp: new Date().toISOString()
              })
            });

            if (response.ok) {
              fallbackSuccessful = true;
            } else {
              console.error('YouTube fallback fetch failed with status:', response.status);
            }
          } catch (fetchError) {
            console.error('YouTube fallback fetch failed:', fetchError.message);
          }

          if (fallbackSuccessful) {
             return true;
          } else {
            // Method 4: Clipboard fallback
            console.error('Server connection failed, using clipboard fallback');
            try {
              const url = window.location.href;
              const title = videoData.title || document.title;
              const textToCopy = `Plethora Save:\nURL: ${url}\nTitle: ${title}\nType: YouTube Video\n\nServer connection failed - please check your Plethora server settings`;
              
              await navigator.clipboard.writeText(textToCopy);
              
              // Indicate copy success differently
              saveButton.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8v2h11V5zm0 4H8v2h11V9zm0 4H8v2h11v-2zm0 4H8v2h11v-2z"/>
                </svg>
                <span>Copied!</span>
              `;
              saveButton.style.background = 'linear-gradient(135deg, #ff9800 0%, #f57c00 100%)';
              showSaveIndicator('❌ Server connection failed! Data copied to clipboard');
              
              setTimeout(() => {
                saveButton.innerHTML = originalContent;
                saveButton.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                saveButton.disabled = false;
              }, 4000);
              
              return true; // Considered handled
            } catch (clipboardError) {
              console.error('Clipboard fallback failed:', clipboardError.message);
              return false;
            }
          }
        };

        try {
          if (chrome.runtime && chrome.runtime.id) {
            // Send to background script for saving
            const response = await new Promise((resolve, reject) => {
              const timeoutId = setTimeout(() => {
                reject(new Error('Extension context timeout'));
              }, 5000);

              try {
                  chrome.runtime.sendMessage({
                    action: 'saveCurrentTab'
                  }, (response) => {
                    clearTimeout(timeoutId);
                    if (chrome.runtime.lastError) {
                      reject(new Error(chrome.runtime.lastError.message));
                    } else {
                      resolve(response);
                    }
                  });
              } catch (e) {
                  clearTimeout(timeoutId);
                  reject(e);
              }
            });

            if (response && response.success) {
               savedSuccessfully = true;
            } else {
               throw new Error(response?.error || 'Failed to save via extension');
            }
          } else {
             throw new Error("Extension context invalid");
          }
        } catch (error) {
          console.error('Primary save failed:', error);
          try {
             const result = await performFallbackSave();
             if (result) savedSuccessfully = true;
             else throw new Error("Fallback failed");
          } catch (fallbackError) {
             console.error("All save methods failed", fallbackError);
              saveButton.innerHTML = `
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
                <span>Error</span>
              `;
              saveButton.style.background = 'linear-gradient(135deg, #f44336 0%, #d32f2f 100%)';

              let msg = 'Failed to save YouTube video';
              if (error.message.includes('context')) msg = 'Extension context lost - reload extension';
              showSaveIndicator(msg);
              
              setTimeout(() => {
                saveButton.innerHTML = originalContent;
                saveButton.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                saveButton.disabled = false;
              }, 2000);
          }
        }

        if (savedSuccessfully && saveButton.textContent !== 'Copied!') {
            // Show success state (if not already handled by clipboard fallback)
            saveButton.innerHTML = `
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
              </svg>
              <span>Saved!</span>
            `;
            saveButton.style.background = 'linear-gradient(135deg, #4caf50 0%, #45a049 100%)';
            showSaveIndicator(`YouTube video saved: ${videoData.title}`);
            
            setTimeout(() => {
              saveButton.innerHTML = originalContent;
              saveButton.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
              saveButton.disabled = false;
            }, 2000);
        }
      });
      
      // Insert the button in the actions container
      // Try different insertion points depending on YouTube layout
      const likeButton = actionsContainer.querySelector('button[aria-label*="like"], button[title*="like"], #like-button');
      const shareButton = actionsContainer.querySelector('button[aria-label*="Share"], button[title*="Share"], #share-button');
      
      if (likeButton && likeButton.parentNode) {
        // Insert after like button
        likeButton.parentNode.insertBefore(saveButton, likeButton.nextSibling);
      } else if (shareButton && shareButton.parentNode) {
        // Insert after share button
        shareButton.parentNode.insertBefore(saveButton, shareButton.nextSibling);
      } else {
        // Fallback: append to actions container
        actionsContainer.appendChild(saveButton);
      }
    }

    // Function to extract YouTube video data
    function getYouTubeVideoData() {
      const titleElement = document.querySelector('#title h1 yt-formatted-string, #container h1 yt-formatted-string');
      const channelElement = document.querySelector('#channel-name a, #owner-name a, .ytd-channel-name a');
      const descriptionElement = document.querySelector('#description, #meta-contents, .ytd-video-secondary-info-renderer');
      
      return {
        title: titleElement ? titleElement.textContent.trim() : document.title,
        channel: channelElement ? channelElement.textContent.trim() : '',
        url: window.location.href,
        description: descriptionElement ? descriptionElement.textContent.trim().substring(0, 500) : '',
        timestamp: new Date().toISOString()
      };
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createYouTubeSaveButton);
    } else {
      createYouTubeSaveButton();
    }

    // Re-create button when navigating between YouTube videos (SPA navigation)
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        // Delay to allow page content to load
        setTimeout(createYouTubeSaveButton, 1500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Also listen for YouTube's navigation events
    window.addEventListener('yt-navigate-finish', () => {
      setTimeout(createYouTubeSaveButton, 1000);
    });

    // Add CSS for spinning animation
    if (!document.getElementById('plethora-youtube-styles')) {
      const style = document.createElement('style');
      style.id = 'plethora-youtube-styles';
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  initYouTubeIntegration();

})(); 
