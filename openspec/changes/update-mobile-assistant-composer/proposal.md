# Mobile Assistant composer: chat-app input bar with a slash-command menu

## Why

On phones, the Assistant spends its scarce vertical space on chrome instead of conversation: the sheet stacks a Chat/Commands tab row, a source row and a panel toolbar above the messages, and above the keyboard sit a tools hint, a stacked attach/send button column, a dictation row with status text, and a persistent quick-actions row. The result is a cramped reading area in a surface whose entire purpose is reading answers. The composer should feel like the input bar users already know from chat apps (reference: ChatGPT mobile) and the commands should live behind it, not on top of the conversation.

## What Changes

- Recompose the mobile Assistant composer as one chat-style input bar: a single rounded text surface with a leading **+** control, inline dictation (microphone) and a send control that replaces it while there is text; attachments and dictation status no longer occupy their own full-width rows.
- The **+** control opens one searchable, bottom-anchored command menu on top of the composer. It lists the Assistant's slash commands (`/help`, `/tools`, `/20rules`, `/clear`), the shared command-registry actions (same registry, matcher, availability gates and executor as the keyboard palette), and the image-attachment entry. Choosing a chat command composes it into the input for confirmation; choosing a registry command executes through the shared executor as it does today.
- **BREAKING** (UI): remove the Chat/Commands mode tab row from the mobile sheet header on phones. The searchable command surface moves into the **+** menu; chat stays the only sheet mode. This supersedes the unarchived "Searchable command access alongside conversation" requirement in `mobile-assistant-gesture-haptics` (reconciliation recorded in design.md).
- Reduce persistent mobile chrome so more of each detent is conversation: collapse the sheet header to handle + compact context/scope row + close, fold "New conversation" into the **+** menu or header overflow, and drop the always-visible "/tools" hint row and quick-action chips from the mobile composer (they remain on desktop).
- Keep every existing capability reachable: image attach, pinned-selection chip, section-mention cards, dictation with consent/error states, scope selector, source attach/remove, message actions, and the shared command semantics. Desktop presentation is unchanged.
- Localize the new surface (menu title/search placeholder/attachment item wording) across `de`, `en`, `es`, `fr`, `ja`, `zh`, replacing the currently hardcoded Chat/Commands labels.

## Capabilities

### New Capabilities

- `mobile-assistant-composer`: the mobile Assistant composer bar (single input surface, leading + menu, inline dictation/send states, attachment entry), its searchable slash-command and registry-command menu, and the chrome budget that keeps conversation space maximal inside the sheet.

### Modified Capabilities

<!-- None: the only requirement this change logically supersedes (the Commands-mode tab) lives in the still-unarchived `mobile-assistant-gesture-haptics` change, not in openspec/specs. MODIFIED deltas against a base spec that does not exist are refused at archive time, so this change declares a new capability and records the reconciliation instead. -->

## Impact

Affected code: `src/components/assistant/AssistantPanel.tsx` (composer + mobile toolbar rows), `src/components/assistant/mobile/MobileAssistantHost.tsx` (sheet header/mode tabs, composer chrome measurement), `src/components/assistant/mobile/MobileAssistantCommands.tsx` (repurposed as the **+** menu content), `src/components/assistant/mobile/mobile-assistant.css`, `src/components/assistant/ComposerDictationControl.tsx`, i18n locale files, and the existing mobile host/commands/AssistantPanel tests. Reuse `md3/Menu`-style anchoring, `commandPalette/registry.tsx` (`buildCommandRegistry`, `matchCommands`), `commandPalette/executeCommand.ts`, the existing dictation hook, and the existing slash-command handler in `AssistantPanel`'s send path; no new dependencies.

Excluded surfaces: `AskSheet` (selection Ask) keeps its own composer; the desktop Assistant panel keeps the current composer; no AI orchestration, provider, persistence, gesture/detent, or native changes.

Overlapping changes: consumes the implemented portions of the unarchived `mobile-assistant-gesture-haptics` change (sheet hosting, detents, dictation) and reconciles its Commands-mode requirement — see the reconciliation ledger in design.md. `mobile-ask-sheet` keeps its composer requirements unchanged.

Non-goals: pixel-copying ChatGPT, voice-mode streaming conversations, model switching redesign, composer drag-and-drop beyond the existing attach menu entry, and any desktop redesign.
