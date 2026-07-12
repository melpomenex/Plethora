### Added

- **Document-native Vim reading for EPUB and PDF** — Vim mode now tracks the caret against stable EPUB CFI and PDF page/text positions instead of on-screen DOM, so motions and selections survive reflow, zoom, pagination, virtualization, and chapter/page transitions. Navigate continuously across sections and pages (`h/j/k/l`, `w/b/e`, `{`/`}`, `gg`/`G`, counts), make cross-boundary visual selections (`v`/`V`), and act on them with a single key — extract (`Enter`), edit (`E`), copy (`y`), highlight by color (`H`), or create a card (`F`). A compact Reading Rail shows mode, location, pending commands, selection actions, color preview, feedback, and contextual help (`?`).
- **Flashcard Studio reachable above the mobile bottom nav** — The AI Flashcard Studio modal now layers above the mobile bottom navigation, and its footer accounts for the nav height, so the Send / Save Selected button is fully visible and tappable on phone and tablet. Desktop layout is unchanged.
- **Volume-rocker scrolling in review sessions** — Hardware volume buttons now navigate or scroll review content per the existing "Volume Rocker Scroll" setting: `page` moves between cards, `scroll` smoothly scrolls the current card or Extract, and `none` leaves system volume behavior intact.
- **Editable numeric settings inputs** — Numeric settings fields now support clearing and deleting digits with validation applied on blur, instead of clamping on every keystroke.

### Fixed & Improved

- **Image saving with local assets** — Added local-asset protocol fallbacks so saving images that reference local file assets no longer silently fails in the Image Registry.
- **Linux window state** — Restored window title, size, and settings persistence in `tauri.linux.conf.json`.
- **RSS scroll mode navigation and layout** — Improved navigation and layout in RSS scroll mode.
- **Consistent algorithm labels** — Standardized SuperMemo algorithm labels to the compact "SM-N" shorthand across settings, deck stats, and all six locales to match the existing FSRS label style.
