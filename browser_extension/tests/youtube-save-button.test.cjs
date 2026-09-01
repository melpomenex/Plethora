const test = require('node:test');
const assert = require('node:assert/strict');
require('../youtubeSaveHelpers.js');

const {
  isWatchPagePath,
  getWatchMetadataRoot,
  getWatchActionsContainer,
  isValidButtonPlacement,
  needsSaveButtonInjection,
  BUTTON_ID,
} = globalThis.PlethoraYouTubeSaveHelpers;

function makeDoc(html) {
  const { JSDOM } = require('jsdom');
  return new JSDOM(html).window.document;
}

test('isWatchPagePath matches watch URLs only', () => {
  assert.equal(isWatchPagePath('/watch'), true);
  assert.equal(isWatchPagePath('/watch?v=abc'), true);
  assert.equal(isWatchPagePath('/feed'), false);
});

test('getWatchActionsContainer scopes to metadata', () => {
  const doc = makeDoc(`
    <div id="actions">decoy</div>
    <ytd-watch-metadata>
      <div id="actions-inner">real</div>
    </ytd-watch-metadata>
  `);
  const metadata = getWatchMetadataRoot(doc);
  const actions = getWatchActionsContainer(metadata);
  assert.equal(actions?.id, 'actions-inner');
});

test('isValidButtonPlacement requires connected button in metadata actions', () => {
  const doc = makeDoc(`
    <ytd-watch-metadata>
      <div id="actions-inner"><button id="btn"></button></div>
    </ytd-watch-metadata>
  `);
  const metadata = getWatchMetadataRoot(doc);
  const actions = getWatchActionsContainer(metadata);
  const btn = doc.getElementById('btn');
  assert.equal(isValidButtonPlacement(btn, metadata, actions), true);
});

test('needsSaveButtonInjection true when watch page lacks button', () => {
  const doc = makeDoc(`
    <ytd-watch-metadata>
      <div id="title"><h1><yt-formatted-string>Title</yt-formatted-string></h1></div>
      <div id="actions-inner"></div>
    </ytd-watch-metadata>
  `);
  assert.equal(needsSaveButtonInjection(doc, '/watch?v=1'), true);
});

test('needsSaveButtonInjection false when valid button exists', () => {
  const doc = makeDoc(`
    <ytd-watch-metadata>
      <div id="title"><h1><yt-formatted-string>Title</yt-formatted-string></h1></div>
      <div id="actions-inner"><button id="${BUTTON_ID}"></button></div>
    </ytd-watch-metadata>
  `);
  assert.equal(needsSaveButtonInjection(doc, '/watch?v=1'), false);
});
