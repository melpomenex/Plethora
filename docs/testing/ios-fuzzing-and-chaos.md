# iOS Reliability Fuzzing and UI Monkey / Chaos Testing

## 1. State-Aware Seeded UI Monkey Tester

The semantic UI monkey tester drives the compiled app on the iOS simulator using structured high-level user actions rather than random coordinate tapping.

### Running a Monkey Test:
```bash
# Run 300 steps with a random seed
npm run test:ios:monkey -- --steps 300

# Run a specific seed deterministically
npm run test:ios:monkey -- --seed 8417294 --steps 500
```

### Reproducing Failures:
When a monkey test fails at step `N`, it writes the exact action history to `.test-artifacts/ios/<run-id>/monkey_actions.json` and outputs the command to reproduce:
```bash
npm run test:ios:monkey -- --seed <seed> --steps <N>
```

---

## 2. Long-Running Soak Testing

To detect subtle memory leaks and multi-cycle state drift:
```bash
# Run 5 cycles of 100 monkey steps each
npm run test:ios:soak -- 5 100
```

---

## 3. Deadlock & Hang Sampling

If the harness watchdog detects that the process is alive but UI heartbeats have stopped advancing for > 5 seconds, it executes `sample` and `lldb` backtraces before terminating the app.

Output files in `.test-artifacts/ios/<run-id>/`:
- `hang_sample.txt`: macOS kernel call stack sample.
- `lldb_threads.txt`: Detailed thread backtraces showing exact lock contentions or thread stalls.
