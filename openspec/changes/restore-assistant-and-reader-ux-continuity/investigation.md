# Technical Investigation: Assistant & Reader UX Continuity

## 1. Problem Evidence

1. **Screenshot 01**: In the EPUB reader, table text was crushed into single-character columns (`b \n r \n e \n a \n k \n i \n n \n g`), destroying legibility.
2. **Screenshot 02**: In dark/midnight theme mode, card text was rendered in dark charcoal on a dark navy surface, failing basic contrast checks.
3. **Screenshot 15 & Screenshot 16**: Switching between queue items or tabs caused the Assistant message pane to snap abruptly to top/bottom, triggering a flashing "Latest message" jump button.
4. **Screenshot 05**: An empty chat speech bubble appeared while the assistant was thinking or when streaming chunks were delayed.

## 2. Root Cause Analysis

1. **Unconstrained Table CSS (`src/components/viewer/EPUBViewer.tsx:1078`)**:
   `table` was assigned `max-width: 100% !important; border-collapse: collapse;` without allowing horizontal overflow. The iframe layout engine resolved column widths by dividing available viewport space equally, causing severe word breaking.
2. **Theme Color Mappings (`src/themes/builtin.ts:420`)**:
   The Midnight theme mapped muted text colors to dark slate instead of light slate, producing a contrast ratio of ~1.8:1 against the dark background.
3. **Volatile Compound Scroll Keys (`src/components/assistant/AssistantPanel.tsx:891`)**:
   `scrollKey` incorporated `mobilePresentation?.viewIdentity` and `sessionKey`. Whenever the user moved through items in the queue, `scrollKey` changed, causing `readPosition(key)` to miss cache and reset scroll to `{ follow: true, top: 0 }`.
4. **Premature Message Bubble Mounting (`src/components/assistant/AssistantPanel.tsx:1420`)**:
   A message bubble was rendered immediately upon stream initialization even when `message.content` was an empty string `""`.

## 3. Remediation Strategy

- Add `overflow-x: auto` wrapper and `min-width: max-content` styling to reader tables.
- Adjust theme tokens in `builtin.ts` to ensure 4.5:1 WCAG AA contrast.
- Anchor scroll cache to `conversationId` and preserve relative offset.
- Suppress bubble rendering for empty strings unless `isLoading` is active with typing indicator.
