# Design: Native iOS Simulator End-to-End Automation

## 1. Tooling Selection & Architecture

For automating the real native iOS application on the iOS Simulator, we combine **Maestro** (for high-level declarative UI flows) and **`xcrun simctl`** (for lifecycle and container management).

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            E2E Test Orchestrator                            │
│                      (scripts/ios-test/e2e.sh)                              │
│                                                                             │
│  ┌─────────────────────────┐                ┌────────────────────────────┐  │
│  │   xcrun simctl Engine   │                │       Maestro Runner       │  │
│  │                         │                │                            │  │
│  │ • Container injection   │                │ • Declarative YAML flows   │  │
│  │ • Process lifecycle     │                │ • Accessibility ID query   │  │
│  │ • App Group setup       │                │ • Tap / Scroll / Type      │  │
│  │ • State snapshots       │                │ • Assert visible / text    │  │
│  └────────────┬────────────┘                └─────────────┬──────────────┘  │
│               │                                           │                 │
└───────────────┼───────────────────────────────────────────┼─────────────────┘
                │                                           │
                ▼                                           ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Target iOS Simulator (iPhone 17 Pro)                    │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ Plethora iOS App                                                      │  │
│  │                                                                       │  │
│  │  • Accessibility Identifiers (data-testid -> accessibilityIdentifier) │  │
│  │  • Real WKWebView + Real Tauri IPC Bridge                             │  │
│  │  • Real SQLite DB in App Sandbox                                      │  │
│  │  • Swift Plugins: FolderImport, StoreKit, Sherpa TTS                  │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ App Group Container (group.com.plethora.app.shared)                    │  │
│  │  • shares/.ready/ -> shares/.claiming/ -> shares/.completed/          │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Why Maestro over Appium / XCUITest alone:
1. **Speed & Reliability**: Maestro connects directly to the iOS Simulator accessibility hierarchy without running a heavy intermediate WebDriverAgent / Appium server.
2. **Declarative Simplicity**: Flows are written in readable YAML and versioned directly in the repo.
3. **Flakiness Resistance**: Built-in intelligent waiting and retry logic on UI assertions.
4. **Rich Failure Evidence**: Automatically captures high-resolution screenshots and UI hierarchy dumps on failure.

---

## 2. Accessibility Identifier Tagging Strategy

To ensure deterministic, resilient UI querying, critical elements in the React codebase are annotated with stable `data-testid` attributes. WebKit maps `data-testid` directly to native iOS accessibility identifiers in the accessibility tree.

### Standardized Identifier Taxonomy:

| UI Area | Element | Identifier |
|---|---|---|
| **Navigation** | Bottom navigation tabs | `nav-tab-dashboard`, `nav-tab-documents`, `nav-tab-queue`, `nav-tab-review`, `nav-tab-settings` |
| **Documents** | Top toolbar buttons | `btn-import-document`, `btn-scan-folder`, `input-search-documents` |
| **Documents** | Document Card | `document-card-{id}`, `document-title-{id}`, `document-priority-{id}` |
| **Reader** | Main viewport | `reader-viewport`, `reader-header-title`, `btn-close-reader` |
| **Reader** | Navigation controls | `btn-reader-page-next`, `btn-reader-page-prev`, `reader-progress-bar` |
| **Import Dialog** | Dialog host & buttons | `import-dialog-host`, `btn-confirm-import`, `btn-cancel-import` |
| **Toasts** | Status notifications | `toast-notification`, `toast-title`, `toast-message` |
| **Share Banner** | Pending shares notice | `banner-pending-shares`, `btn-accept-shares` |

---

## 3. Core E2E Workflow Definitions

### Flow 1: Startup, Navigation, and Lifecycle Recovery (`01_startup_and_navigation.yaml`)

