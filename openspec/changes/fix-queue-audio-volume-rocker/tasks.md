## 1. Share media playback detection

- [x] 1.1 Extract the existing active-media predicate into a shared utility and update `useReaderVolumeNavigation` to use it; verify the hook retains its current playback pass-through behavior.
- [x] 1.2 Add focused coverage for active versus paused/ended media detection; verify the predicate only reports active playback for non-paused, non-ended media with playable data.

## 2. Preserve device volume control during queue audio

- [x] 2.1 Update the `DocumentViewer` rocker handler to let `VolumeUp` and `VolumeDown` pass through while media is playing; verify the events are not canceled and do not invoke page or scroll callbacks.
- [x] 2.2 Add regression coverage for queue audio with `page`, `scroll`, and `none` modes; verify active playback passes the rocker through, paused playback uses the configured navigation mode, and disabled mode remains unhandled.
- [ ] 2.3 Verify on an Android phone that the rocker changes device media volume during podcast and audiobook playback in the Queue, and that paused playback still follows the selected page or scroll mode. The APK built successfully, but Android rejected the update because its signing certificate differs from the installed `com.plethora.app`; installing it would require uninstalling the existing app and erasing its local data.
