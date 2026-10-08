## Purpose

Gives every meaningful object and list in Plethora a consistent, discoverable right-click menu that reuses existing actions, so mouse users get the same speed as keyboard/touch paths without duplicated logic.

## Requirements

### Requirement: Shared context-menu behavior is consistent everywhere

All app-wide context menus SHALL share one trigger, positioning, dismissal, and accessibility contract: right-click (`contextmenu` event, `preventDefault`) opens the menu; Escape, outside-click/right-click-elsewhere, scroll-resize, or selecting an action closes it; only one menu is visible at a time; the menu is clamped into the viewport; menu items expose ARIA `menu`/`menuitem` roles with arrow-key navigation and focus return; on touch/small viewports the same items render in the existing bottom-sheet variant. Menu actions SHALL dispatch to the view's existing handler and SHALL NOT re-implement behavior. Inapplicable actions SHALL be hidden; temporarily unavailable actions SHALL be shown disabled with a reason via tooltip/`title`. Destructive items SHALL be grouped last behind a separator with danger styling and keep their existing confirm flow.

#### Scenario: Right-click opens exactly one clamped menu
- **WHEN** the user right-clicks a supported row or card
- **THEN** the native browser menu is suppressed and exactly one app menu appears near the cursor, fully inside the viewport

#### Scenario: Dismissal paths all close the menu
- **WHEN** a context menu is open and the user presses Escape, clicks outside, scrolls the container, or picks an action
- **THEN** the menu closes and focus returns to the invoking element

#### Scenario: Only one menu at a time
- **WHEN** a menu is open and the user right-clicks a second object
- **THEN** the first menu closes and only the second object's menu is visible

#### Scenario: Touch fallback shows the same actions
- **WHEN** the app runs in the mobile shell and the user long-presses a supported row
- **THEN** the same item set appears as a bottom sheet with identical labels, order, and disabled states

#### Scenario: Editable fields keep native behavior
- **WHEN** the user right-clicks inside a text input, textarea, or content-editable element that defines no app menu
- **THEN** no app menu appears and the native edit menu (cut/copy/paste) is preserved

### Requirement: Review deck rows expose deck actions

Each deck row on Review Home (and the Review Decks modal) SHALL expose a context menu with, in order: Start review / Review deck, Preview cards, Set as active focus (or Clear focus when already active), Rename deck, Edit tags, Export deck (.apkg), separator, Delete deck (danger). `Start review` SHALL be the emphasized primary item and SHALL be disabled only when the deck has zero cards. `Delete deck` SHALL keep the existing deck-delete confirm flow. Right-click SHALL NOT change the current deck selection or start a session by itself; it only opens the menu. The Deck Tag Manager rows SHALL expose Remove tag and Copy tag name; its deck headers SHALL reuse the deck-row menu.

#### Scenario: Deck right-click offers good-UX actions without side effects
- **WHEN** the user right-clicks the "The Ape that Understood the Universe" deck row from the screenshot
- **THEN** the menu shows Start review, Preview cards, Set as active focus, Rename, Edit tags, Export, Delete — and the deck selection and review queue are unchanged until an item is picked

#### Scenario: Empty deck disables start but keeps management
- **WHEN** the user right-clicks "The Canceling of the American Mind" (No cards yet)
- **THEN** Start review and Preview cards are shown disabled, while Rename, Edit tags, Create cards, and Delete remain enabled

#### Scenario: Deck menu actions reuse existing handlers
- **WHEN** the user picks Rename, Edit tags, Export, or Delete from the deck menu
- **THEN** the same dialog/store path runs as the existing Deck Tag Manager or deck-header button (same `useStudyDeckStore` mutation, same confirm, same toast)

### Requirement: Documents surfaces expose document actions

Document rows/cards in Documents list and grid (and floor/folder/tag rows where they exist) SHALL expose: Open, Open in new tab, Rename, Manage tags, Move to folder/collection, Duplicate (where supported), Export/download, separator, Delete (danger). Folder/tag rows SHALL expose Rename, Delete/Remove, and Open filtered view instead of document actions. The menu SHALL NOT fire on plain container background — background right-click either shows a view menu (New document/folder, Sort, View density) or nothing, never a document-object menu.

#### Scenario: Document row menu opens without navigating
- **WHEN** the user right-clicks a document row
- **THEN** the menu appears, the document is not opened, and picking Open runs the same handler as left-click

#### Scenario: Background right-click never acts on a random document
- **WHEN** the user right-clicks empty space in the Documents view
- **THEN** no document-specific menu appears (either a view-level menu or nothing)

### Requirement: Queue items expose queue actions via native right-click

Every queue item SHALL expose its existing `QueueContextMenu` actions through a native right-click anywhere on the row, not only the ⋯ button: Start review/open, Edit card (learning-items only), Smart postpone, Mark done/dismiss, Copy title/link, separator, Remove from queue (danger, existing confirm). Eligibility rules SHALL match the existing menu (e.g. only postponable `itemType`s show Smart postpone). The ⋯ button SHALL remain and open the identical item set for touch/keyboard users.

#### Scenario: Queue row right-click matches ⋯ menu
- **WHEN** the user right-clicks a queue row versus opening its ⋯ button
- **THEN** both menus show the same items in the same order with the same enabled states

#### Scenario: Non-postponable item hides postpone
- **WHEN** the user right-clicks a queue item whose `itemType` is not postponable
- **THEN** Smart postpone is hidden (not disabled) and all other applicable actions remain

### Requirement: Library lists expose playback and collection actions

Podcast episode rows, RSS article rows, Audiobook rows/items, Scroll Mode items, and Document Q&A source rows SHALL each expose a right-click menu appropriate to the type: Play/Open now, Play next / Add to queue, Mark played-read / Mark unread, Download/offline (where supported), Add to queue/learning list, Copy link, View show/feed details, separator, Remove/Delete/Hide (danger, existing confirm). Episode-specific actions SHALL target the right-clicked episode, not the now-playing one. Mark actions SHALL reflect current state (e.g. played episode shows Mark as unplayed).

#### Scenario: Right-clicked episode is the target
- **WHEN** episode A is playing and the user right-clicks episode B and picks Mark played
- **THEN** episode B (not A) is marked played via the existing episode handler

#### Scenario: Played state flips the toggle label
- **WHEN** the user right-clicks an already-played episode
- **THEN** the menu shows Mark as unplayed instead of Mark as played

### Requirement: Flashcards, tabs, and navigation expose management actions

Flashcard/learning-card rows (Studio lists, card browsers) SHALL expose: Edit, Preview, Suspend/Unsuspend (or Hide/Show), Copy front text, separator, Delete (danger). Tab-bar tabs (where tabs exist) SHALL expose: Close, Close others, Close to the right, Pin/Unpin (where supported). Sidebar navigation items SHALL expose only safe actions (e.g. Open, Open in new tab/split where supported, Rename where the object supports it) and SHALL NOT offer destructive actions the view itself does not offer. Menus SHALL show keyboard shortcuts alongside items whose action already has one.

#### Scenario: Flashcard menu keeps edit path single-sourced
- **WHEN** the user picks Edit from a flashcard row menu
- **THEN** the same editor dialog opens as the row's Edit button with the same save path

#### Scenario: Sidebar never invents destructive actions
- **WHEN** the user right-clicks a sidebar nav item
- **THEN** the menu contains only actions the destination view already supports (no orphan Delete/Remove entries)
