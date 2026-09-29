#!/usr/bin/env python3
"""
Measure the CV pipeline against human labels.

Ground truth = MANUAL events for a match (labelled in /admin/matches/[id]).
Predictions   = AI events for the same match (from the local CV run).

An AI event counts as a hit when a manual event of the same type exists within
`--window` seconds. Attribution is checked where the AI's tracked player has been
linked to a real player (via "That's me" or the admin link).

Usage:
  python3 ai/evaluate.py --match match_tue5s [--window 4] [--db data/db.json]
"""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

SIMILAR = {  # treat these as interchangeable when scoring type-agnostic recall
    "SKILL": {"SKILL", "NUTMEG", "DRIBBLE"},
    "NUTMEG": {"SKILL", "NUTMEG", "DRIBBLE"},
    "DRIBBLE": {"SKILL", "NUTMEG", "DRIBBLE"},
    "TACKLE": {"TACKLE", "INTERCEPTION", "BLOCK"},
    "INTERCEPTION": {"TACKLE", "INTERCEPTION", "BLOCK"},
    "BLOCK": {"TACKLE", "INTERCEPTION", "BLOCK"},
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--match", required=True)
    ap.add_argument("--db", default="data/db.json")
    ap.add_argument("--window", type=float, default=4.0)
    ap.add_argument("--min-conf", type=float, default=0.0)
    args = ap.parse_args()

    db = json.loads(Path(args.db).read_text())
    events = [e for e in db["events"] if e["matchId"] == args.match]
    truth = [e for e in events if e["source"] == "MANUAL" and not e.get("metadata", {}).get("demo")]
    pred = [e for e in events if e["source"] == "AI" and e["confidence"] >= args.min_conf]
    if not truth:
        print("No MANUAL labels for this match yet. Label goals, shots, assists, tackles in the admin editor first.")
        return
    if not pred:
        print("No AI events for this match. Run the REAL pipeline in the admin editor first.")
        return

    links = {l["trackedPlayerId"]: l["playerId"] for l in db["playerLinks"]}
    ep = defaultdict(list)
    for x in db["eventPlayers"]:
        ep[x["eventId"]].append(x)

    def primary_player(e):
        for x in ep[e["id"]]:
            if x["role"] == "PRIMARY":
                return x["playerId"] or links.get(x["trackedPlayerId"] or "")
        return None

    used = set()
    per_type = defaultdict(lambda: {"tp": 0, "fp": 0, "fn": 0, "attr_ok": 0, "attr_n": 0})
    for p in sorted(pred, key=lambda e: -e["confidence"]):
        cands = [t for t in truth if t["id"] not in used and t["type"] == p["type"] and abs(t["timestamp"] - p["timestamp"]) <= args.window]
        if cands:
            t = min(cands, key=lambda t: abs(t["timestamp"] - p["timestamp"]))
            used.add(t["id"])
            per_type[p["type"]]["tp"] += 1
            pp, tp_ = primary_player(p), primary_player(t)
            if pp and tp_:
                per_type[p["type"]]["attr_n"] += 1
                per_type[p["type"]]["attr_ok"] += int(pp == tp_)
        else:
            per_type[p["type"]]["fp"] += 1
    for t in truth:
        if t["id"] not in used:
            per_type[t["type"]]["fn"] += 1

    reviewed = [e for e in pred if e.get("metadata", {}).get("review")]
    if reviewed:
        ok = sum(1 for e in reviewed if e["metadata"]["review"] == "correct")
        by = defaultdict(lambda: [0, 0])
        for e in reviewed:
            by[e["type"]][1] += 1
            by[e["type"]][0] += int(e["metadata"]["review"] == "correct")
        print(f"Reviewed AI calls: {len(reviewed)} of {len(pred)} · precision {ok/len(reviewed):.0%} overall · " + ", ".join(f"{t} {a}/{n}" for t, (a, n) in sorted(by.items())))
    else:
        print("No AI calls reviewed yet: precision below counts every unreviewed AI call as a miss, so read recall only.")
    print(f"Match {args.match}: {len(truth)} labelled, {len(pred)} predicted (window ±{args.window}s, min conf {args.min_conf})")
    print(f"{'type':14} {'labelled':>8} {'predicted':>9} {'hits':>5} {'precision':>9} {'recall':>7} {'player ok':>10}")
    tot = {"tp": 0, "fp": 0, "fn": 0, "attr_ok": 0, "attr_n": 0}
    for typ in sorted(per_type, key=lambda k: -(per_type[k]["tp"] + per_type[k]["fn"])):
        r = per_type[typ]
        for k in tot:
            tot[k] += r[k]
        n_lab = r["tp"] + r["fn"]; n_pred = r["tp"] + r["fp"]
        prec = r["tp"] / n_pred if n_pred else float("nan")
        rec = r["tp"] / n_lab if n_lab else float("nan")
        attr = f"{r['attr_ok']}/{r['attr_n']}" if r["attr_n"] else "-"
        print(f"{typ:14} {n_lab:8d} {n_pred:9d} {r['tp']:5d} {prec:9.0%} {rec:7.0%} {attr:>10}")
    n_lab = tot["tp"] + tot["fn"]; n_pred = tot["tp"] + tot["fp"]
    print(f"{'ALL':14} {n_lab:8d} {n_pred:9d} {tot['tp']:5d} {tot['tp']/max(1,n_pred):9.0%} {tot['tp']/max(1,n_lab):7.0%} {tot['attr_ok']}/{tot['attr_n']:>8}")
    print("\nprecision = of what the AI flagged, how much a human also flagged; recall = of what the human flagged, how much the AI found.")


if __name__ == "__main__":
    main()
