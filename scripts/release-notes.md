### Added

- **RSS Reading Lists — scroll your feeds by group** — Open Scroll Mode scoped to a single folder or category with one tap on its section divider, build an ad-hoc mix of feeds with the new sidebar Select mode and scroll that selection immediately, or save any folder, category, or selection as a named **Reading List** (e.g. "Morning Coffee") to relaunch later. Saved lists persist across restart and reinstall via a new backend table, surface in a dedicated sidebar panel with per-list unread counts, and launch into either Scroll Mode or the combined article list. The active scope shows as a badge in the Scroll Mode header so you always know which feeds you're reading.
- **Discover Sites: bulk subscribe & subscribe-to-all** — Tick any number of recommended feeds and subscribe (or dismiss) them all from a floating bulk-actions bar, or subscribe to every available feed in a category with one click.
- **Undo any training action** — Every thumbs-up/down (quick-train in Scroll Mode, the context menu, or the site-by-site walkthrough) now shows a toast with an **Undo** button so you can instantly reverse a mis-tap.

### Fixed & Improved

- **Scroll Mode header no longer clips off-screen on mobile** — The top control bar in Scroll Mode was pushing the right-side action buttons (Info, Open original) past the right edge of the phone screen, stopping at the favorite star. The bar is now responsive: tighter gaps/padding on mobile, with the keyboard-only jump-to-index and mark-all-read controls hidden on phone widths (they return on desktop). All five action buttons are now visible, ending with Open original.
- **Discover Sites redesign** — New Grid / Compact List layout toggle, a "Hide Subscribed" filter to focus on what's new, and tighter category badges and readiness indicators that give you more room to browse.
- **Consistent training feedback everywhere** — Every "Train Intelligence" action now gives the same multi-layer confirmation — distinct like/dislike sound, haptic vibration on supported devices, a button pulse, and a toast — instead of some entry points silently firing. Manage Training also gets a friendly empty state, save confirmation toasts, and animated group expand/collapse.
- **Semantic Graph removed from the RSS sidebar** — The always-visible "Semantic Graph Analysis" card ate ~110px of vertical space every time you opened the RSS tab. It's gone from the sidebar; the full-screen graph is still one tap away via the RSS options menu and dashboard tile.
- **Manage Training "Save" button reads "Save"** instead of the raw "FloppyDisk" icon label.
- **Review rating interval previews visible again on phones** — The "next review in Xd" hint on rating buttons was hidden on mobile and now shows.
- **Full translation coverage** for all new and previously-hardcoded strings across English, Spanish, German, French, Japanese, and Chinese.
