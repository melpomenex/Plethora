const test = require('node:test');
const assert = require('node:assert/strict');
require('../shared.js');
const {
  TRANSPORT_LIMITS,
  buildExtensionPayload,
  checkRequestBudget,
  compactRichHtml,
  describeDegradation,
  fitAiRequestToBudget,
  fitPayloadToBudget,
  isXStatusURL,
  normalizeCaptureContext,
  normalizeCaptureSettings,
  serializedByteLength,
  shouldCapturePassiveEvent,
  withoutRichContent
} = globalThis.IncrementumExtensionShared;

test('passive capture settings default to disabled and require explicit true', () => {
  assert.deepEqual(normalizeCaptureSettings({}), {
    autoSave: false,
    saveHistory: false,
    saveBookmarks: false
  });
  assert.deepEqual(normalizeCaptureSettings({
    autoSave: 1,
    saveHistory: 'true',
    saveBookmarks: true
  }), {
    autoSave: false,
    saveHistory: false,
    saveBookmarks: true
  });
});

test('passive capture is blocked before settings load and scoped by event', () => {
  const settings = { autoSave: true, saveHistory: false, saveBookmarks: true };
  assert.equal(shouldCapturePassiveEvent('navigation', false, settings), false);
  assert.equal(shouldCapturePassiveEvent('history', true, settings), false);
  assert.equal(shouldCapturePassiveEvent('bookmark', true, settings), true);
  assert.equal(shouldCapturePassiveEvent('navigation', true, settings), true);
  assert.equal(shouldCapturePassiveEvent('unknown', true, settings), false);
});

test('whole-page payloads default to page and do not duplicate text', () => {
  const payload = buildExtensionPayload({
    url: 'https://example.com/article',
    title: 'Article',
    text: 'Readable body'
  });

  assert.equal(payload.type, 'page');
  assert.equal(payload.text, 'Readable body');
  assert.equal(Object.hasOwn(payload, 'content'), false);
});

test('browser capture context is bounded, normalized, and kept separate from semantic tags', () => {
  const context = normalizeCaptureContext({
    sourceUrl: 'https://example.com/article',
    pageTitle: '  Article\u0000 title ',
    headingPath: Array.from({ length: 30 }, (_, index) => `Heading ${index}`),
    nearbyText: 'x'.repeat(5000),
    sourceTags: ['topic', 'topic', 'source'],
  });
  assert.equal(context.version, 1);
  assert.equal(context.pageTitle, 'Article  title');
  assert.equal(context.headingPath.length, 12);
  assert.ok(context.nearbyText.length <= 1800);
  assert.deepEqual(context.sourceTags, ['topic', 'source']);

  const payload = buildExtensionPayload({
    url: 'https://example.com/article',
    title: 'Article',
    text: 'Readable body',
    capture_context: context,
    tags: ['user-tag'],
  });
  assert.deepEqual(payload.tags, ['user-tag']);
  assert.equal(payload.capture_context.sourceUrl, 'https://example.com/article');
  assert.equal(Object.hasOwn(payload.capture_context, 'tags'), false);
});

test('oversized rich HTML is removed before readable text is truncated', () => {
  const fitted = fitPayloadToBudget({
    url: 'https://example.com/article',
    title: 'Article',
    text: 'Keep this readable body',
    html_content: `<article>${'x'.repeat(4096)}</article>`,
    extracted_images: [{ src: 'https://example.com/image.png' }],
    type: 'page'
  }, 1024);

  assert.equal(fitted.droppedHtml, true);
  assert.equal(fitted.payload.text, 'Keep this readable body');
  assert.ok(serializedByteLength(fitted.requestBody) <= 1024);
});

