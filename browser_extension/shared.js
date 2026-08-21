/* Shared, dependency-free helpers used by the extension service worker. */
(function exposeIncrementumExtensionShared(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.IncrementumExtensionShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSharedHelpers() {
  /**
   * Every request this extension sends to the desktop app should fit under
   * EXTENSION_REQUEST_BUDGET_BYTES. It exists so the desktop server's hard
   * limit (SERVER_MAX_REQUEST_BYTES) is a backstop that should never fire for
   * a normal-sized request, not the mechanism users are expected to hit.
   *
   * These values are mirrored, not literally shared — JavaScript and Rust
   * cannot import a constant across the process boundary — so
   * browser_extension/tests/shared.test.cjs asserts the extension budget
   * stays strictly below the server limit, and a comment at each Rust
   * constant points back here. Keep both sides in sync by hand.
   *
   *   SERVER_MAX_REQUEST_BYTES        mirrors src-tauri/src/browser_sync_server.rs::MAX_PAYLOAD_SIZE
   *   IMAGE_OCCLUSION_DECODED_MAX_BYTES  mirrors the decoded-image check in handle_image_occlusion_request
   */
  const TRANSPORT_LIMITS = Object.freeze({
    SERVER_MAX_REQUEST_BYTES: 10 * 1024 * 1024,
    EXTENSION_REQUEST_BUDGET_BYTES: 8 * 1024 * 1024,
    // Bounds the *decoded* image. Base64 encoding plus the surrounding JSON
    // (question, answer, regions, ...) inflates the actual request by roughly
    // a third, which is why occlusion uploads check the SERIALIZED request
    // against EXTENSION_REQUEST_BUDGET_BYTES rather than trusting this alone —
    // 7 MB decoded becomes ~9.3 MB of base64, leaving under 1 MB of headroom
    // under the server's 10 MB hard limit before any of the other fields are
    // counted.
    IMAGE_OCCLUSION_DECODED_MAX_BYTES: 7 * 1024 * 1024,
  });

  // Retained for existing call sites; equal to
  // TRANSPORT_LIMITS.EXTENSION_REQUEST_BUDGET_BYTES.
  const DEFAULT_REQUEST_BUDGET = TRANSPORT_LIMITS.EXTENSION_REQUEST_BUDGET_BYTES;

  const CAPTURE_CONTEXT_LIMITS = Object.freeze({
    version: 1,
    title: 240,
    url: 2048,
    domain: 160,
    author: 180,
    heading: 180,
    headingPath: 12,
    nearbyText: 1800,
    captionAltText: 1200,
    sourceTags: 24,
    sourceTag: 80,
    totalBytes: 8 * 1024
  });

  function serializedByteLength(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(text).byteLength;
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.byteLength(text, 'utf8');
    }
    return unescape(encodeURIComponent(text)).length;
  }

  function boundedContextString(value, max) {
    if (typeof value !== 'string') return undefined;
    const normalized = value.replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
    return normalized ? normalized.slice(0, max) : undefined;
  }

  function boundedContextList(value, maxItems, maxLength) {
    if (!Array.isArray(value)) return undefined;
    const items = value
      .map((item) => boundedContextString(item, maxLength))
      .filter(Boolean);
    return items.length ? [...new Set(items)].slice(0, maxItems) : undefined;
  }

  function normalizeCaptureContext(raw, fallback = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    let sourceUrl = boundedContextString(source.sourceUrl || source.source_url || fallback.sourceUrl, CAPTURE_CONTEXT_LIMITS.url);
    let domain = boundedContextString(source.domain, CAPTURE_CONTEXT_LIMITS.domain);
    if (!domain && sourceUrl) {
      try { domain = new URL(sourceUrl).hostname.replace(/^www\./i, '').slice(0, CAPTURE_CONTEXT_LIMITS.domain); } catch { /* optional */ }
    }
    const context = {
      version: Number.isFinite(Number(source.version)) ? Number(source.version) : CAPTURE_CONTEXT_LIMITS.version,
      sourceUrl,
      domain,
      pageTitle: boundedContextString(source.pageTitle || source.page_title || fallback.pageTitle, CAPTURE_CONTEXT_LIMITS.title),
      author: boundedContextString(source.author, CAPTURE_CONTEXT_LIMITS.author),
      headingPath: boundedContextList(source.headingPath || source.heading_path || source.headings, CAPTURE_CONTEXT_LIMITS.headingPath, CAPTURE_CONTEXT_LIMITS.heading),
      nearbyText: boundedContextString(source.nearbyText || source.nearby_text || source.context || fallback.nearbyText, CAPTURE_CONTEXT_LIMITS.nearbyText),
      captionAltText: boundedContextString(source.captionAltText || source.caption_alt_text || source.caption || source.alt, CAPTURE_CONTEXT_LIMITS.captionAltText),
      contentKind: boundedContextString(source.contentKind || source.content_kind, 80),
      sourceDocumentId: boundedContextString(source.sourceDocumentId || source.source_document_id, 120),
      sourceTags: boundedContextList(source.sourceTags || source.source_tags, CAPTURE_CONTEXT_LIMITS.sourceTags, CAPTURE_CONTEXT_LIMITS.sourceTag),
      selector: boundedContextString(source.selector, 240),
      reduced: source.reduced === true,
      extensionVersion: boundedContextString(source.extensionVersion || source.extension_version, 80)
    };
    for (const key of Object.keys(context)) {
      const value = context[key];
      if (value === undefined || value === '' || value === false || (Array.isArray(value) && value.length === 0)) delete context[key];
    }
    while (serializedByteLength(context) > CAPTURE_CONTEXT_LIMITS.totalBytes) {
      if (context.captionAltText) context.captionAltText = context.captionAltText.slice(0, Math.max(0, context.captionAltText.length - 200));
      else if (context.nearbyText) context.nearbyText = context.nearbyText.slice(0, Math.max(0, context.nearbyText.length - 300));
      else if (context.sourceTags?.length) context.sourceTags = context.sourceTags.slice(0, -1);
      else if (context.headingPath?.length) context.headingPath = context.headingPath.slice(0, -1);
      else break;
      context.reduced = true;
    }
    return Object.keys(context).length > 1 ? context : undefined;
  }

  function buildCaptureContext(data = {}) {
    const rawContext = data.capture_context || data.captureContext;
    if (!rawContext && !data.context) return undefined;
    return normalizeCaptureContext(rawContext || { nearbyText: data.context }, {
      sourceUrl: data.url,
      pageTitle: data.title,
      nearbyText: data.context
    });
  }

  function compactCaptureContext(context) {
    const normalized = normalizeCaptureContext(context);
    if (!normalized) return undefined;
    return normalizeCaptureContext({
      ...normalized,
      nearbyText: undefined,
      captionAltText: undefined,
      sourceTags: normalized.sourceTags?.slice(0, 8),
      reduced: true
    });
  }

  function buildExtensionPayload(data) {
    const captureContext = buildCaptureContext(data);
    const trimmedText = String(data?.text || '').trim();
    return {
      url: data?.url,
      title: data?.title || 'Untitled',
      text: trimmedText,
      html_content: data?.html_content,
      extracted_images: data?.extracted_images,
      type: data?.type || 'page',
      source: data?.source || 'browser_extension',
      timestamp: data?.timestamp || new Date().toISOString(),
      context: data?.context,
      capture_context: captureContext,
      tags: data?.tags,
      priority: data?.priority,
      analysis: data?.analysis,
      fsrs_data: data?.fsrs_data
    };
  }

  /** Binary-search the longest prefix of `payload[fieldName]` that still fits. */
  function trimFieldToBudget(payload, fieldName, budgetBytes) {
    const source = payload[fieldName] || '';
    let low = 0;
    let high = source.length;
    let best = '';

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = `${source.slice(0, middle)}\n\n[Content truncated by browser extension]`;
      const serialized = JSON.stringify({ ...payload, [fieldName]: candidate });
      if (serializedByteLength(serialized) <= budgetBytes) {
        best = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return { ...payload, [fieldName]: best };
  }

  function trimTextToBudget(payload, budgetBytes) {
    return trimFieldToBudget(payload, 'text', budgetBytes);
  }

  function compactRichHtml(html) {
    return String(html || '')
      .replace(/\sstyle="[^"]*"/gi, '')
      .replace(/\sstyle='[^']*'/gi, '')
      .replace(/\ssrcset="[^"]*"/gi, '')
      .replace(/\ssrcset='[^']*'/gi, '');
  }

  function fitPayloadToBudget(data, budgetBytes = DEFAULT_REQUEST_BUDGET) {
    let payload = buildExtensionPayload(data);
    let requestBody = JSON.stringify(payload);
    let droppedHtml = false;
    let compactedHtml = false;
    let droppedImages = false;
    let truncatedText = false;
    let reducedCaptureContext = false;

    if (serializedByteLength(requestBody) > budgetBytes && payload.html_content) {
      const compactHtml = compactRichHtml(payload.html_content);
      if (compactHtml && compactHtml !== payload.html_content) {
        payload = { ...payload, html_content: compactHtml };
        requestBody = JSON.stringify(payload);
        compactedHtml = true;
      }
    }

    if (serializedByteLength(requestBody) > budgetBytes && payload.html_content) {
      payload = { ...payload, html_content: undefined };
      requestBody = JSON.stringify(payload);
      droppedHtml = true;
    }

    if (serializedByteLength(requestBody) > budgetBytes && payload.extracted_images) {
      payload = { ...payload, extracted_images: undefined };
      requestBody = JSON.stringify(payload);
      droppedImages = true;
    }

    if (serializedByteLength(requestBody) > budgetBytes && payload.capture_context) {
      payload = { ...payload, capture_context: compactCaptureContext(payload.capture_context) };
      requestBody = JSON.stringify(payload);
      reducedCaptureContext = true;
    }

    if (serializedByteLength(requestBody) > budgetBytes) {
      payload = trimTextToBudget(payload, budgetBytes);
      requestBody = JSON.stringify(payload);
      truncatedText = true;
    }

    return {
      payload,
      requestBody,
      byteLength: serializedByteLength(requestBody),
      droppedHtml,
      compactedHtml,
      droppedImages,
      truncatedText,
      reducedCaptureContext
    };
  }

  function withoutRichContent(payload) {
    return {
      ...payload,
      html_content: undefined,
      extracted_images: undefined
    };
  }

  /**
   * Turn fitPayloadToBudget's shed-content flags into a note for the user.
   * Returns null when nothing was shed, so a plain success can stay a plain
   * success — a save that degraded must say so, but one that didn't should
   * not manufacture a warning.
   */
  function describeDegradation(fitted) {
    const parts = [];
    if (fitted.droppedHtml) {
      parts.push('without its original formatting');
    } else if (fitted.compactedHtml) {
      parts.push('with simplified formatting');
    }
    if (fitted.droppedImages) {
      parts.push('without images');
    }
    if (fitted.truncatedText) {
      parts.push('with the content truncated');
    }
    if (fitted.reducedCaptureContext) {
      parts.push('with reduced capture context');
    }
    if (parts.length === 0) return null;
    return `Saved ${parts.join(', ')} to fit the size limit.`;
  }

  /**
   * Passive capture is opt-in. Keep this normalization in the shared module
   * so the worker and tests use the same fail-closed interpretation of
   * missing, malformed, and explicit settings.
   */
  function normalizeCaptureSettings(settings = {}) {
    const source = settings && typeof settings === 'object' ? settings : {};
    return {
      autoSave: source.autoSave === true,
      saveHistory: source.saveHistory === true,
      saveBookmarks: source.saveBookmarks === true
    };
  }

  function shouldCapturePassiveEvent(event, settingsReady, settings = {}) {
    if (settingsReady !== true) return false;
    const normalized = normalizeCaptureSettings(settings);
    switch (event) {
      case 'navigation':
        return normalized.autoSave;
      case 'history':
        return normalized.saveHistory;
      case 'bookmark':
        return normalized.saveBookmarks;
      default:
        return false;
    }
  }

  /**
   * Fit an AI-processing request (`{content, operation, ...}`) to budget.
   * Distinct from fitPayloadToBudget because that function's shape is fixed
   * to the page/extract payload (buildExtensionPayload) and would silently
   * drop AI-only fields like `operation`, `card_types`, `save_flashcards`.
   * There is currently no known way to reach this function's fallback branch
   * from the extension's UI — every caller of an AI request bounds `content`
   * to a user's manual text selection — but every request this extension
   * sends should be fitted on principle, not only the ones with a known
   * overflow path today.
   */
  function fitAiRequestToBudget(payload, budgetBytes = DEFAULT_REQUEST_BUDGET) {
    let requestBody = JSON.stringify(payload);
    let truncatedContent = false;

    if (serializedByteLength(requestBody) > budgetBytes) {
      payload = trimFieldToBudget(payload, 'content', budgetBytes);
      requestBody = JSON.stringify(payload);
      truncatedContent = true;
    }

    return {
      payload,
      requestBody,
      byteLength: serializedByteLength(requestBody),
      truncatedContent
    };
  }

  /**
   * Check a fully-built request body (already JSON-stringified) against the
   * extension's transport budget, without attempting to shed content from it.
   * For requests like image-occlusion uploads, whose dominant cost is a
   * base64 blob that cannot be usefully truncated — the fix for an oversized
   * image is a smaller image, not a corrupted one — this is a fail-fast check
   * with an actionable message rather than a fitting strategy.
   */
  function checkRequestBudget(requestBody, budgetBytes = DEFAULT_REQUEST_BUDGET) {
    const byteLength = serializedByteLength(requestBody);
    if (byteLength <= budgetBytes) {
      return { ok: true, byteLength };
    }
    return {
      ok: false,
      byteLength,
      message: `Request is ${(byteLength / (1024 * 1024)).toFixed(1)} MB, over the ${(budgetBytes / (1024 * 1024)).toFixed(1)} MB limit.`
    };
  }

  /**
   * Calculate decoded byte length from a base64 string or data URL.
   */
  function estimateBase64DecodedBytes(base64OrDataUrl) {
    if (typeof base64OrDataUrl !== 'string') return 0;
    const base64 = base64OrDataUrl.includes(',')
      ? base64OrDataUrl.split(',')[1]
      : base64OrDataUrl;
    const clean = base64.trim();
    if (!clean) return 0;
    const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
    return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
  }

  /**
   * Validate that decoded image byte size conforms to the 7 MB limit
   * (TRANSPORT_LIMITS.IMAGE_OCCLUSION_DECODED_MAX_BYTES).
   */
  function validateImageDecodedSize(byteSize, limitBytes = TRANSPORT_LIMITS.IMAGE_OCCLUSION_DECODED_MAX_BYTES) {
    if (typeof byteSize !== 'number' || !Number.isFinite(byteSize) || byteSize <= 0) {
      return { ok: false, message: 'Invalid image size.' };
    }
    if (byteSize > limitBytes) {
      const limitMb = (limitBytes / (1024 * 1024)).toFixed(0);
      const actualMb = (byteSize / (1024 * 1024)).toFixed(1);
      return {
        ok: false,
        byteSize,
        message: `The selected image is ${actualMb} MB, which exceeds the ${limitMb} MB limit.`
      };
    }
    return { ok: true, byteSize };
  }

  /**
   * True when `url` is an x.com/twitter.com status URL:
   * `https://(www.|mobile.)?(x|twitter).com/<user>/status/<id>`, tolerating
   * query params (`?s=20`), fragments, and `/photo/n`-style suffixes.
   * Profile, search, home, and other non-status X pages are NOT matches —
   * they save through the generic page-capture path. The generic
   * `/i/status/<id>` redirect format is excluded too (no real <user>
   * segment). Mirrors `is_x_status_url` in
   * src-tauri/src/browser_sync_server.rs — the two cannot literally share
   * code across the process boundary, so keep them in sync by hand.
   */
  function isXStatusURL(url) {
    if (typeof url !== 'string') return false;
    return /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?!i\/)([A-Za-z0-9_]{1,64})\/status\/\d+(?:[\/?#].*)?$/i.test(url.trim());
  }

  /**
   * Guarantees a context-menu extract record carries the same fields the
   * content script's `pageExtracts` entries do (id, url, title, text,
   * timestamp) so a background-registered record is a first-class member and
   * counts/renders identically to one created in the content script. The
   * `id` (and any other missing field) falls back to `defaults` — the
   * background passes the server-confirmed `extract_id` there when the
   * desktop app returns one, and to a freshly generated id otherwise.
   */
  function normalizeExtractRecord(record, defaults = {}) {
    const source = record && typeof record === 'object' ? record : {};
    return {
      id: source.id || defaults.id || generateExtractId(),
      url: source.url || defaults.url || '',
      title: source.title || defaults.title || '',
      text: source.text || defaults.text || '',
      timestamp: source.timestamp || defaults.timestamp || new Date().toISOString(),
      ...source
    };
  }

  /**
   * Idempotent merge of `incoming` extract records into `existing`, deduped
   * by extract id. This is the accounting core behind "exactly once": the
   * content script uses the same rule when registering background-created
   * extracts, so re-delivery after a service-worker restart can never
   * double-count. Mirrors `registerExtracts` in browser_extension/content.js
   * — the two run in different contexts and cannot literally share code, so
   * keep them in sync by hand (same protocol as TRANSPORT_LIMITS above).
   */
  function mergeExtracts(existing, incoming) {
    const existingList = Array.isArray(existing) ? existing : [];
    const incomingList = Array.isArray(incoming) ? incoming : [];
    const seen = new Set(existingList.map((item) => item && item.id).filter(Boolean));
    const merged = existingList.slice();
    const added = [];
    const duplicates = [];
    for (const record of incomingList) {
      if (!record || typeof record !== 'object' || !record.id) {
        continue;
      }
      if (seen.has(record.id)) {
        duplicates.push(record);
        continue;
      }
      seen.add(record.id);
      merged.push(record);
      added.push(record);
    }
    return { merged, added, duplicates };
  }

  function generateExtractId() {
    return `extract_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Tiny promise-chain mutex that serializes async read-modify-write
   * operations sharing one resource: each operation runs to completion
   * (including its awaits) before the next queued operation starts, so
   * overlapping readers/writers cannot clobber one another's intermediate
   * state. Returns a function that runs the given operation exclusively.
   */
  function createMutex() {
    let queue = Promise.resolve();
    return function runExclusive(operation) {
      const result = queue.then(operation, operation);
      queue = result.then(
        () => undefined,
        () => undefined
      );
      return result;
    };
  }

  /**
   * Build the canonical `POST /api/image-registry/ingest` payload for an
   * image captured from a web page. Provenance fields (source URL, title,
   * alt text, caption, domain) feed the desktop smart-tagging pipeline;
   * `open_composer` stays false so plain registry saves never hijack the
   * desktop occlusion composer.
   */
  function buildImageIngestPayload({
    imageBase64,
    mimeType,
    fileName,
    sourceUrl,
    title,
    alt,
    caption,
    domain,
    captureContext,
    tags
  }) {
    const context = normalizeCaptureContext(captureContext || {
      sourceUrl,
      domain,
      pageTitle: title,
      captionAltText: caption || alt
    });
    const payload = {
      image_base64: imageBase64,
      mime_type: mimeType || undefined,
      file_name: fileName || undefined,
      source_url: sourceUrl || undefined,
      title: title || undefined,
      alt: alt || undefined,
      caption: caption || undefined,
      domain: domain || undefined,
      open_composer: false,
      ...(context ? { capture_context: context } : {}),
      ...(Array.isArray(tags) && tags.length ? { tags } : {})
    };
    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined) delete payload[key];
    }
    return payload;
  }

  return {
    TRANSPORT_LIMITS,
    DEFAULT_REQUEST_BUDGET,
    serializedByteLength,
    buildExtensionPayload,
    compactRichHtml,
    fitPayloadToBudget,
    CAPTURE_CONTEXT_LIMITS,
    normalizeCaptureContext,
    buildCaptureContext,
    buildImageIngestPayload,
    fitAiRequestToBudget,
    checkRequestBudget,
    estimateBase64DecodedBytes,
    validateImageDecodedSize,
    withoutRichContent,
    describeDegradation,
    normalizeCaptureSettings,
    shouldCapturePassiveEvent,
    isXStatusURL,
    normalizeExtractRecord,
    mergeExtracts,
    createMutex
  };
});
