# Nightly Unattended Test Suite for Mac mini

The nightly orchestrator (`scripts/ios-test/nightly.sh`) runs the complete regression, smoke, chaos, and soak test matrix unattended on the dedicated Mac mini.

---

## Running Manually

```bash
npm run test:ios:nightly
```

### Nightly Test Sequence:
1. **Preflight**: Validates host tools and active iOS simulators.
2. **Simulator Reset**: Purges old test state and erases sandbox cache.
3. **Script Unit Tests**: Executes all Node.js script unit tests.
4. **Store Hardening Tests**: Executes Vitest store state recovery tests.
5. **Rust Robustness Suite**: Executes malformed fixture import tests.
6. **Simulator Smoke Test**: Boots, verifies liveness, navigates, and tests cold relaunch.
7. **Chaos Scenarios**: Tests unexpected SIGKILL and corrupted share payloads.
8. **Seeded Monkey Soak**: Runs multi-cycle semantic random actions.
9. **Report Summary**: Generates `.test-artifacts/nightly/<date>/summary.json`.

---

## macOS `launchd` Service Setup

To schedule the nightly suite automatically at 02:00 AM every night:

Create `~/Library/LaunchAgents/com.plethora.nightly.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.plethora.nightly</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>-c</string>
        <string>cd /Volumes/external/mac-mini/Code/Plethora && npm run test:ios:nightly</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict>
        <key>Hour</key>
        <integer>2</integer>
        <key>Minute</key>
        <integer>0</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>/tmp/plethora_nightly_stdout.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/plethora_nightly_stderr.log</string>
</dict>
</plist>
```

Load the service:
```bash
launchctl load ~/Library/LaunchAgents/com.plethora.nightly.plist
```
