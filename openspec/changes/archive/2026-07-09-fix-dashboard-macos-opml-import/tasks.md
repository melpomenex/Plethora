## 1. Window State Recovery (Rust)

- [x] 1.1 In `src-tauri/src/lib.rs` inside the `run()` function, check `std::env::args()` for `--clear-window-state` or `--reset-window-state` and delete the `.window-state.json` file if it exists.
- [x] 1.2 In `src-tauri/src/lib.rs` inside the `setup` hook, check if `.window-state.json` exists in `app.path().app_config_dir()`. Read the file and parse it as JSON. If empty or invalid, delete it to prevent startup hangs.
- [x] 1.3 In `src-tauri/src/lib.rs` macOS menu setup, add a native application menu item "Clear Window State" with ID `clear-window-state` under the main "Incrementum" submenu.
- [x] 1.4 In `src-tauri/src/lib.rs` menu event handler, catch the `clear-window-state` event, delete `.window-state.json`, and show a dialog using `tauri-plugin-dialog` prompt to ask the user to restart.

## 2. OPML Import Regression Fix (TypeScript)

- [x] 2.1 In `src/api/rss.ts` inside `importOPML`, normalize `feed://` to `https://` and `feed:` to empty/standard prefix before running the regex protocol check.
- [x] 2.2 In `src/api/rss.ts` inside `importOPML`, locate the `body` tag and children `outline` tags case-insensitively instead of relying on `xmlDoc.querySelectorAll("body > outline")`.
- [x] 2.3 Verify and test OPML imports in Tauri and browser mode, ensuring feeds are successfully subscribed and folders created.