```yaml
appId: com.plethora.app
---
- launchApp:
    clearState: false
- assertVisible:
    id: "nav-tab-dashboard"
- tapOn:
    id: "nav-tab-documents"
- assertVisible:
    id: "btn-import-document"
- tapOn:
    id: "nav-tab-queue"
- assertVisible:
    id: "nav-tab-queue"
- tapOn:
    id: "nav-tab-review"
- tapOn:
    id: "nav-tab-settings"
- assertVisible:
    text: "Appearance"
- stopApp
- launchApp:
    clearState: false
- assertVisible:
    id: "nav-tab-dashboard"
```

### Flow 2: Document Ingestion and Reader Persistence (`02_document_import_and_read.yaml`)

```yaml
appId: com.plethora.app
---
- launchApp
- tapOn:
    id: "nav-tab-documents"
- runScript: "../scripts/inject-fixture.sh sample-article.epub"
- tapOn:
    id: "btn-import-document"
- assertVisible:
    id: "toast-notification"
- assertVisible:
    text: "Import complete"
- tapOn:
    text: "Sample Article"
- assertVisible:
    id: "reader-viewport"
- swipe:
    direction: UP
- tapOn:
    id: "btn-close-reader"
- stopApp
- launchApp
- tapOn:
    id: "nav-tab-documents"
- assertVisible:
    text: "Sample Article"
```

### Flow 3: iOS Share Extension Handoff (`03_share_extension_handoff.yaml`)

```yaml
appId: com.plethora.app
---
- runScript: "../scripts/inject-share.sh --url https://example.com/article --title 'Shared Story'"
- launchApp
- assertVisible:
    id: "toast-notification"
- assertVisible:
    text: "Shared Story"
```

---

## 4. Test Fixture Injection Architecture

We provide two complementary fixture injection mechanisms:

1. **Direct App Container Injection (Fast CI Tier)**:
   - Queries the active simulator app data container:
     ```bash
     CONTAINER_DIR=$(xcrun simctl get_app_container "$SIMULATOR_UDID" com.plethora.app data)
     cp "tests/ios/fixtures/$FIXTURE_FILE" "$CONTAINER_DIR/Documents/imports/"
     ```
   - Triggers import via internal test hook or file-system watcher. Takes < 50ms.

2. **App Group Share Container Injection (Share Extension Tier)**:
   - Queries the shared App Group container:
     ```bash
     GROUP_DIR=$(xcrun simctl get_app_container "$SIMULATOR_UDID" com.plethora.app groups/group.com.plethora.app.shared)
     mkdir -p "$GROUP_DIR/shares/.ready"
     cp "$FIXTURE_MANIFEST" "$GROUP_DIR/shares/.ready/$SHARE_ID.json"
     ```
   - Launching Plethora triggers the native `staged_shares.rs` sweep, claiming and importing the file.

---

## 5. Real-Device Verification Boundary

To ensure development velocity without compromising quality, we explicitly define the testing boundary:

```text
┌───────────────────────────────────────────────┬───────────────────────────────────────────────┐
│     Automated iOS Simulator Coverage          │         Physical Device Gate Coverage         │
│         (Runs unattended in CI / Nightly)     │          (Release Gate / TestFlight)          │
├───────────────────────────────────────────────┼───────────────────────────────────────────────┤
│ • WKWebView JS engine & DOM rendering         │ • Real StoreKit 2 App Store Sandbox purchases │
│ • React state management & navigation         │ • Camera & hardware scanner performance       │
│ • SQLite queries & migrations                 │ • Physical thermal throttling & CPU bounds    │
│ • Bounded chunked staging memory profile      │ • OS Jetsam memory kills under real limits    │
│ • Share Extension App Group handoff contract  │ • Lock-screen Now Playing controls & audio    │
│ • Swift plugin compilation & basic FFI        │ • Bluetooth headphone disconnection events    │
│ • Reader pagination & position saving         │ • Real iCloud Drive / Files provider quirks   │
└───────────────────────────────────────────────┴───────────────────────────────────────────────┘
```
