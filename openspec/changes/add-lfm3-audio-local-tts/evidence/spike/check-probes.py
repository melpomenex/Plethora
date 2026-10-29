"""Opt-in Phase 1 fixtures; uses already built runtime and verified local weights."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
import wave

root = Path(os.environ.get('LFM3_SPIKE_ROOT', Path.home() / '.cache/plethora/lfm3-spike'))
backend = os.environ.get('LFM3_SPIKE_BACKEND', 'cpu')
assert backend in ('cpu', 'cuda'), 'Unknown probe backend'
exe = root / ('lfm3-spike-cuda' if backend == 'cuda' else 'lfm3-spike')
prefix = '' if backend == 'cpu' else 'cuda-'
base = [str(exe), str(root / 'LFM3-Audio-2B-Q4_K_M.gguf'), str(root / 'mmproj-LFM3-Audio-2B-Q8_0.gguf')]
results = []


def case(mode, expected_code, expected_message):
    output = root / (prefix + 'probe-' + mode)
    assert not list(output.glob('*.wav')), 'Use a fresh probe output directory'
    start = time.monotonic()
    with (root / (prefix + mode + '.log')).open('w') as log:
        p = subprocess.run(base + [str(output), mode], stdout=subprocess.PIPE, stderr=log,
                           text=True, timeout=65)
    assert p.returncode == expected_code, (mode, p.returncode)
    diagnostic = (root / (prefix + mode + '.log')).read_text(errors='replace')
    assert expected_message in diagnostic or expected_message in p.stdout, mode
    assert not list(output.glob('*.wav')), 'Failed probe published audio'
    results.append({'case': mode, 'exitCode': p.returncode, 'elapsedSec': time.monotonic() - start,
                    'publishedFiles': 0})


case('injection', 0, 'rejectedControlFixtures')
case('load-cancel', 130, 'model_load')
case('cap', 1, 'output_limit_without_eos')

# Trigger a real SIGTERM at a native frame barrier, rather than predicting timing.
output = root / (prefix + 'probe-frame-cancel')
assert not list(output.glob('*.wav'))
with (root / (prefix + 'frame-cancel.log')).open('w') as log:
    p = subprocess.Popen(base + [str(output), 'frame-cancel'], stdout=subprocess.PIPE,
                         stderr=log, text=True)
    watchdog = threading.Timer(65, p.kill)
    watchdog.start()
    try:
        while True:
            line = p.stdout.readline()
            assert line, 'Exited before frame barrier'
            if json.loads(line).get('barrier') == 'frame':
                break
        start = time.monotonic()
        p.terminate()
        p.communicate(timeout=1.8)
        elapsed = time.monotonic() - start
        assert p.returncode == 130 and elapsed < 2, (p.returncode, elapsed)
    finally:
        watchdog.cancel()
        if p.poll() is None:
            p.kill()
            p.wait()
assert not list(output.glob('*.wav'))
results.append({'case': 'frame-cancel', 'exitCode': p.returncode, 'cancelToReapSec': elapsed,
                'publishedFiles': 0})

# Minimal non-cooperative fixture: ignores TERM; parent must kill AND reap.
fake = 'import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print("ready",flush=True); time.sleep(60)'
p = subprocess.Popen([sys.executable, '-c', fake], stdout=subprocess.PIPE, text=True)
try:
    assert p.stdout.readline().strip() == 'ready'
    start = time.monotonic()
    p.terminate()
    try:
        p.wait(timeout=1.8)
        raise AssertionError('Non-cooperative fixture unexpectedly acknowledged TERM')
    except subprocess.TimeoutExpired:
        p.kill()
        p.wait(timeout=0.2)
    elapsed = time.monotonic() - start
    assert p.returncode == -signal.SIGKILL and elapsed < 2, (p.returncode, elapsed)
finally:
    if p.poll() is None:
        p.kill()
        p.wait()
results.append({'case': 'forced-kill-reap', 'exitCode': p.returncode, 'cancelToReapSec': elapsed})

# Existing completed outputs include a codec tail: every acoustic frame is 80 ms.
records = [json.loads(x) for x in (root / (backend + '-results.jsonl')).read_text().splitlines()]
clips = [x for x in records if 'file' in x]
assert len(clips) == 5 and sum(x.get('loaded', False) for x in records) == 1
for clip in clips:
    path = root / (prefix + 'output') / clip['file']
    with wave.open(str(path)) as wav:
        assert wav.getframerate() == 24000 and wav.getnchannels() == 1 and wav.getsampwidth() == 2
        assert wav.getnframes() == clip['samples'] == clip['frames'] * 1920
        assert path.stat().st_size == clip['bytes'] == 44 + clip['samples'] * 2
repeated_equal = (root / (prefix + 'output/female-en.wav')).read_bytes() == (root / (prefix + 'output/female-en-repeat.wav')).read_bytes()
if backend == 'cpu':
    assert repeated_equal
# CUDA bitwise equality is observed, not promised across backend implementations.
results.append({'case': 'one-load-reset-eos-tail', 'clips': 5, 'repeatedBytesEqual': repeated_equal})
(root / (prefix + 'probe-checks.json')).write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))
