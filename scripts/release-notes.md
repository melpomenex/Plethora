### Added

- **Automatic, non-optional end-to-end encryption for sync rooms** — Real-time cloud synchronization is now secure by default. Upon starting or joining a room, the app auto-provisions a secure 32-byte secret key and derives the cryptographic keys, storing them securely (e.g. in the OS keychain). The websocket provider now operates in encrypted-only mode, eliminating the unencrypted fallback path.
- **Cross-device synchronization for flashcards** — Flashcard actions (creations, edits, suspends, deletes, and Anki imports) now synchronize reliably across all devices in a room using Yjs sync and tombstone markers, ensuring consistent deck state.

### Fixed & Improved

- **Fixed deleted documents automatically reappearing** — Library document deletions now set Yjs tombstone markers, meaning deleted files and metadata entries are correctly removed across all devices and will not reappear after page refresh or software restart.
