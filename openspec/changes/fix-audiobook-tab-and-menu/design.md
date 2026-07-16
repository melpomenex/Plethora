## Context

`AudiobooksTab` (`src/components/tabs/AudiobooksTab.tsx`) decides shelf membership with:

```ts
const isAudio = doc.fileType === "audio";
const hasAudioTag = doc.tags?.some(
  (t) => t.toLowerCase() === "audiobook" || t.toLowerCase() === "audio"
);
return isAudio || hasAudioTag;
```

Podcast episodes imported as local audio files are created with `fileType: "audio"` and `tags: ["podcast", "audio"]`, both in the browser backend (`src/lib/browser-backend.ts`'s `import_podcast_audio_file`) and the desktop backend (`src-tauri/src/commands/audiobook.rs:315`). Because both branches of the `isAudio || hasAudioTag` check independently match a podcast document (`fileType === "audio"` is true, and the `"audio"` tag is present), every locally-transcribed podcast episode shows up in the Audiobooks Shelf.

Separately, `MobileNavigation` (`src/components/mobile/MobileNavigation.tsx`) defines `allNavItems`, the list backing the mobile "More" overflow sheet reachable from the bottom toolbar. It includes `rss`, `newsletter`, `analytics`, and `podcast`, but no `audiobook` entry, so the Audiobooks Shelf (already reachable from the desktop `Toolbar.tsx` button list) has no mobile entry point.

## Goals / Non-Goals

**Goals:**
- Audiobooks Shelf shows only genuine audiobooks, not podcast episodes, regardless of which backend (browser or Tauri/desktop) created the document.
- Mobile "More" menu gains an "Audiobooks" entry that opens the same `AudiobooksTab` used elsewhere, consistent with how `podcast` is wired into `allNavItems`.

**Non-Goals:**
- Changing the tags/fileType written at import time (`["podcast", "audio"]` stays as-is) — this is a classification fix, not a data migration.
- Introducing a dedicated `documentType`/`audiobook` fileType distinct from `"audio"`.
- Changing the desktop `Toolbar.tsx` button list, which already has a group-2 "audiobook" button.

## Decisions

- **Classify by exclusion, not by requiring an `"audiobook"` tag.** A document counts as an audiobook when (`fileType === "audio"` or has an explicit `"audiobook"` tag) AND it does not have a `"podcast"` tag. This preserves existing audiobooks that only ever had `fileType: "audio"` with no tags, while excluding anything explicitly tagged as a podcast. Alternative considered: require the `"audiobook"` tag explicitly and drop the `fileType === "audio"` fallback — rejected because existing audiobook documents may not carry that tag and this would silently empty the shelf for them.
- **Fix only in `AudiobooksTab`'s membership filter**, not in the backends. Alternative considered: stop tagging podcast documents with `"audio"` at import time — rejected as riskier (touches two backends, may affect podcast playback/transcription code that keys off the `"audio"` tag) for a problem that's really about how the shelf *reads* tags, not how they're written.
- **Mirror the existing `podcast` entry shape in `allNavItems`** for the new `audiobook` entry (same `NavItem` interface, `AudiobooksTab` as `tabContent`, `Headphones` icon consistent with `Toolbar.tsx`'s existing audiobook button) rather than inventing a new menu structure.

## Risks / Trade-offs

- [A document tagged both `"audiobook"` and `"podcast"` would now be excluded from the shelf] → Acceptable: no current import path produces this combination; podcast-tagged documents are conceptually episodes, not audiobooks.
- [Duplicate classification logic could drift if other views independently derive "is audiobook"] → Mitigation: proposal calls for auditing other call sites during implementation; if found, apply the same exclusion inline rather than introducing a shared helper unless three or more call sites need it.
