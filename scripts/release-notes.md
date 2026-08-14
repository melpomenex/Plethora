### Added

- **Edit cards during review** — Press Cmd/Ctrl+E or the pencil button on a review card to open the inline editor right over the session, Anki "edit during review" style. Basic and Q&A cards edit question, answer, and tags; cloze cards edit the raw cloze markup with a live preview (saves without a cloze marker go through with a warning, mirroring Anki). Complex cards such as image occlusion hand off to the Studio composer. Edits are versioned, persist immediately, and never touch scheduling state, so due dates and review history are safe while you fix a typo mid-session.

### Fixed & Improved

- **Occlusion images fully visible before the reveal** — A tall source image used to overflow the review card and clip occlusion regions out of view until you answered. The image is now aspect-preserved inside a height-capped frame, so every region is on screen while the answer is hidden, and the answer-hidden card area scrolls on desktop exactly like the answer-shown one.
- **Occlusion masks are now opaque** — The boxes used to render at 85-88% transparency, letting the answer show through. They now render fully opaque by default (an explicit color chosen in the composer is still honored), consistently across review, the composer's card preview, and the lightbox.
- **Card edits persist directly** — Content edits now write question/answer/cloze text straight to the database instead of relying on the sync subsystem's upsert, and tag edits from the inline editor go through the real tag-update path instead of a no-op call. The browser (PWA) backend gained the same content and tag semantics, and image assets resolve identically under either backend.
