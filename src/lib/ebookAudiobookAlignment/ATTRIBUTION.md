# Attribution

Portions of the error-tolerant alignment logic in this module are adapted from
the Storyteller project:

- **Project:** Storyteller (https://gitlab.com/storyteller-platform/storyteller)
- **Package:** `@storyteller-platform/align`
- **License:** MIT
- **Copyright:** Shane Friedman and contributors

Adapted files (conceptually ported, not copied verbatim):

- `libraries/align/src/errorAlign/editDistance.ts` — error-align distance matrix
- `libraries/align/src/errorAlign/errorAlign.ts` — word-level alignment pass
- `libraries/align/src/align/interpolateSentenceRanges.ts` — gap interpolation strategy

**Not used:** `@storyteller-platform/ghost-story` (GPL-3.0) or any transcription,
VAD, CTC, or native beam-search bindings. Plethora uses its own STT infrastructure.

Algorithmic concepts from Storyteller's chapter boundary search (`align/search.ts`)
informed `alignBook.ts` chapter matching.
