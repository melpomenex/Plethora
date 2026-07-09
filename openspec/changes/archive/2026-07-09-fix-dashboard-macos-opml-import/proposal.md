## Why

This proposal addresses two key issues in the application:
1. Some macOS users experience a blank window or freeze on startup where the main dashboard does not load. This is caused by tauri-plugin-window-state attempting to restore a corrupted, empty, or invalid window state file, or hit macOS-specific deadlocks during state restoration.
2. The OPML import feature in the RSS Tab contains a regression where many feed links (specifically those using `feed://` or `feed:` protocols) are silently skipped, and case-sensitive XML tag queries fail for non-lowercase files.

## What Changes

1. **Auto-Validation of Window State File on Startup**: Check the `.window-state.json` file inside the setup block of the Tauri app. If the file exists but is corrupted, empty, or fails to parse, automatically delete it to prevent startup hangs.
2. **Window State Recovery Command Line Option**: Support a `--clear-window-state` (or `--reset-window-state`) CLI argument to allow users to force-delete the persisted window state file.
3. **Application Menu Item to Clear Window State**: Add a menu option under the native application menu on macOS to clear the window state. This ensures users can reset the window state even if the WebView window is frozen or black, since the native OS menu bar runs on the main OS thread.
4. **Fix OPML Protocol Parsing & Case Sensitivity**: Normalize `feed://` and `feed:` protocols to standard `https://` or `http://` in the frontend `importOPML` utility, matching the Rust backend's parsing behavior. Also update element traversal to be case-insensitive to ensure outlines are successfully parsed from any OPML file format.

## Capabilities

### New Capabilities
- `window-state-recovery`: Clear/reset tauri-plugin-window-state on macOS/desktop to recover from black screens or initialization deadlocks.

### Modified Capabilities
- `rss-import-navigation`: Fix OPML feed import to support standard feed protocols (`feed://`, `feed:`) and handle mixed-case outline/body tags.

## Impact

- `src-tauri/src/lib.rs`: Automatic window state validation on startup, `--clear-window-state` command-line argument handling, and macOS Application Menu update with "Clear Window State".
- `src/api/rss.ts`: Normalize feed URLs in `importOPML` and implement case-insensitive tag extraction.
