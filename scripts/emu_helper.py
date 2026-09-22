#!/usr/bin/env python3
"""Helper for emu-drive.sh: parses uiautomator dumps and feeds GPS fixes.

Subcommands:
  find <xml> <text>      print "x y" center of the node whose text/content-desc
                         equals <text> (case-insensitive); exit 1 listing visible texts
  texts <xml>            print every non-empty text / content-desc, one per line
  drive <lat1> <lng1> <lat2> <lng2> <mph> <interval_s>
  park <lat> <lng> <seconds> <interval_s>
"""
import math
import os
import random
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

ADB = os.environ.get("ADB", "adb")
EARTH_M = 6371008.8
MPH_TO_MPS = 0.44704


def nodes(xml_path):
    root = ET.parse(xml_path).getroot()
    for n in root.iter("node"):
        yield n


def labels(n):
    return [s for s in (n.get("text", ""), n.get("content-desc", "")) if s.strip()]


def center(bounds):
    x1, y1, x2, y2 = map(int, re.findall(r"-?\d+", bounds))
    return (x1 + x2) // 2, (y1 + y2) // 2


def cmd_texts(xml_path):
    for n in nodes(xml_path):
        for s in labels(n):
            print(s)


def cmd_find(xml_path, want):
    want_l = want.strip().lower()
    for n in nodes(xml_path):
        if any(s.strip().lower() == want_l for s in labels(n)):
            x, y = center(n.get("bounds"))
            print(x, y)
            return 0
    seen = [s for n in nodes(xml_path) for s in labels(n)]
    print(f"tap: no node with text {want!r}. Visible texts:", file=sys.stderr)
    for s in seen:
        print(f"  {s!r}", file=sys.stderr)
    return 1


def geo_fix(lat, lng):
    # adb emu geo fix takes longitude FIRST.
    subprocess.run([ADB, "emu", "geo", "fix", f"{lng:.7f}", f"{lat:.7f}"],
                   check=True, stdout=subprocess.DEVNULL)
    print(f"fix {lat:.6f} {lng:.6f}", flush=True)


def haversine_m(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_M * math.asin(math.sqrt(a))


def feed(points, interval):
    """Send each (lat, lng) one interval apart, compensating for adb latency."""
    t0 = time.monotonic()
    for i, (lat, lng) in enumerate(points):
        delay = t0 + i * interval - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        geo_fix(lat, lng)


def cmd_drive(lat1, lng1, lat2, lng2, mph, interval):
    dist = haversine_m(lat1, lng1, lat2, lng2)
    secs = dist / (mph * MPH_TO_MPS)
    steps = max(1, math.ceil(secs / interval))
    # Linear interpolation in lat/lng is fine at city scale.
    pts = [(lat1 + (lat2 - lat1) * i / steps, lng1 + (lng2 - lng1) * i / steps)
           for i in range(steps + 1)]
    print(f"drive {dist:.0f} m = {dist / 1609.344:.3f} mi, {steps + 1} fixes, "
          f"~{steps * interval:.0f} s", file=sys.stderr)
    feed(pts, interval)


def cmd_park(lat, lng, seconds, interval, jitter_m=8.0):
    n = max(1, int(seconds // interval))
    m_per_deg_lat = 111_320.0
    m_per_deg_lng = 111_320.0 * math.cos(math.radians(lat))
    pts = []
    for _ in range(n):
        r = jitter_m * math.sqrt(random.random())
        th = random.uniform(0, 2 * math.pi)
        pts.append((lat + r * math.sin(th) / m_per_deg_lat,
                    lng + r * math.cos(th) / m_per_deg_lng))
    feed(pts, interval)


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    c, a = argv[1], argv[2:]
    if c == "texts" and len(a) == 1:
        cmd_texts(a[0])
    elif c == "find" and len(a) == 2:
        return cmd_find(a[0], a[1])
    elif c == "drive" and len(a) == 6:
        cmd_drive(*map(float, a))
    elif c == "park" and len(a) == 4:
        cmd_park(*map(float, a))
    else:
        print(__doc__, file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
