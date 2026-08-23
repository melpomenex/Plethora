# Native capture importer path

Native store-listing captures use the same `marketing-fixture-v2` records as the browser captures, but they must come from an installed release-candidate app on a disposable simulator/device profile. They are never CSS viewport captures.

The scene-by-scene simulator and physical-device procedure is in
`marketing/screenshots/native-capture-protocol.md`.

## Build the archive

```bash
npm run marketing:fixture
npm run marketing:fixture:tauri -- --out /tmp/plethora-marketing-fixture-v2-import.zip
```

The builder checks the current Rust collection-import command before writing. It fails if the accepted archive version, replacement transaction, or table coverage has drifted. The archive carries the fixture ID/hash and fixed logical time; files are the same hashed, licensed corpus binaries used by the browser adapter.

## Import only into a disposable profile

1. Wipe the simulator/device app container or use a dedicated disposable desktop OS profile, then install the intended RC. Do not import this replacement archive into a normal user or developer profile.
2. Launch once so the real application creates the fresh SQLite database and runs every current migration. Confirm the library is empty.
3. In **Settings → Import / Export**, select the generated ZIP and use the full collection import. The native `import_collection_archive` command writes document files through app storage and replaces documents, extracts, and learning items in one SQLite transaction.
4. Confirm exactly 5 documents, 3 extracts, and 5 learning items before applying a named scene. Record the RC build ID as `<package-version>+<short-git-sha>` and the fixture hash printed by the builder.
5. After capture, wipe the disposable app container. Never copy its SQLite file back into a regular profile.

The native command currently accepts the legacy `incrementum-collection-export` marker for full replacement archives; the builder uses that compatibility marker deliberately and checks it against the Rust source. This does not change the fixture identity or allow legacy/personal corpus content.
