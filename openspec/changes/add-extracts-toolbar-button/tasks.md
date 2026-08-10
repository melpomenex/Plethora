## 1. Extracts tab

- [x] 1.1 Create `src/components/tabs/ExtractsTab.tsx`: load via `useExtractStore.loadExtracts()` (no document filter), group results by source document, render each group with a document heading and the existing `ExtractsList`
- [x] 1.2 Add empty state ("no extracts yet" + how to create one), loading state, and an error state with a retry button
- [x] 1.3 Wire jump-to-source: activating a group heading / extract source opens a `document-viewer` tab for that document focused on the extract
- [x] 1.4 Register `extracts` in `src/components/tabs/TabRegistry.tsx` (lazy `debugLazy` import, title "Extracts", icon, closable) and in the tab-icon map

## 2. Toolbar button

- [x] 2.1 Add the `extracts` entry to the `buttons` array in `src/components/Toolbar.tsx` — `Scissors` icon, `t("toolbar.extracts")`, group 3 (navigation), with `action` and `backgroundAction` (`addTabInBackground`)
- [x] 2.2 Add `toolbar.extracts` and the extracts-tab strings to all six locales in `src/lib/i18n/locales/` and confirm `i18n-completeness.test.ts` passes

## 3. Toolbar hover expansion

- [x] 3.1 Add `expanded` state to `Toolbar` with `OPEN_DELAY_MS = 120` / `CLOSE_DELAY_MS = 250` constants, pointer enter/leave timers (cleared on unmount), and `focusin`/`focusout` handlers on the container that expand immediately and collapse without delay
- [x] 3.2 Set `data-expanded` and `data-toolbar-position` on the toolbar container; render an `aria-hidden` visible label span in `ToolbarButtonItem` alongside the existing `sr-only` label, and drop the native `title` while expanded
- [x] 3.3 Add expansion CSS in `src/index.css`: collapsed rail keeps its width in flow, expanded surface is absolutely positioned over the content area with a shadow, labels fade/slide in; separate rules for left, right, and top positions
- [x] 3.4 Add a `prefers-reduced-motion: reduce` block disabling the width/opacity transitions while keeping both states functional

## 4. Verification

- [x] 4.1 Add a test for `ExtractsTab` covering the empty, populated, and error states
- [x] 4.2 Add a test for `Toolbar` covering: the Extracts button opens the tab, hover after the open delay sets `data-expanded`, pointer-leave collapses after the close delay, and focusing a button expands the rail
- [x] 4.3 Run the app and confirm in the browser for all three toolbar positions that expansion overlays the content without reflow, and that labels read once under an accessibility check
