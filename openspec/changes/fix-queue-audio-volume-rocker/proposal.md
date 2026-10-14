## Why

On mobile, the Queue can play a podcast or audiobook while the existing Volume Rocker Scroll setting is enabled, but the embedded reader consumes the phone's volume key events for page or scroll navigation even during playback. Users then cannot adjust media volume with the hardware rocker while listening.

## What Changes

- Give active podcast and audiobook playback in the mobile Queue priority over volume-rocker page and scroll navigation, allowing volume keys to reach the device's media-volume controls.
- Keep the configured page or scroll behavior available when the queue audio is paused, and keep the existing setting and its defaults unchanged.
- Apply the same playback-aware behavior to podcast and audiobook queue items.

## Capabilities

### New Capabilities

- `queue-audio-volume-rocker`: Defines how mobile hardware volume keys behave while podcast or audiobook playback is active in the Queue.

### Modified Capabilities

None.

## Impact

- Queue-hosted audio handling in `src/components/viewer/DocumentViewer.tsx` and, if needed, its `src/pages/QueueScrollPage.tsx` host.
- Reuses the existing `volumeRockerScroll` setting and volume-key event handling; no new setting, dependency, persistence, or native permission is expected.
