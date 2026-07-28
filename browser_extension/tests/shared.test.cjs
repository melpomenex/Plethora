const test = require('node:test');
const assert = require('node:assert/strict');
require('../shared.js');
const {
  buildExtensionPayload,
  compactRichHtml,
  fitPayloadToBudget,
  serializedByteLength,
  withoutRichContent
} = globalThis.IncrementumExtensionShared;

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
