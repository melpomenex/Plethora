### Added

- **Adjust a document's queue priority directly from the scroll overlay** — A new priority control in the scroll/queue overlay (desktop top bar, thumb-reachable on mobile) lets you bump the current item's scheduling weight without leaving the reading flow. Five presets (Lowest → Highest) map onto the queue's priority slider and save inline with failure feedback, replacing the round-trip through deck/settings to reprioritize.

### Fixed & Improved

- **Fixed a memory leak / unbounded memory spikes during background file sync** — Every imported or re-registered file was kicking off a fire-and-forget upload (`void (async () => { ... })()` per file), each holding a full base64 copy of the file plus its `Blob`/`File` instance in memory at once. On large libraries (hundreds of files syncing at startup or after a bulk import) these ran with no concurrency limit and no dedupe, so memory climbed steadily and could OOM-kill the WebView. Uploads are now funneled through a sequential `enqueueBackgroundUpload` queue that processes one task at a time and skips duplicates by `fileId`, flattening the memory high-water mark. The Rust queue builder was also factored into a shared `get_due_queue_items_from_repo` helper used by both the HTTP and internal call sites.
