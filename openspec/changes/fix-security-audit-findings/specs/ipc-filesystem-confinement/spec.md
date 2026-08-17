## ADDED Requirements

### Requirement: IPC file writes are confined to granted roots
Every Tauri command that writes, appends to, or creates files at a frontend-supplied location SHALL resolve the target through the backend grant registry: canonicalize the path and require containment under an app data root or a directory/file the backend recorded from a native save/open dialog in this session. Unconfined paths SHALL fail with a typed error.

#### Scenario: Staged-import append cannot target arbitrary files
- **WHEN** a webview invokes the staged-import chunk-append command with `stagedPath` pointing outside the import staging directory (e.g. `~/.zshrc`)
- **THEN** the command rejects the path without writing and returns a typed confinement error

#### Scenario: Legitimate export to a user-chosen location still works
- **WHEN** the user picks a destination in the native save dialog and the export command writes there (mnemosyne, APKG/CSV, PDF-as-HTML, book download, YouTube download)
- **THEN** the write succeeds exactly as before the change (e2e smoke)

### Requirement: IPC file reads are confined to granted roots
Commands that return file contents or hashes over IPC SHALL apply the same confinement as writes (app data roots, media-server grants, dialog-recorded picks).

#### Scenario: Arbitrary path read is rejected
- **WHEN** a webview invokes a file-read command with `filePath` set to `~/.ssh/id_ed25519`
- **THEN** the command returns a confinement error and no file contents cross IPC

### Requirement: Path-joined ids are opaque tokens
Ids that feed filesystem path construction (transcription model ids, backup ids, podcast episode filenames) SHALL be validated as opaque tokens (strict charset or membership in a server-side allowlist) before any join, and generated filenames SHALL use server-generated ids with a fixed extension allowlist.

#### Scenario: Traversal in a model id fails closed
- **WHEN** `delete_transcription_model` is called with an id containing `/`, `..`, or path separators
- **THEN** the command rejects the id before any `remove_dir_all`

#### Scenario: Podcast download writes only into the audio directory
- **WHEN** a podcast episode is downloaded with an attacker-influenced episode id or media type
- **THEN** the destination filename is server-generated with an allowlisted audio extension and remains inside the podcast audio directory

### Requirement: Registered document paths grant only their own file
Registering a document with a `file_path` SHALL grant loopback streaming for that exact canonical file only, never a directory or prefix.

#### Scenario: Registered path cannot widen streaming access
- **WHEN** a document is registered with a path and the media server later authorizes stream requests
- **THEN** only requests resolving to that exact canonical file are served; sibling or parent paths are refused