test('413 retry payload retains text while removing rich assets', () => {
  const payload = withoutRichContent(buildExtensionPayload({
    url: 'https://example.com/article',
    text: 'Readable body',
    html_content: '<img src="https://example.com/image.png">',
    extracted_images: [{ src: 'https://example.com/image.png' }]
  }));

  assert.equal(payload.text, 'Readable body');
  assert.equal(payload.html_content, undefined);
  assert.equal(payload.extracted_images, undefined);
});

test('large computed-style attributes are compacted without removing images', () => {
  const html = `<article style="${'color:red;'.repeat(200)}"><img src="https://example.com/map.png"></article>`;
  const compacted = compactRichHtml(html);
  assert.equal(compacted.includes('style='), false);
  assert.equal(compacted.includes('https://example.com/map.png'), true);
});

test('shedding proceeds in decreasing order of richness: style, then html, then images, then text', () => {
  // A payload sized so that EVERY step is needed, one at a time — asserted by
  // watching which flags flip and which fields survive as the budget
  // tightens, not only the final state. Thresholds below were measured
  // directly against this exact payload (fullSize 25256 bytes; stage
  // boundaries at 21245 / 20208 / 20147), not guessed.
  //
  // Rich markup (html_content) is shed before embedded media references
  // (extracted_images), not after: the images array is just URLs — a few KB
  // at most for up to 24 of them — and feeds a feature (images attached to
  // extracts) independent of whether the article's HTML formatting survived,
  // so it is worth keeping past the point where the much heavier, purely
  // cosmetic markup goes.
  const bigStyledHtml = `<article style="${'color:red;'.repeat(400)}">${'word '.repeat(200)}</article>`;
  const payload = {
    url: 'https://example.com/article',
    title: 'Article',
    text: 'y'.repeat(20000),
    html_content: bigStyledHtml,
    extracted_images: [{ src: 'https://example.com/image.png' }],
    type: 'page'
  };
  const fullSize = serializedByteLength(JSON.stringify(buildExtensionPayload(payload)));
  assert.equal(fullSize, 25256, 'fixture size drifted; recompute the stage thresholds below');

  // Loosest budget that still requires compacting styles, nothing else.
  const compactOnly = fitPayloadToBudget(payload, 22000);
  assert.equal(compactOnly.compactedHtml, true);
  assert.equal(compactOnly.droppedHtml, false);
  assert.equal(compactOnly.droppedImages, false);
  assert.equal(compactOnly.truncatedText, false);
  assert.notEqual(compactOnly.payload.html_content, undefined);
  assert.notEqual(compactOnly.payload.extracted_images, undefined);

  // Tight enough that html must go entirely; images (much smaller) survive.
  const dropHtml = fitPayloadToBudget(payload, 20800);
  assert.equal(dropHtml.droppedHtml, true);
  assert.equal(dropHtml.droppedImages, false);
  assert.equal(dropHtml.truncatedText, false);
  assert.equal(dropHtml.payload.html_content, undefined);
  assert.notEqual(dropHtml.payload.extracted_images, undefined);
  assert.equal(dropHtml.payload.text, payload.text);

  // Tight enough that images have to go too; text is still whole.
  const dropImages = fitPayloadToBudget(payload, 20160);
  assert.equal(dropImages.droppedHtml, true);
  assert.equal(dropImages.droppedImages, true);
  assert.equal(dropImages.truncatedText, false);
  assert.equal(dropImages.payload.extracted_images, undefined);
  assert.equal(dropImages.payload.text, payload.text);

  // Tight enough that even the readable text must be cut — the last resort.
  const truncate = fitPayloadToBudget(payload, 512);
  assert.equal(truncate.droppedHtml, true);
  assert.equal(truncate.droppedImages, true);
  assert.equal(truncate.truncatedText, true);
  assert.ok(truncate.payload.text.length < payload.text.length);
  assert.ok(serializedByteLength(truncate.requestBody) <= 512);
});

