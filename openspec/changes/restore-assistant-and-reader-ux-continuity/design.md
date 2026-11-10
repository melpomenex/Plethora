# Architectural Design: Restore Assistant & Reader UX Continuity

## Problem Diagnosis

### 1. Reader Table Crushing
In `src/components/viewer/EPUBViewer.tsx:1078-1082`:
```css
table {
  max-width: 100% !important;
  border-collapse: collapse !important;
  margin: 1em 0 !important;
}
```
When an EPUB document contains a table with 4+ columns (as shown in Screenshot 01), the iframe restricts `table` to 100% of the viewport width. Because the table lacks `overflow-x: auto` wrapping or column `min-width`, the browser engine shrinks every column down to the width of a single character, wrapping text like:
```
b
r
e
a
k
i
n
g
```
This renders tables completely unreadable.

### 2. Dark Theme Contrast Failure
In `src/themes/builtin.ts:420`:
Several dark theme definitions (particularly Midnight and High Contrast Dark) mapped secondary text or card body variables to near-black hex codes (e.g., `#1e293b` text on `#0f172a` surface), yielding contrast ratios below 2:1 (`screenshot_02`).

### 3. Assistant Conversation Scroll Reset
In `src/components/assistant/AssistantPanel.tsx:891`:
```ts
const scrollKey = JSON.stringify([sessionKey, mobilePresentation?.viewIdentity ?? null, paneId ?? null, tabId ?? null]);
const conversationScroll = useAssistantConversationScroll(messagesContainerRef, scrollKey, hydratedSessionKey === sessionKey, messages);
```
Whenever the user moves to the next item in Scroll Mode or switches between reader tabs, `mobilePresentation?.viewIdentity` or `sessionKey` changes.
In `useAssistantConversationScroll.ts:93`:
```ts
const position = messages.length === 0 ? { follow: true, top: 0 } : readPosition(key) ?? { follow: true, top: 0 };
```
Because the key is unique per queue item, switching queue items encounters an uninitialized position, falling back to `{ follow: true, top: 0 }`.
This violently resets the scroll position to the bottom or top of the conversation and triggers `setShowLatest(!position.follow)`, causing the "Latest message" floating button to flash repeatedly (`screenshot_15`, `screenshot_16`).

### 4. Empty Assistant Bubbles
When an assistant stream starts, an initial message record with an empty string `content: ""` is added to the store. If the stream encounters a delay, network hiccup, or dropped initial chunk, an empty speech bubble is rendered to the user (`screenshot_05`).

## Architectural Solutions

### 1. Responsive Table Layout with Scroll Wrapping
In `src/components/viewer/EPUBViewer.tsx` and `src/styles/reading.css`:
Inject table rules into the EPUB rendition styles:
```css
.table-wrapper, table {
  display: block !important;
  width: 100% !important;
  max-width: 100% !important;
  overflow-x: auto !important;
  -webkit-overflow-scrolling: touch !important;
}

table {
  border-collapse: collapse !important;
  margin: 1.5em 0 !important;
  min-width: max-content !important;
}

th, td {
  padding: 0.6em 1em !important;
  white-space: nowrap !important;
  min-width: 120px !important;
}
```
Tables maintain natural column widths, and users smoothly scroll horizontally without text breaking vertically.

### 2. WCAG AA Contrast Audit & Correction
Audit all theme color tokens in `src/themes/builtin.ts`:
- Ensure foreground text on muted/card surfaces has minimum 4.5:1 contrast against background colors.
- In Midnight theme: replace `#1e293b` muted text with `#94a3b8` on dark backgrounds (`#0f172a`).

### 3. Stable Assistant Conversation Anchoring
1. Separate session identity from ephemeral view presentation:
   Store scroll offsets keyed primarily by `conversationId` rather than compound view identities.
2. In `useAssistantConversationScroll.ts`:
   When `key` changes, check if the underlying `conversationId` matches an existing cached position. If so, retain the last measured relative scroll percentage instead of resetting to top/bottom.
3. Suppress the "Latest message" button during programmatic tab transitions.

### 4. Empty Message Bubble Filtering
In `AssistantPanel.tsx`:
Only render message bubbles if `message.content.trim().length > 0` or if `message.isLoading` is true (rendering an animated typing indicator instead of an empty white box).
