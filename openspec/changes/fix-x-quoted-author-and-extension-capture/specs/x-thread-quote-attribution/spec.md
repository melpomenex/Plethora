## ADDED Requirements

### Requirement: Quoted-post author fallback from status-link handles
The X thread pipeline SHALL preserve the author handle embedded in each quoted-post status link (`x.com|twitter.com/<user>/status/<id>`) found in ThreadReaderApp post HTML, and SHALL use it as the quoted post's author whenever the fetched quote payload does not yield a parseable author (the "Unknown" fallback).

#### Scenario: Quote payload has an unparseable author
- **WHEN** a quoted post is resolved (embedded in the post payload or fetched via its ref id) and the payload's user shape cannot be parsed
- **AND** the quoting post's HTML carried a handle for that status link
- **THEN** the quoted post's author screen_name SHALL be the URL-derived handle
- **AND** the quoted post's permalink SHALL be rebuilt from that handle and the quote id

#### Scenario: Quote payload has a real author
- **WHEN** a quoted post payload yields a parseable author
- **THEN** the payload author SHALL be used unchanged (name, handle, avatar, verified)
- **AND** the URL-derived handle SHALL NOT override it

#### Scenario: No handle available
- **WHEN** a quoted post resolves with an unparseable author and no URL-derived handle exists for its id
- **THEN** the stored author SHALL remain the Unknown fallback
- **AND** the viewer SHALL display a neutral "Quoted post" header instead of `Unknown (@unknown)`

### Requirement: Backward-compatible persistence of quote handles
The persisted thread `structuredContent` SHALL keep `ref_ids` unchanged and carry URL-derived quote handles in a separate optional field, such that threads persisted before this change parse and display without modification.

#### Scenario: Legacy thread restored
- **WHEN** a thread persisted before this change is loaded (no quote-handle field present)
- **THEN** the thread SHALL parse, restore `metadata.xThread`, and render identically to before
- **AND** quote resolution for such threads SHALL behave exactly as before this change

### Requirement: Thread posts and authors keep existing Unknown guards
The guards introduced by the prior never-@Unknown change SHALL be preserved: a post's TRA/URL-derived author and the thread author MUST NOT be replaced by the Unknown fallback during enrichment, and quoted-post resolution SHALL NOT weaken those guards.

#### Scenario: Restricted quoting post
- **WHEN** enrichment of a post fails to parse its payload author but the post has a TRA-derived author
- **THEN** the TRA-derived author SHALL be retained
- **AND** the quoted post, if any, SHALL still resolve with the URL-derived handle fallback when applicable
