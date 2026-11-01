## ADDED Requirements

### Requirement: Video extract queue items open as video segments

An item of type `video-extract` SHALL be presented as the extract segment, not as its source video document. This applies to the Queue list's primary action, sequential Scroll Mode, and optimal Scroll Mode. The source video document SHALL remain available as a secondary navigation target, but the segment's title, time range, playback position, and rating controls MUST remain owned by the extract.

Selecting a video-extract queue item SHALL pass the canonical extract ID to the viewer. The viewer SHALL resolve the parent source, verify the relationship, seek to the segment start, and preserve the segment end. The parent document's rating controls MUST NOT be shown as a replacement for extract rating controls.

#### Scenario: Clicking a video extract in the Queue list
- **WHEN** the user activates a video-extract row in the Reading Queue
- **THEN** the source video opens focused on that extract's segment
- **AND** playback starts at the segment start and is bounded by the segment end
- **AND** the parent video is not opened as an ordinary document review

#### Scenario: Video extract reached in sequential Scroll Mode
- **WHEN** Scroll Mode advances to a queue row of type `video-extract`
- **THEN** the row remains a video-extract item
- **AND** the segment player and extract rating controls are presented
- **AND** the parent video's document rating controls are not presented

#### Scenario: Video extract in optimal Scroll Mode
- **WHEN** an optimal session is composed with the Extracts share above zero
- **THEN** eligible video extracts may be selected into the Extracts share
- **AND** they render as video segments rather than being dropped or converted to documents

#### Scenario: Missing source
- **WHEN** the source video cannot be resolved
- **THEN** the item shows a recoverable source error
- **AND** it is not silently converted into a blank document review

#### Scenario: Return to source document
- **WHEN** the user is viewing a video-extract segment
- **THEN** a secondary action can open the full source video document
- **AND** returning to the extract preserves the extract identity and does not create a duplicate queue item

### Requirement: Video extracts follow the Extracts item-type selection

Video extracts SHALL be governed by the Queue's existing Extracts item-type toggle and the Extracts composition share. Unchecking Extracts SHALL remove video extracts from sequential and optimal sessions together with text extracts. Video extracts MUST NOT be silently governed by the Documents toggle or consume the Documents share.

#### Scenario: Extracts unchecked
- **WHEN** the user unchecks Extracts in the Queue customization
- **THEN** no text extract or video extract appears in the resulting Scroll Mode session

#### Scenario: Extracts only
- **WHEN** Documents and Flashcards are unchecked and Extracts is checked
- **THEN** the session may contain both text extracts and video extracts
- **AND** no ordinary document or flashcard appears

#### Scenario: Extracts share is zero
- **WHEN** the Optimal Session Extracts composition share is zero
- **THEN** video extracts contribute no items to that session
- **AND** their queue membership is unchanged
