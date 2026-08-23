#!/usr/bin/env python3
"""Drive the connected Plethora Android app and capture key views."""
from __future__ import annotations

import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

SERIAL = sys.argv[1] if len(sys.argv) > 1 else "47241FDAS006KM"
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else "/Volumes/external/mac-mini/Code/Plethora/marketing/screenshots/source")
ADB = ["adb", "-s", SERIAL]


def run(args: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(ADB + args, check=True, **kwargs)


def dump() -> ET.Element:
    run(["shell", "uiautomator", "dump", "/sdcard/ui.xml"], capture_output=True)
    data = subprocess.check_output(ADB + ["exec-out", "cat", "/sdcard/ui.xml"])
    return ET.fromstring(data)


def nodes(root: ET.Element) -> list[ET.Element]:
    return list(root.iter("node"))


def bounds(node: ET.Element) -> tuple[int, int, int, int] | None:
    raw = node.attrib.get("bounds") or ""
    nums = []
    cur = ""
    for ch in raw:
        if ch.isdigit():
            cur += ch
        elif cur:
            nums.append(int(cur))
            cur = ""
    if cur:
        nums.append(int(cur))
    if len(nums) != 4:
        return None
    l, t, r, b = nums
    if r <= l or b <= t:
        return None
    return l, t, r, b


def center(node: ET.Element) -> tuple[int, int] | None:
    b = bounds(node)
    if not b:
        return None
    l, t, r, bb = b
    return (l + r) // 2, (t + bb) // 2


def find(root: ET.Element, *, text: str | None = None, desc: str | None = None, contains: str | None = None):
    for n in nodes(root):
        t = n.attrib.get("text") or ""
        d = n.attrib.get("content-desc") or ""
        if text is not None and t == text:
            return n
        if desc is not None and d == desc:
            return n
        if contains and contains in t:
            return n
    return None


def tap_node(node: ET.Element) -> bool:
    c = center(node)
    if not c:
        return False
    run(["shell", "input", "tap", str(c[0]), str(c[1])])
    return True


def tap_text(root: ET.Element, text: str) -> bool:
    n = find(root, text=text) or find(root, contains=text)
    return bool(n and tap_node(n))


def tap_desc(root: ET.Element, desc: str) -> bool:
    n = find(root, desc=desc)
    return bool(n and tap_node(n))


def screencap(name: str) -> Path:
    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / name
    png = subprocess.check_output(ADB + ["exec-out", "screencap", "-p"])
    dest.write_bytes(png)
    print(f"wrote {dest} ({len(png)} bytes)")
    return dest


def wake_and_launch() -> None:
    run(["shell", "input", "keyevent", "KEYCODE_WAKEUP"], capture_output=True)
    run(["shell", "am", "start", "-n", "com.plethora.app/.MainActivity"], capture_output=True)
    time.sleep(3)


def main() -> None:
    wake_and_launch()
    time.sleep(2)
    ui = dump()
    # Leave Documents. Clear audio-only filter if present.
    audio = find(ui, text="Audio")
    if audio:
        tap_node(audio)
        time.sleep(1.2)
        ui = dump()
    all_docs = find(ui, contains="All documents")
    if all_docs:
        tap_node(all_docs)
        time.sleep(1.5)
    screencap("library_android_pixel-9-pro-xl_light_2.7.0-device.png")

    ui = dump()
    open_read = find(ui, contains="Open / Read") or find(ui, contains="Open")
    if open_read:
        tap_node(open_read)
        time.sleep(4)
        screencap("reader_android_pixel-9-pro-xl_light_2.7.0-device.png")
        run(["shell", "input", "keyevent", "KEYCODE_BACK"], capture_output=True)
        time.sleep(1.5)

    ui = dump()
    tap_desc(ui, "Queue")
    time.sleep(2)
    screencap("queue_android_pixel-9-pro-xl_light_2.7.0-device.png")

    ui = dump()
    tap_desc(ui, "Review")
    time.sleep(2.5)
    screencap("review_android_pixel-9-pro-xl_light_2.7.0-device.png")

    ui = dump()
    # Try to start a review / open a card if a start control exists.
    for label in ("Start Review", "Review due", "Study", "Show answer", "Reveal"):
        n = find(ui, contains=label)
        if n:
            tap_node(n)
            time.sleep(2)
            screencap("card_android_pixel-9-pro-xl_light_2.7.0-device.png")
            break
    else:
        # Tap first clickable card-like row below the header.
        for n in nodes(ui):
            t = n.attrib.get("text") or ""
            if n.attrib.get("clickable") == "true" and t and "Review" not in t and len(t) > 12:
                b = bounds(n)
                if b and b[1] > 400:
                    tap_node(n)
                    time.sleep(2)
                    screencap("card_android_pixel-9-pro-xl_light_2.7.0-device.png")
                    break

    ui = dump()
    tap_desc(ui, "Dashboard")
    time.sleep(2)
    screencap("dashboard_android_pixel-9-pro-xl_light_2.7.0-device.png")

    ui = dump()
    tap_desc(ui, "Documents")
    time.sleep(1.5)
    screencap("android-frame_android_pixel-9-pro-xl_light_2.7.0-device.png")


if __name__ == "__main__":
    main()
