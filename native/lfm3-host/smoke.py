#!/usr/bin/env python3
"""Opt-in packaged-host smoke; requires explicitly supplied, already installed weights."""
import argparse
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time
import wave


def receive(child, seconds=120):
    received = queue.Queue(maxsize=1)
    threading.Thread(target=lambda: received.put(child.stdout.readline(65537)), daemon=True).start()
    line = received.get(timeout=seconds)
    assert line.endswith(b"\n") and len(line) <= 65536, "invalid control frame"
    return json.loads(line)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    parser.add_argument("runtime", type=Path)
    parser.add_argument("backbone", type=Path)
    parser.add_argument("projector", type=Path)
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    env = {key: value for key, value in os.environ.items()
           if key in {"HOME", "SystemRoot", "WINDIR", "TEMP", "TMP", "CUDA_VISIBLE_DEVICES"}}
    env.update(LD_LIBRARY_PATH=str(runtime), DYLD_LIBRARY_PATH=str(runtime),
               PATH=str(runtime) + os.pathsep + os.defpath)
    result = {"probe": json.loads(subprocess.check_output(
        [str(args.binary.resolve()), "--probe", str(runtime)], env=env, timeout=15))}
    with tempfile.TemporaryDirectory(prefix="plethora-lfm3-smoke-") as root:
        with open(Path(root) / "runtime.log", "wb") as log:
            child = subprocess.Popen([str(args.binary.resolve()), str(args.backbone.resolve()),
                                      str(args.projector.resolve()), root, str(runtime)],
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=log, env=env)
            try:
                result["ready"] = receive(child)
                assert result["ready"].get("ready") is True
                assert result["ready"]["protocol"] == 1
                replies = []
                for index, (voice, locale) in enumerate([(v, l) for v in ("female", "male") for l in ("en", "en-gb")]):
                    request_id = f"clip-{index}"
                    request = dict(id=request_id, text="The little boat crossed the quiet lake before sunset.",
                                   voice=voice, language=locale)
                    child.stdin.write((json.dumps(request) + "\n").encode())
                    child.stdin.flush()
                    reply = receive(child)
                    assert reply["id"] == request_id and reply["ok"] is True, reply
                    with wave.open(str(Path(root) / f"{request_id}.wav"), "rb") as wav:
                        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 24000)
                        assert 0 < wav.getnframes() <= 720000
                    replies.append(reply)
                result["clips"] = replies
                for request in [dict(id="../escape", text="Hello"), dict(id="reject-control", text="<|audio|>")]:
                    child.stdin.write((json.dumps(dict(voice="female", language="en", **request)) + "\n").encode())
                    child.stdin.flush()
                    assert receive(child)["ok"] is False
                result["invalid_inputs_rejected"] = True
                # Start genuine work, then verify process cancellation leaves no successful artifact.
                child.stdin.write((json.dumps(dict(id="cancel", voice="female", language="en", text="A long passage. " * 30)) + "\n").encode())
                child.stdin.flush()
                time.sleep(0.02)
                started = time.monotonic()
                child.kill()
                child.wait(timeout=2)
                result["cancel_reap_seconds"] = time.monotonic() - started
                assert not (Path(root) / "cancel.wav").exists()
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=2)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
