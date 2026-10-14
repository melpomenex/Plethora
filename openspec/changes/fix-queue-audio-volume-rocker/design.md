## Context

See `proposal.md` for the user problem and `specs/queue-audio-volume-rocker/spec.md` for the behavior contract. The queue's embedded audio document is handled by `DocumentViewer`. Its volume-rocker branch currently calls `handleVolumeRockerNavigation` without checking media playback, and that helper prevents the event's default action and stops propagation. The shared `useReaderVolumeNavigation` hook already has a media-playing guard, but its predicate is private to the hook.

## Goals / Non-Goals

**Goals:**

- Let the device handle hardware volume keys while queue audio is playing.
- Preserve page and scroll navigation from the existing setting while playback is paused.
- Use the same media-playback rule in the queue viewer and shared reader navigation.

**Non-Goals:**

- Add a player-specific volume slider or change how the operating system adjusts media volume.
- Change the `volumeRockerScroll` setting, its defaults, or behavior on unrelated queue item types.
- Add native key interception or new platform permissions.

## Decisions

### Give active media playback priority in the viewer key handler

Before `DocumentViewer` passes a `VolumeUp` or `VolumeDown` event to the page/scroll helper, it will check whether media is actively playing. If so, the handler returns without calling `preventDefault` or stopping propagation. This allows the native media-volume behavior to handle the rocker while audio plays. When audio is paused, the existing helper continues to apply the configured `page`, `scroll`, or `none` behavior.

The guard applies only to the `VolumeUp` and `VolumeDown` key names. Page-key aliases continue through their current navigation behavior, and other document shortcuts are unchanged.

### Share the active-media predicate

Move the existing playback check out of `useReaderVolumeNavigation` into a small shared utility and use it from both the hook and `DocumentViewer`. Keep the current definition based on in-page audio/video elements that are not paused or ended and have playable data, so the two paths use the same policy. This avoids a new setting and prevents future divergence between reader surfaces.

### Keep native volume control as the mobile control

Do not route hardware keys to `AudiobookViewer`'s in-app volume state. Its mobile player already treats hardware volume as the expected control; leaving the event uncanceled lets the device adjust its media stream volume.

## Risks / Trade-offs

- **Other active media in the same page also yields the rocker to the system.** This matches the existing shared reader policy, which checks all in-page audio and video elements.
- **A platform may not expose a hardware key event in a particular WebView.** The guard only preserves the native event path when one is delivered; no new Tauri or OS-level interception is introduced.

## Migration Plan

No migration is needed. Rollback consists of restoring the previous reader playback predicate and removing the queue viewer's early return.
