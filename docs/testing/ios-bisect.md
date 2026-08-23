# Automated iOS Regression Bisecting

Plethora provides an automated `git bisect` wrapper script (`scripts/ios-test/bisect-smoke.sh`) that evaluates each commit with standard POSIX exit codes:
- **`0`**: Commit passed smoke tests (GOOD).
- **`1`**: Commit crashed, deadlocked, or failed smoke test (BAD).
- **`125`**: Commit cannot be tested (e.g. intermediate syntax error or build failure, SKIP).

---

## Running an Automated Bisect

```bash
# 1. Start bisect
git bisect start

# 2. Mark current broken commit
git bisect bad HEAD

# 3. Mark last known good commit
git bisect good <commit-sha>

# 4. Run automated bisect loop
git bisect run npm run test:ios:bisect
```

`git bisect` will automatically check out commits, compile, boot the simulator, test liveness and lifecycle recovery, and pinpoint the exact offending commit without manual intervention.

---

## Restoring Working Tree

When finished, restore your worktree:
```bash
git bisect reset
```
