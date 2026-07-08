---
name: cut-release
description: Cut a new Incrementum release. Use whenever the user wants to ship a new version, cut a release, publish a release, bump the version, tag a release, or says things like "release v1.x", "ship it", "publish the new version", or "make a new release". Covers staging cleanly, writing release notes, running scripts/release.cjs, and verifying the result.
---

# Cut an Incrementum release

End-to-end release workflow for this Tauri app. The mechanics are handled by
`scripts/release.cjs` (bumps every manifest, prepends the CHANGELOG entry,
commits, tags, pushes, and creates the GitHub release). Your job is to prepare
a clean release so that script does the right thing — the three common ways it
goes wrong are (a) a dirty working tree getting swept into the release commit
via the script's `git add -A`, (b) a broken `gh` token failing the push, and
(c) **`pnpm-lock.yaml` drifting out of sync with `package.json`** (npm CI
passes but the Vercel deploy fails with `ERR_PNPM_OUTDATED_LOCKFILE` — see
prerequisite 5).

## Prerequisites — check these BEFORE doing anything

1. **GitHub auth must be valid.** Run `gh auth status`. If it reports an
   invalid/expired token, STOP and tell the user to run
   `gh auth login -h github.com` — the version bump + local commit + tag will
   succeed but `git push` and `gh release create` will fail. Surface this
   up front rather than after the bump.

2. **Decide the version bump.** Read `package.json` for the current version,
   then ask the user (if not already specified) whether it's a patch or minor:
   - **Patch** (e.g. `1.57.2` → `1.57.3`) for fix-only releases. This is the
     established pattern — `1.57.1` and `1.57.2` were both fix-only.
   - **Minor** (e.g. `1.57.2` → `1.58.0`) when new user-facing features ship.
   The script auto-increments the patch if you pass no version, but prefer
   stating the target explicitly so the user signs off.

3. **The working tree must not contain unrelated untracked files** that the
   script's `git add -A` would sweep into the release commit. Run
   `git status -s --untracked-files=all` and inspect. Common offenders in this
   repo: compiled browser extension artifacts (`*.xpi`, `browser_extension/`),
   orphan WIP source that doesn't compile, and untracked `openspec/changes/*`
   proposal docs. See "Clean the tree" below.

4. **`tsc` should be clean** (or only have pre-existing known errors). Run
   `npx tsc --noEmit` and read the output. A non-compiling file shipped in a
   release is a defect.

5. **Both JS lockfiles must agree with `package.json`.** This repo carries
   **two** lockfiles and they are consumed by *different* CI systems:
   - `package-lock.json` → used by the GitHub Actions release workflow (`npm ci`)
   - `pnpm-lock.yaml` → used by **Vercel** (which auto-detects it and runs
     `pnpm install --frozen-lockfile`)

   Vercel's `--frozen-lockfile` will **hard-fail the deploy** if
   `pnpm-lock.yaml` is even one dependency out of sync with `package.json`
   (error: `ERR_PNPM_OUTDATED_LOCKFILE`). This bit v1.67.1: a dep was added
   via `npm install`, which updated only `package-lock.json`, leaving
   `pnpm-lock.yaml` stale — npm CI passed but the Vercel deploy failed.

   **Always check both lockfiles before cutting a release.** Run:
   ```bash
   # If you added/changed a JS dependency since the last release:
   pnpm install --no-frozen-lockfile --lockfile-only   # regenerate pnpm-lock.yaml
   # Then verify BOTH install cleanly from the lockfile (as CI does):
   pnpm install --frozen-lockfile --lockfile-only && echo "pnpm OK"
   npm ci --offline >/dev/null 2>&1 && echo "npm OK"   # or drop --offline if no cache
   ```
   If either reports a mismatch or an outdated lockfile, regenerate it before
   proceeding. Commit the regenerated lockfile as part of the release prep
   (separate from the `chore: release` commit) — never let the release
   script's `git add -A` be the thing that sweeps it in.

   Rust's `Cargo.lock` is single and has no analog of this problem.

## Clean the tree before staging

This is the step the release script can't do for you. The script's final
`git add -A` is the right call *only* when the tree is clean. Concretely:

- **Gitignore build artifacts that must never ship.** Anything machine-
  generated that isn't source belongs in `.gitignore`, e.g.:
  ```
  *.xpi
  browser_extension/
  ```
- **Remove orphan WIP source that doesn't compile and isn't imported
  anywhere.** Confirm first (grep the codebase for imports; check `tsc`) —
  then delete it rather than letting it ride along in the release. A broken
  untracked file is tech debt you don't want to immortalize in a tag.
- **Leave documentation-only untracked files** (e.g. `openspec/changes/*`
  proposals) untracked — they're not build junk, but they also shouldn't be
  swept into a `chore: release` commit unless they're part of the release.
  The clean-staging step below handles this by staging only release content.

## Stage cleanly (never trust a blind `git add -A`)

Stage release content by **explicit path**, not `-A`:

```bash
# The actual code changes for this release
git add src/                        # the fix/feature work
git add .gitignore                  # if you updated ignore rules
# The release-prep artifacts
git add scripts/release-notes.md    # the notes you just wrote
git add .agents/skills/             # if you updated this skill
```

Then commit the real work with a meaningful message *separate* from the
release commit, so the changes are attributed and not buried under
`chore: release`:

```bash
git commit -m "fix(i18n): <what actually changed>"
```

The release script creates its own `chore: release vN` commit on top, so the
history reads: feature/fix commit → release commit → tag.

## Author the release notes

The script reads `scripts/release-notes.md` verbatim and uses it for **both**
the CHANGELOG entry and the GitHub release body — so **overwrite** the file
with this release's content, do not append (leftover notes from the previous
release will leak into the new one).

Format (match the recent CHANGELOG style — see `CHANGELOG.md`):

```markdown
### Added
- **Feature name** — one-line summary, optional detail.

### Fixed & Improved
- **Bug summary** — what was broken and what now happens.
```

Keep bullets concise but informative. Lead each bullet with a bold lead-in.
Recent entries in this repo write a single bold sentence then a dash with the
mechanism/impact. For fix-only releases a single `### Fixed & Improved`
section is enough.

If the user wants minimal notes, a single section with one bullet per change
is fine. The script falls back to a generic placeholder if the file is empty,
so always write real notes.

## Run the release

Once prerequisites pass, the tree is clean, and notes are written:

```bash
node scripts/release.cjs <version>
# e.g. node scripts/release.cjs 1.57.3
```

Optional `--notes <path>` overrides the notes file location. The script:

1. Bumps the version in **all five** manifests: `package.json`,
   `package-lock.json` (both root and `packages[""]`), `src-tauri/tauri.conf.json`,
   `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` (the package block).
2. Prepends `## [<version>] - <today>` + the notes to `CHANGELOG.md` (skips if
   that version header already exists).
3. `git add -A` → commits `chore: release v<version>` → tags `v<version>` →
   `git push origin main && git push origin v<version>` → `gh release create`.

If it fails at the push/release step (auth, network, or permissions), the
local commit and tag are already created. **Do not retry blindly** — report
exactly how far it got. The user can fix auth/networking and finish with:
```bash
git push origin main && git push origin v<version>
gh release create v<version> -t "v<version>" -F scripts/release-notes.md
```

## Verify

After the script reports success:

- `git tag --sort=-v:refname | head -3` — the new tag is present.
- `gh release view v<version>` — the GitHub release exists with the notes body.
- Confirm `package.json` / `Cargo.toml` / `tauri.conf.json` all show the new
  version and were committed + pushed.

Report the release URL to the user.
