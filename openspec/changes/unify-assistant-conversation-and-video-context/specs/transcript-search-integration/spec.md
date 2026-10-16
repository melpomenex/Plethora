## MODIFIED Requirements

### Requirement: Transcript search matches navigate to timestamp
When a search result or Assistant citation originates from a YouTube, video, or audio transcript, selecting the search result, citation card, or inline `[MM:SS]` / `[HH:MM:SS]` timestamp link in the Assistant response SHALL navigate the user to the corresponding timestamp in the media player and highlight the matched transcript segment.

#### Scenario: Search result navigation to timestamp
- **WHEN** a user clicks a search result or Assistant citation card that matches a transcript segment
- **THEN** the media document opens in the viewer
- **AND** the media player seeks to the timestamp of the matched segment
- **AND** the matched text is highlighted in the transcript view

#### Scenario: Inline timestamp link in Assistant prose seeks active video
- **WHEN** an Assistant response for a video contains a timestamp reference such as `[14:25]` or `[1:02:10]` and the user clicks it
- **THEN** the active YouTube or media player seeks directly to that timestamp
