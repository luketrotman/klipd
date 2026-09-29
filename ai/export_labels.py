#!/usr/bin/env python3
"""
Export human labels as training data.

Writes ai/labels/<externalId>.json with:
  identities: player -> tracker fragment ids (from "Who is Player 07?" answers and admin links)
  events:     verified moments (quick labels and review-confirmed AI calls) with the fragment id
  rejected:   AI calls marked wrong (negatives)
plus ai/labels/<externalId>_crops/ with player crops per identity (for re-id training) when --crops.

Usage: ai/.venv/bin/python ai/export_labels.py --match match_thu5s [--crops]
"""
from __future__ import annotations
import argparse, json
from collections import defaultdict
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("--match", required=True)
ap.add_argument("--db", default="data/db.json")
ap.add_argument("--crops", action="store_true")
ap.add_argument("--max-crops", type=int, default=60)
args = ap.parse_args()

db = json.loads(Path(args.db).read_text())
match = next(m for m in db["matches"] if m["id"] == args.match)
video = next(v for v in db["videos"] if v["id"] == match["videoId"])
ext = video["externalId"]
tracked = {t["id"]: t for t in db["trackedPlayers"] if t["matchId"] == args.match}
profiles = {p["id"]: p["displayName"] for p in db["playerProfiles"]}

identities = []
for l in db["playerLinks"]:
    t = tracked.get(l["trackedPlayerId"])
    if t and t.get("trackIds"):
        identities.append({"playerId": l["playerId"], "player": profiles.get(l["playerId"]), "label": t["label"], "method": l["method"], "trackIds": t["trackIds"]})

ep = defaultdict(list)
for x in db["eventPlayers"]:
    ep[x["eventId"]].append(x)
events, rejected = [], []
for e in db["events"]:
    if e["matchId"] != args.match:
        continue
    meta = e.get("metadata", {})
    prim = next((x for x in ep[e["id"]] if x["role"] == "PRIMARY"), None)
    t = tracked.get(prim["trackedPlayerId"]) if prim and prim.get("trackedPlayerId") else None
    rec = {"type": e["type"], "timestamp": e["timestamp"], "startTime": e["startTime"], "endTime": e["endTime"],
           "trackId": meta.get("trackId"), "identityTrackIds": t.get("trackIds") if t else None, "playerId": prim.get("playerId") if prim else None}
    if e["source"] == "MANUAL" and meta.get("labeller") and not meta.get("demo"):
        events.append({**rec, "labeller": meta["labeller"]})
    elif e["source"] == "AI" and meta.get("review") == "wrong":
        rejected.append(rec)

out_dir = Path("ai/labels"); out_dir.mkdir(parents=True, exist_ok=True)
out = {"video": ext, "match": args.match, "identities": identities, "events": events, "rejected": rejected}
(out_dir / f"{ext}.json").write_text(json.dumps(out, indent=1))
print(f"{len(identities)} identities, {len(events)} verified events, {len(rejected)} rejected AI calls → ai/labels/{ext}.json")

if args.crops and identities:
    import cv2
    det = json.loads(Path(f"ai/output/{ext}.detections.json").read_text())
    by_track = defaultdict(list)
    for f in det["frames"]:
        for tid, x1, y1, x2, y2, cf in f["p"]:
            by_track[tid].append((f["t"], x1, y1, x2, y2))
    cap = cv2.VideoCapture(f"ai/videos/{ext}.mp4"); fps = cap.get(cv2.CAP_PROP_FPS)
    n = 0
    for ident in identities:
        obs = sorted(o for tid in ident["trackIds"] for o in by_track.get(tid, []))
        step = max(1, len(obs) // args.max_crops)
        d = out_dir / f"{ext}_crops" / (ident["playerId"] or ident["label"]); d.mkdir(parents=True, exist_ok=True)
        for t, x1, y1, x2, y2 in obs[::step]:
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(t * fps)))
            ok, frame = cap.read()
            if not ok:
                continue
            crop = frame[int(y1):int(y2), int(x1):int(x2)]
            if crop.size:
                cv2.imwrite(str(d / f"{t:.1f}.jpg"), crop); n += 1
    print(f"{n} crops written under ai/labels/{ext}_crops/")
