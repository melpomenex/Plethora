## Purpose

Defines how the app fetches, caches, and skips sponsor segments reported by the SponsorBlock service, and the user settings that govern it, consistently across the YouTube, local-video, and audiobook players.

## ADDED Requirements

### Requirement: SponsorBlock segment skipping is user-configurable

The system SHALL provide SponsorBlock settings that the user can reach and change, and those settings SHALL govern whether segments are fetched and whether playback skips them.

#### Scenario: Disabling SponsorBlock

- **GIVEN** the user has disabled SponsorBlock
- **WHEN** a video, local video, or audiobook is opened
- **THEN** no SponsorBlock segment request is made
- **AND** playback never seeks forward on its own
- **AND** no SponsorBlock status indicator is shown

#### Scenario: Re-enabling SponsorBlock

- **GIVEN** the user has disabled SponsorBlock and later re-enables it
- **WHEN** they play media that has known segments
- **THEN** segments are fetched and skipping resumes without restarting the app

#### Scenario: Settings persist across restarts

- **WHEN** the user changes any SponsorBlock setting and restarts the app
- **THEN** the setting retains the value the user chose

#### Scenario: Default state on a new install

- **GIVEN** a fresh install with no stored settings
- **THEN** SponsorBlock is enabled
- **AND** the categories the user is most likely to want skipped are enabled and the remainder are not

### Requirement: Category selection governs which segments are skipped

The user SHALL be able to choose which SponsorBlock categories cause a skip, and the system SHALL skip only the categories that are enabled.

#### Scenario: Only one category enabled

- **GIVEN** the user has enabled only the sponsor category
- **WHEN** playback reaches a segment of another category
- **THEN** playback does not seek and no skip notification is shown

#### Scenario: A category is turned off mid-playback

- **GIVEN** the user turns a category off while a video is playing
- **WHEN** playback next reaches a segment of that category
- **THEN** playback does not seek for that segment

#### Scenario: Several categories enabled

- **GIVEN** the user has enabled several categories
- **WHEN** playback reaches a segment of any enabled category
- **THEN** playback seeks past that segment

### Requirement: Skips are announced and reversible

A skip SHALL be visible to the user as it happens, identified by the segment's category, and SHALL offer a way to undo it for the segment just skipped.

#### Scenario: Skip notification

- **WHEN** playback skips a segment
- **THEN** the user sees a notification naming the skipped category
- **AND** the notification offers an undo action

#### Scenario: Undo returns to the segment

- **GIVEN** a skip notification is showing
- **WHEN** the user activates undo
- **THEN** playback returns to the start of the skipped segment
- **AND** that segment is not skipped again for the remainder of that playback

#### Scenario: Notifications turned off

- **GIVEN** the user has turned skip notifications off
- **WHEN** playback skips a segment
- **THEN** the seek still happens
- **AND** no notification is shown

### Requirement: Segment requests are bounded and cached

A SponsorBlock segment request SHALL carry a timeout, and a successful result SHALL be reused for the same media within a configurable duration so that repeated plays do not re-request the same segments.

#### Scenario: Service is slow or unreachable

- **GIVEN** the SponsorBlock service does not respond
- **WHEN** the user plays a video
- **THEN** playback proceeds normally once the request times out
- **AND** the failure is not shown as a media error
- **AND** no repeated request is issued for the same video during that session

#### Scenario: Replaying the same video

- **GIVEN** the user has already watched a video whose segments were fetched
- **WHEN** they watch the same video again within the configured cache duration
- **THEN** the cached segments are used and no second request is made

#### Scenario: Cache duration is zero

- **GIVEN** the user has set the segment cache duration to zero
- **WHEN** the user plays a video
- **THEN** segments are requested per playback

#### Scenario: Switching videos

- **GIVEN** segments are cached for one video
- **WHEN** the user opens a different video
- **THEN** the new video's segments are requested and the previous video's cached entry is not used

#### Scenario: Service returns no segments

- **GIVEN** the SponsorBlock service has no segments for a video
- **WHEN** the user plays that video
- **THEN** playback is unaffected and no SponsorBlock indicator is shown

### Requirement: Skipping does not fight the user's own seeking

Automatic skipping SHALL NOT override a seek the user initiated, including a resume-position restore at video start, and SHALL NOT re-skip a segment the user has already passed.

#### Scenario: Resume position is restored

- **GIVEN** a video resumes inside a sponsored segment
- **WHEN** playback begins
- **THEN** the video is not immediately skipped past the restored position

#### Scenario: User seeks backwards into a skipped segment

- **GIVEN** a segment was skipped earlier in the same playback
- **WHEN** the user seeks backwards into that segment
- **THEN** the segment is not skipped again automatically

#### Scenario: User scrubs with the timeline

- **GIVEN** the user is dragging the playback timeline
- **WHEN** the playhead passes over an enabled segment
- **THEN** the seek completes at the position the user chose

### Requirement: Skip behaviour is identical across media players

The YouTube player, the local video player, and the audiobook player SHALL apply the same settings, category selection, notification, undo, and caching behaviour.

#### Scenario: Same setting, different player

- **GIVEN** the user has SponsorBlock enabled with a particular category selection
- **WHEN** the same video is played as an embedded YouTube video and as a local file
- **THEN** the same segments are skipped in both

#### Scenario: Disabling applies to every player

- **GIVEN** the user disables SponsorBlock
- **WHEN** they play media in any of the three players
- **THEN** no SponsorBlock request is made and no automatic seek occurs
