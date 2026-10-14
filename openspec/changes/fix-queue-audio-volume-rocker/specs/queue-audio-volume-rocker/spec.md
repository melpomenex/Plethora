## Purpose

Defines how mobile hardware volume keys behave while a podcast or audiobook is playing from the Queue, so users can adjust media volume without losing the existing volume-rocker navigation setting.

## ADDED Requirements

### Requirement: Active queue audio playback preserves hardware volume control

When a podcast or audiobook is actively playing from the mobile Queue, the app SHALL allow hardware VolumeUp and VolumeDown events to reach the device's media-volume controls, regardless of whether the Volume Rocker Scroll setting is `page` or `scroll`. While playback is active, those events SHALL NOT navigate to another queue item or scroll the current item.

#### Scenario: Podcast playback with page navigation configured
- **WHEN** a podcast is playing in the mobile Queue and Volume Rocker Scroll is set to `page`
- **AND** the user presses VolumeUp or VolumeDown
- **THEN** the event reaches the device's media-volume controls
- **AND** the queue item does not change

#### Scenario: Audiobook playback with scroll navigation configured
- **WHEN** an audiobook is playing in the mobile Queue and Volume Rocker Scroll is set to `scroll`
- **AND** the user presses VolumeUp or VolumeDown
- **THEN** the event reaches the device's media-volume controls
- **AND** the current item does not scroll

#### Scenario: Paused queue audio uses the configured navigation mode
- **WHEN** a podcast or audiobook in the mobile Queue is paused and Volume Rocker Scroll is set to `page`
- **AND** the user presses VolumeUp or VolumeDown
- **THEN** the queue navigates to the corresponding previous or next item

#### Scenario: Paused queue audio scrolls in scroll mode
- **WHEN** a podcast or audiobook in the mobile Queue is paused and Volume Rocker Scroll is set to `scroll`
- **AND** the user presses VolumeUp or VolumeDown
- **THEN** the current item's scrollable content scrolls in the corresponding direction

#### Scenario: Volume rocker setting is disabled
- **WHEN** a podcast or audiobook in the mobile Queue is playing or paused and Volume Rocker Scroll is set to `none`
- **AND** the user presses VolumeUp or VolumeDown
- **THEN** the app does not intercept the event and the device's default media-volume behavior applies