test('a rejected request with no rich content left is still retried, not reported as unrecoverable', () => {
  // Mirrors sendToIncrementum's 413 handling: re-fit the ORIGINAL data
  // against a much smaller budget rather than gating the retry on whether
  // html_content/extracted_images survived the first fit.
  const data = {
    url: 'https://example.com/article',
    text: 'z'.repeat(2000),
    type: 'page'
    // No html_content or extracted_images at all — the old gate condition
    // `fitted.payload.html_content || fitted.payload.extracted_images` would
    // have been false here, and the retry would never have been attempted.
  };
  const RETRY_BUDGET_BYTES = 512 * 1024;
  const retried = fitPayloadToBudget(data, RETRY_BUDGET_BYTES);

  assert.ok(serializedByteLength(retried.requestBody) <= RETRY_BUDGET_BYTES);
  // 2000 bytes of text easily fits in 512 KB, so nothing should have needed
  // shedding — the point is that fitting ran and produced a usable payload,
  // not that this particular input was oversized.
  assert.equal(retried.truncatedText, false);
  assert.equal(retried.payload.text, data.text);
});

test('fitAiRequestToBudget truncates content without dropping AI-only fields', () => {
  // fitPayloadToBudget would silently drop these fields — it only knows the
  // page/extract payload shape (buildExtensionPayload). This is why AI
  // requests need their own fitter rather than reusing that one.
  const payload = {
    content: 'x'.repeat(20000),
    operation: 'flashcards',
    max_words: 150,
    count: 5,
    save_flashcards: true,
    card_types: ['qa', 'cloze'],
    url: 'https://example.com/article',
    title: 'Article'
  };

  const fitted = fitAiRequestToBudget(payload, 512);

  assert.equal(fitted.truncatedContent, true);
  assert.ok(fitted.payload.content.length < payload.content.length);
  assert.equal(fitted.payload.operation, 'flashcards');
  assert.equal(fitted.payload.save_flashcards, true);
  assert.deepEqual(fitted.payload.card_types, ['qa', 'cloze']);
  assert.ok(serializedByteLength(fitted.requestBody) <= 512);
});

test('fitAiRequestToBudget leaves a request that already fits untouched', () => {
  const payload = { content: 'short selection', operation: 'summarize' };
  const fitted = fitAiRequestToBudget(payload);

  assert.equal(fitted.truncatedContent, false);
  assert.equal(fitted.payload.content, 'short selection');
});

test('checkRequestBudget passes a request within budget and fails one over it, with a readable message', () => {
  const small = JSON.stringify({ a: 1 });
  const withinBudget = checkRequestBudget(small, 1024);
  assert.equal(withinBudget.ok, true);
  assert.equal(withinBudget.byteLength, serializedByteLength(small));

  const large = JSON.stringify({ blob: 'x'.repeat(2000) });
  const overBudget = checkRequestBudget(large, 1024);
  assert.equal(overBudget.ok, false);
  assert.match(overBudget.message, /MB/);
  assert.ok(overBudget.byteLength > 1024);
});

test('describeDegradation names what was shed, and stays silent when nothing was', () => {
  assert.equal(
    describeDegradation({ droppedHtml: false, compactedHtml: false, droppedImages: false, truncatedText: false }),
    null
  );

  const imagesOnly = describeDegradation({
    droppedHtml: false,
    compactedHtml: false,
    droppedImages: true,
    truncatedText: false
  });
  assert.match(imagesOnly, /without images/);
  assert.doesNotMatch(imagesOnly, /formatting/);
  assert.doesNotMatch(imagesOnly, /truncated/);

  const textOnly = describeDegradation({
    droppedHtml: false,
    compactedHtml: false,
    droppedImages: false,
    truncatedText: true
  });
  assert.match(textOnly, /truncated/);

  const everything = describeDegradation({
    droppedHtml: true,
    compactedHtml: false,
    droppedImages: true,
    truncatedText: true
  });
  assert.match(everything, /formatting/);
  assert.match(everything, /images/);
  assert.match(everything, /truncated/);
});

