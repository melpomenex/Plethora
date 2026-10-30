## Purpose

Preserve the user's place in an Assistant conversation and its reader while allowing deliberate following of streamed replies.

## ADDED Requirements

### Requirement: Conversation updates follow bottom only by user intent
A conversation within 48 CSS pixels of its bottom SHALL follow new output unless the user intentionally scrolls upward. While reading earlier messages, streamed output and unrelated rerenders SHALL preserve the visible message anchor/offset and offer a Latest messages action. Returning to bottom or invoking that action SHALL restore following. Reduced-motion preferences SHALL apply to deliberate navigation.

#### Scenario: Stream while reading history
- **WHEN** the user scrolls above the near-bottom threshold during a streamed reply
- **THEN** later chunks do not steal position and the Latest messages action becomes available

#### Scenario: Stream at bottom
- **WHEN** the conversation is following bottom and a reply grows
- **THEN** the newest content remains visible without jumping to the top

### Requirement: Scroll restoration is keyed to the conversation and hydration state
Closing/reopening the Assistant, switching tabs, and returning to an existing conversation SHALL restore that conversation's visible message anchor after its content is ready. Late media/card layout changes SHALL preserve that anchor. Switching conversations SHALL NOT reuse another conversation's offset; unrelated provider/section/control changes SHALL NOT reset it.

#### Scenario: Reopen after history hydration
- **WHEN** an existing conversation reopens and its history/images load asynchronously
- **THEN** its saved anchor is restored once for that hydration and remains stable as content settles

### Requirement: Assistant layout changes preserve the reader's position
Opening, closing, resizing, or changing Assistant context SHALL preserve the associated document's reader position and SHALL NOT persist a premature zero position while reader content is loading.

#### Scenario: Reader and Assistant together
- **WHEN** the user opens and closes the Assistant midway through a document or queue item
- **THEN** the reader remains at the same source locator after layout and hydration complete
