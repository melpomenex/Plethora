/* Shared, dependency-free helpers used by the extension service worker. */
(function exposeIncrementumExtensionShared(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.IncrementumExtensionShared = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createSharedHelpers() {
  const DEFAULT_REQUEST_BUDGET = 8 * 1024 * 1024;

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

  function buildExtensionPayload(data) {
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
      tags: data?.tags,
      priority: data?.priority,
      analysis: data?.analysis,
      fsrs_data: data?.fsrs_data
    };
  }

  function trimTextToBudget(payload, budgetBytes) {
    const source = payload.text || '';
    let low = 0;
    let high = source.length;
    let best = '';

    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      const candidate = `${source.slice(0, middle)}\n\n[Content truncated by browser extension]`;
      const serialized = JSON.stringify({ ...payload, text: candidate });
      if (serializedByteLength(serialized) <= budgetBytes) {
        best = candidate;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return { ...payload, text: best };
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
      truncatedText
    };
  }

  function withoutRichContent(payload) {
    return {
      ...payload,
      html_content: undefined,
      extracted_images: undefined
    };
  }

  return {
    DEFAULT_REQUEST_BUDGET,
    serializedByteLength,
    buildExtensionPayload,
    compactRichHtml,
    fitPayloadToBudget,
    withoutRichContent
  };
});
