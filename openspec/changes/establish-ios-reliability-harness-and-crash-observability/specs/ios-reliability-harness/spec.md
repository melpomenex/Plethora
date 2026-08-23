## ADDED Requirements

### Requirement: Deterministic iOS Simulator Smoke Testing SHALL be automated via a single command
The repository SHALL provide a command (`npm run test:ios:smoke` / `scripts/ios-test/smoke.sh`) that provisions the configured iOS simulator, builds the application for the simulator target, installs the `.app`, launches it, verifies startup readiness, navigates through primary tabs, executes a termination and cold relaunch, and exits with code 0 if and only if all phases pass without crash, hang, deadlock, or unhandled runtime error.

#### Scenario: Successful smoke run on iPhone 17 Pro Simulator
- **WHEN** `npm run test:ios:smoke` is executed on a configured Mac host
- **THEN** the target simulator boots, Plethora installs and launches, reaches `data-plethora-ready="true"` within 30 seconds, switches tabs without error, terminates cleanly, relaunches, and exits with code 0

#### Scenario: Startup deadlock or freeze fails with classified exit code
- **WHEN** the application fails to advance its liveness heartbeat or reach `data-plethora-ready` within the timeout window
- **THEN** the smoke runner terminates the hung process, captures process logs and a screenshot, emits `.test-artifacts/ios/<run-id>/`, classifies the failure as `startup_timeout` or `ui_hang`, and exits with a non-zero code

### Requirement: A Multi-Signal Liveness Oracle SHALL determine application health
Application health SHALL NOT be determined solely by process existence. The harness SHALL verify DOM readiness markers (`data-plethora-ready="true"`), active rendering heartbeat updates (`data-plethora-heartbeat`), and native IPC responsiveness via a dedicated health check command (`ping_health`).

#### Scenario: Zombie or deadlocked WebKit process detected
- **WHEN** the native iOS process remains alive in the simulator process table but the WKWebView JavaScript event loop stops advancing its heartbeat counter for 5 consecutive seconds
- **THEN** the liveness oracle flags a `ui_hang` failure condition and initiates diagnostic capture

### Requirement: Structured Crash Artifacts SHALL be harvested for every run
Every automated iOS test execution SHALL write a structured artifact bundle into `.test-artifacts/ios/<timestamp>-<run-id>/` containing `metadata.json`, `stdout.log`, `stderr.log`, `unified.log`, `javascript-errors.log`, `rust.log`, `screenshot.png`, `crash.ips` (if a native crash occurred), and `test-result.json`.

#### Scenario: Native crash produces complete diagnostic bundle
- **WHEN** the application crashes due to a native signal (e.g., SIGABRT, SIGSEGV) or uncaught exception
- **THEN** the harness extracts the corresponding `.ips` crash report from `~/Library/Logs/DiagnosticReports/`, records the last executed test action, saves a final screenshot, classifies the error as `native_crash`, and persists the bundle for triage

### Requirement: Smoke test SHALL support automated regression bisecting
The repository SHALL provide a bisect wrapper (`scripts/ios-test/bisect-smoke.sh`) compatible with `git bisect run` that returns exit code 0 for good commits, exit code 1 for failing/crashing commits, and exit code 125 to skip commits that cannot be tested due to build failures or missing historical dependencies.

#### Scenario: Git bisect automatically isolates a regression
- **WHEN** `git bisect run ./scripts/ios-test/bisect-smoke.sh` is executed across a commit range
- **THEN** unbuildable commits return exit 125, the crashing commit returns exit 1, and git bisect terminates at the exact introducing commit
