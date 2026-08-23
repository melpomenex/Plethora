# Demo Content

This directory contains sample content that is automatically imported when a new user launches the application with an empty database.

## Directory Structure

```
demo/
├── apkg/           # Sample Anki deck files (.apkg)
└── books/          # Sample ebook files (.epub, .pdf)
```

Git does **not** ship books or decks. First-run import is a no-op until you add files.

## Marketing seed (opt-in)

The useplethora.com library lives in `marketing/demo-library/`. Copy it into this folder only when capturing screenshots:

```bash
MARKETING_SEED=1 node scripts/marketing/seed-demo-library.mjs
MARKETING_SEED=1 node scripts/marketing/seed-demo-library.mjs --reset --reset-only
```

Without `MARKETING_SEED=1` the seed script refuses to write. Production users are unchanged.

See `scripts/marketing/README.md`.

## Adding Demo Content

1. **Anki Decks (.apkg)**: Place .apkg files in the `apkg/` subdirectory.
2. **Ebooks (.epub, .pdf)**: Place ebook files in the `books/` subdirectory.

## Environment Variables

- `DEMO_CONTENT_DIR`: Override the default demo content directory path
- `SKIP_DEMO_IMPORT`: Set to `1` to disable demo content auto-import
- `MARKETING_SEED`: Set to `1` to allow the marketing seed script to write here