test('the extension request budget stays strictly below the server limit', () => {
  // These values are mirrored by hand in src-tauri/src/browser_sync_server.rs
  // (MAX_PAYLOAD_SIZE and IMAGE_OCCLUSION_DECODED_MAX_BYTES) since JS and Rust
  // cannot share a literal constant. This is the check that keeps them honest:
  // if the extension's own budgeting is not comfortably inside the server's
  // hard limit, the server limit stops being a backstop and starts being the
  // thing users actually hit.
  assert.ok(
    TRANSPORT_LIMITS.EXTENSION_REQUEST_BUDGET_BYTES < TRANSPORT_LIMITS.SERVER_MAX_REQUEST_BYTES
  );
  assert.equal(TRANSPORT_LIMITS.SERVER_MAX_REQUEST_BYTES, 10 * 1024 * 1024);
  assert.equal(TRANSPORT_LIMITS.EXTENSION_REQUEST_BUDGET_BYTES, 8 * 1024 * 1024);
  assert.equal(TRANSPORT_LIMITS.IMAGE_OCCLUSION_DECODED_MAX_BYTES, 7 * 1024 * 1024);

  // Base64 inflates the decoded-image limit by ~4/3; confirm that inflated
  // size still leaves real headroom under the server limit for the
  // surrounding JSON fields (question, answer, regions, ...), rather than
  // landing within a few bytes of it.
  const inflatedImageBytes = Math.ceil(TRANSPORT_LIMITS.IMAGE_OCCLUSION_DECODED_MAX_BYTES * 4 / 3);
  const headroom = TRANSPORT_LIMITS.SERVER_MAX_REQUEST_BYTES - inflatedImageBytes;
  assert.ok(headroom > 0, 'a maximal occlusion image must not exceed the server limit on its own');
});

test('isXStatusURL matches status and thread URLs across hosts and suffixes', () => {
  assert.equal(isXStatusURL('https://x.com/user/status/1234567890'), true);
  assert.equal(isXStatusURL('https://www.x.com/PhillipAKennedy/status/1789999999999999999'), true);
  assert.equal(isXStatusURL('https://mobile.twitter.com/Some_User/status/9876543210?s=20&t=abc'), true);
  assert.equal(isXStatusURL('https://twitter.com/user/status/1234567890/photo/1'), true);
  assert.equal(isXStatusURL('https://x.com/user/status/1234567890/'), true);
  assert.equal(isXStatusURL('https://x.com/user/status/1234567890#anchor'), true);
  // Mid-thread URL — still a status URL (the server resolves it to the root).
  assert.equal(isXStatusURL('https://x.com/user/status/1111111111111111112?s=20'), true);
});

test('isXStatusURL rejects non-status X pages and lookalikes', () => {
  // X pages that are not statuses save through the generic page path.
  assert.equal(isXStatusURL('https://x.com/PhillipAKennedy'), false);
  assert.equal(isXStatusURL('https://x.com/PhillipAKennedy/with_replies'), false);
  assert.equal(isXStatusURL('https://x.com/search?q=threadreader'), false);
  assert.equal(isXStatusURL('https://x.com/home'), false);
  assert.equal(isXStatusURL('https://x.com/i/status/1234567890'), false);
  assert.equal(isXStatusURL('https://x.com/user/status/notanid'), false);
  // Other sites, including lookalikes, never match.
  assert.equal(isXStatusURL('https://notx.com/user/status/1234567890'), false);
  assert.equal(isXStatusURL('https://x.com.evil.example/user/status/1234567890'), false);
  assert.equal(isXStatusURL('https://www.youtube.com/watch?v=abc'), false);
  assert.equal(isXStatusURL('about:blank'), false);
  assert.equal(isXStatusURL(''), false);
  assert.equal(isXStatusURL(null), false);
  assert.equal(isXStatusURL(undefined), false);
});
