# Marketing demo library

Canonical **memory, sleep, and learning** corpus for useplethora.com screenshots and the optional marketing seed.

Source of truth: this directory (`library.json`). App first-run import still uses empty `demo/books` and `demo/apkg` unless you run the seed script with `MARKETING_SEED=1`.

| Kind | Path |
|---|---|
| Essay (HTML) | `sources/01-essay/` |
| Lecture transcript + chapters | `sources/02-lecture/` |
| Methods PDF | `generated/spaced-retrieval-methods.pdf` (built) |
| Public-domain excerpt | `sources/04-pd-excerpt/` |
| Occlusion diagram | `sources/05-occlusion/` |
| Notes, cards, graph | `sources/06-notes-cards-graph/` |

Schema: `schema/library.schema.json`. Licenses: `marketing/licenses/ATTRIBUTION.md`.

Rebuild generated binaries (PDF, EPUB, WAV):

```bash
node scripts/marketing/build-corpus.mjs
```
