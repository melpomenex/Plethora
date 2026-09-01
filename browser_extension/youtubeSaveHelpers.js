/* YouTube save-button placement helpers — dependency-free, testable in Node. */
(function exposePlethoraYouTubeSaveHelpers(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.PlethoraYouTubeSaveHelpers = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createYouTubeSaveHelpers() {
  const BUTTON_ID = 'plethora-youtube-save-btn';

  function isWatchPagePath(pathname) {
    return typeof pathname === 'string' && pathname.startsWith('/watch');
  }

  function getWatchMetadataRoot(doc) {
    if (!doc || typeof doc.querySelector !== 'function') return null;
    return doc.querySelector('ytd-watch-metadata');
  }

  function getWatchActionsContainer(metadata) {
    if (!metadata || typeof metadata.querySelector !== 'function') return null;
    return (
      metadata.querySelector('#actions-inner') ||
      metadata.querySelector('#actions') ||
      metadata.querySelector('#top-level-buttons')
    );
  }

  function getWatchTitleElement(metadata) {
    if (!metadata || typeof metadata.querySelector !== 'function') return null;
    return metadata.querySelector('#title h1 yt-formatted-string, h1 yt-formatted-string');
  }

  function isValidButtonPlacement(button, metadata, actions) {
    if (!button || !metadata || !actions) return false;
    if (!button.isConnected) return false;
    return metadata.contains(button) && actions.contains(button);
  }

  /**
   * True when ensure should attempt injection (watch page with missing/stale button).
   */
  function needsSaveButtonInjection(doc, pathname) {
    if (!isWatchPagePath(pathname)) return false;
    const metadata = getWatchMetadataRoot(doc);
    const actions = getWatchActionsContainer(metadata);
    const title = getWatchTitleElement(metadata);
    if (!metadata || !actions || !title) return false;
    const existing = doc.getElementById(BUTTON_ID);
    if (!existing) return true;
    return !isValidButtonPlacement(existing, metadata, actions);
  }

  return {
    BUTTON_ID,
    isWatchPagePath,
    getWatchMetadataRoot,
    getWatchActionsContainer,
    getWatchTitleElement,
    isValidButtonPlacement,
    needsSaveButtonInjection,
  };
});
