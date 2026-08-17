/**
 * Protocol contract test for the Incrementum → Plethora rebrand compat
 * window (task 3.6 / 5.1): during the window BOTH sides must accept BOTH
 * postMessage source tokens, the app must emit responses under both tokens,
 * and the highlight class must be dual-written by the extension while the
 * app styles both classes.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

test("app bridge accepts both extension source tokens", () => {
  const bridge = read("src/lib/extension-bridge.ts");
  assert.ok(bridge.includes("const EXTENSION_SOURCE_TOKENS = ['plethora-extension', 'incrementum-extension']"));
  assert.ok(bridge.includes("const PWA_SOURCE_TOKENS = ['plethora-pwa', 'incrementum-pwa']"));
});

test("app bridge dedupes dual sends by requestId", () => {
  const bridge = read("src/lib/extension-bridge.ts");
  assert.ok(bridge.includes("handledRequestIds"));
});

test("extension content script accepts responses from both PWA tokens", () => {
  const content = read("browser_extension/content.js");
  assert.ok(content.includes("message.source !== 'plethora-pwa' && message.source !== 'incrementum-pwa'"));
});

test("extension content script sends each request under both tokens", () => {
  const content = read("browser_extension/content.js");
  assert.ok(content.includes("const EXTENSION_SOURCE_TOKENS = ['plethora-extension', 'incrementum-extension']"));
});

test("extension detects the app via either marker attribute or either product title", () => {
  const content = read("browser_extension/content.js");
  assert.ok(content.includes("querySelector('[data-plethora-app]')"));
  assert.ok(content.includes("querySelector('[data-incrementum-app]')"));
  assert.ok(content.includes("document.title.includes('Plethora')"));
  assert.ok(content.includes("document.title.includes('Incrementum')"));
});

test("index.html writes both marker attributes during the compat window", () => {
  const html = read("index.html");
  assert.ok(html.includes('data-plethora-app="true"'));
  assert.ok(html.includes('data-incrementum-app="true"'));
});

test("extension highlight spans carry both classes", () => {
  const content = read("browser_extension/content.js");
  assert.ok(content.includes("'plethora-highlight incrementum-highlight'"));
});

test("app renders both highlight classes", () => {
  const renderer = read("src/components/common/RichContentRenderer.tsx");
  assert.ok(renderer.includes(".plethora-highlight"));
  assert.ok(renderer.includes(".incrementum-highlight"));
});
