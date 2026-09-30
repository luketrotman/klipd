#!/usr/bin/env python3
"""
KLIPD local computer-vision pipeline, v0.

This is REAL detection on the footage:
  1. YOLO (COCO weights) detects people and the ball on sampled frames.
  2. ByteTrack links people across frames into track fragments.
  3. A green-pitch mask drops people who are not on the pitch (spectators, next pitch).
  4. Kit colour clustering splits players into two teams.
  5. Track fragments are merged into a fixed number of players per team
     ("Player 01" ... ) using time-overlap, colour and position continuity.
  6. Ball possession is assigned to the nearest player each frame.
  7. Events (touches, dribbles, shots, goal candidates, tackles, interceptions,
     key passes, saves) come from rules over possession and ball motion. Each
     carries a confidence. Rules are deliberately simple and will be wrong
     sometimes: the admin editor exists to correct them and build training data.

Output: JSON consumed by src/lib/ai/local.ts.

Usage:
  ai/.venv/bin/python ai/run.py --video ai/videos/938101072.mp4 --out ai/output/938101072.json \
      --fps 5 --imgsz 1280 --model yolo11m.pt --per-team 5 --debug-frames 40
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np


if sys.version_info < (3, 10):
    sys.exit("KLIPD CV pipeline needs Python 3.10+ (DINOv2 requires it). Recreate ai/.venv with a newer Python.")


def log(stage: str, msg: str, **extra):
    rec = {"stage": stage, "msg": msg, **extra}
    print(json.dumps(rec), flush=True)


# --------------------------------------------------------------------------- pitch mask

def green_mask(bgr: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    return cv2.inRange(hsv, (30, 40, 40), (90, 255, 255))


def estimate_pitch_polygon(cap: cv2.VideoCapture, samples: int = 24) -> np.ndarray:
    """Union of stable green pixels across the video → largest blob → convex hull."""
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    acc = None
    n = 0
    for i in range(samples):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (i + 0.5) / samples))
        ok, f = cap.read()
        if not ok:
            continue
        small = cv2.resize(f, None, fx=0.25, fy=0.25)
        m = (green_mask(small) > 0).astype(np.float32)
        acc = m if acc is None else acc + m
        n += 1
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    if acc is None or n == 0:
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)); w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        return np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.int32)
    stable = ((acc / n) > 0.45).astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    stable = cv2.morphologyEx(stable, cv2.MORPH_CLOSE, k, iterations=3)
    stable = cv2.morphologyEx(stable, cv2.MORPH_OPEN, k, iterations=1)
    contours, _ = cv2.findContours(stable, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        h, w = stable.shape
        return np.array([[0, 0], [w * 4, 0], [w * 4, h * 4], [0, h * 4]], dtype=np.int32)
    big = max(contours, key=cv2.contourArea)
    hull = cv2.convexHull(big).reshape(-1, 2) * 4
    return hull.astype(np.int32)


def dilate_polygon(poly: np.ndarray, px: float) -> np.ndarray:
    c = poly.mean(axis=0)
    out = []
    for p in poly:
        v = p - c
        n = np.linalg.norm(v) or 1.0
        out.append(p + v / n * px)
    return np.array(out, dtype=np.int32)


def inside(poly: np.ndarray, x: float, y: float) -> bool:
    return cv2.pointPolygonTest(poly, (float(x), float(y)), False) >= 0


# --------------------------------------------------------------------------- colour

GRASS_LAB = None  # median Lab colour of the pitch surface, set in main()


def estimate_grass_lab(cap, pitch, samples=6):
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    vals = []
    mask = None
    for i in range(samples):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (i + 0.5) / samples))
        ok, f = cap.read()
        if not ok:
            continue
        if mask is None:
            mask = np.zeros(f.shape[:2], np.uint8)
            cv2.fillPoly(mask, [pitch.reshape(-1, 1, 2)], 255)
        g = (green_mask(f) > 0) & (mask > 0)
        lab = cv2.cvtColor(f, cv2.COLOR_BGR2LAB)[g]
        if len(lab):
            vals.append(lab[:: max(1, len(lab) // 20000)])
    cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
    if not vals:
        return None
    return np.median(np.concatenate(vals), axis=0).astype(np.float32)

def torso_colour(frame: np.ndarray, box) -> np.ndarray | None:
    x1, y1, x2, y2 = [int(v) for v in box]
    w, h = x2 - x1, y2 - y1
    if w < 6 or h < 12:
        return None
    crop = frame[y1 + int(0.22 * h): y1 + int(0.55 * h), x1 + int(0.25 * w): x2 - int(0.25 * w)]
    if crop.size == 0:
        return None
    lab = cv2.cvtColor(crop, cv2.COLOR_BGR2LAB).reshape(-1, 3)
    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV).reshape(-1, 3)
    # Exclude pixels that look like the pitch surface itself (not every green: lime bibs are green too).
    if GRASS_LAB is not None:
        keep = np.linalg.norm(lab.astype(np.float32) - GRASS_LAB, axis=1) > 22
    else:
        keep = ~(green_mask(crop) > 0).reshape(-1)
    if keep.sum() < 20:
        return None
    lab_k, hsv_k = lab[keep], hsv[keep]
    skin = (hsv_k[:, 0] >= 3) & (hsv_k[:, 0] <= 22) & (hsv_k[:, 1] < 170)
    vivid = (hsv_k[:, 1] > 90) & (hsv_k[:, 2] > 90) & ~skin
    # Bibs are worn over kits: when a vivid colour covers a fair share of the chest, that is the team colour.
    if vivid.mean() >= 0.2:
        return np.median(lab_k[vivid], axis=0)
    return np.median(lab_k[~skin] if (~skin).sum() >= 20 else lab_k, axis=0)


def colour_name(lab: np.ndarray) -> str:
    bgr = cv2.cvtColor(np.uint8([[lab]]), cv2.COLOR_LAB2BGR)[0, 0]
    hsv = cv2.cvtColor(np.uint8([[bgr]]), cv2.COLOR_BGR2HSV)[0, 0]
    h, s, v = int(hsv[0]), int(hsv[1]), int(hsv[2])
    if v < 60:
        return "black"
    if s < 45:
        return "white" if v > 150 else "grey"
    if h < 8 or h >= 170:
        return "red"
    if h < 22:
        return "orange"
    if h < 38:
        return "yellow"
    if h < 85:
        return "green"
    if h < 130:
        return "blue"
    if h < 160:
        return "purple"
    return "pink"


def kmeans2(X: np.ndarray, weights: np.ndarray, iters: int = 30, seed: int = 0):
    rng = np.random.default_rng(seed)
    best = None
    for _ in range(8):
        c = X[rng.choice(len(X), 2, replace=False)].astype(np.float64)
        for _ in range(iters):
            d = ((X[:, None, :] - c[None, :, :]) ** 2).sum(-1)
            lab = d.argmin(1)
            for k in range(2):
                m = lab == k
                if m.any():
                    c[k] = np.average(X[m], axis=0, weights=weights[m])
        inertia = (d.min(1) * weights).sum()
        if best is None or inertia < best[0]:
            best = (inertia, lab.copy(), c.copy())
    return best[1], best[2]


# --------------------------------------------------------------------------- detection pass

def run_detection(args, cap, model, pitch, pitch_d):
    vfps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    step = max(1, round(vfps / args.fps))
    start_f = int(args.start * vfps)
    end_f = min(total, int((args.start + args.duration) * vfps)) if args.duration else total
    cap.set(cv2.CAP_PROP_POS_FRAMES, start_f)

    frames = []            # per sampled frame: {"t", "p": [[id,x1,y1,x2,y2,conf],...], "b": [x1,y1,x2,y2,conf]|None}
    colours = defaultdict(list)   # track id -> list of Lab medians
    last_ball = None       # (t, cx, cy)
    ball_vel = (0.0, 0.0)  # px/s
    stats = {"frames": 0, "persons_raw": 0, "persons_on_pitch": 0, "ball_full": 0, "ball_roi": 0, "ball_tiled": 0}
    t0 = time.time()
    fi = start_f
    next_log = time.time() + 15
    while fi < end_f:
        if (fi - start_f) % step != 0:
            if not cap.grab():
                break
            fi += 1
            continue
        ok, frame = cap.read()
        if not ok:
            break
        t = fi / vfps
        res = model.track(frame, persist=True, classes=[0, 32], imgsz=args.imgsz, conf=0.15, iou=0.5,
                          device=args.device, verbose=False, tracker="bytetrack.yaml")[0]
        people, ball = [], None
        if res.boxes is not None and len(res.boxes):
            xyxy = res.boxes.xyxy.cpu().numpy()
            cls = res.boxes.cls.cpu().numpy().astype(int)
            conf = res.boxes.conf.cpu().numpy()
            ids = res.boxes.id.cpu().numpy().astype(int) if res.boxes.id is not None else np.full(len(cls), -1)
            for (x1, y1, x2, y2), c, cf, tid in zip(xyxy, cls, conf, ids):
                if c == 0:
                    stats["persons_raw"] += 1
                    if tid < 0 or cf < 0.3:
                        continue
                    if not inside(pitch_d, (x1 + x2) / 2, y2):
                        continue
                    h = y2 - y1
                    if h < 0.03 * H:
                        continue
                    stats["persons_on_pitch"] += 1
                    people.append([int(tid), round(float(x1), 1), round(float(y1), 1), round(float(x2), 1), round(float(y2), 1), round(float(cf), 3)])
                    if len(colours[int(tid)]) < 40 and (len(people) + fi) % 3 == 0:
                        col = torso_colour(frame, (x1, y1, x2, y2))
                        if col is not None:
                            colours[int(tid)].append(col)
                elif c == 32 and cf >= 0.12:
                    if inside(pitch_d, (x1 + x2) / 2, (y1 + y2) / 2) and (ball is None or cf > ball[4]):
                        ball = [round(float(x1), 1), round(float(y1), 1), round(float(x2), 1), round(float(y2), 1), round(float(cf), 3)]
        if ball is not None:
            stats["ball_full"] += 1
        elif last_ball is not None and t - last_ball[0] <= 1.5:
            # Region-of-interest search at native resolution around the predicted ball position.
            dt = t - last_ball[0]
            vx, vy = ball_vel
            cx, cy = last_ball[1] + vx * dt, last_ball[2] + vy * dt
            r = int(min(480, 220 + 1.5 * math.hypot(vx, vy) * dt))
            x0, y0 = int(max(0, cx - r)), int(max(0, cy - r))
            x1_, y1_ = int(min(W, cx + r)), int(min(H, cy + r))
            crop = frame[y0:y1_, x0:x1_]
            if crop.size:
                rr = model.predict(crop, classes=[32], imgsz=640, conf=0.1, device=args.device, verbose=False)[0]
                if rr.boxes is not None and len(rr.boxes):
                    j = int(rr.boxes.conf.argmax())
                    bx1, by1, bx2, by2 = rr.boxes.xyxy[j].cpu().numpy()
                    ball = [round(float(bx1 + x0), 1), round(float(by1 + y0), 1), round(float(bx2 + x0), 1), round(float(by2 + y0), 1), round(float(rr.boxes.conf[j]), 3)]
                    stats["ball_roi"] += 1
        if ball is None and (last_ball is None or t - last_ball[0] > 0.4) and stats["frames"] % 3 == 0:
            # Lost: tiled sweep of the frame at native resolution (2x2 tiles, batched).
            tiles, offs = [], []
            for ty in (0, H // 2):
                for tx in (0, W // 2):
                    tiles.append(frame[ty:ty + H // 2 + 40, tx:tx + W // 2 + 40]); offs.append((tx, ty))
            rs = model.predict(tiles, classes=[32], imgsz=960, conf=0.12, device=args.device, verbose=False)
            best = None
            for rr, (ox, oy) in zip(rs, offs):
                if rr.boxes is not None and len(rr.boxes):
                    j = int(rr.boxes.conf.argmax())
                    bx1, by1, bx2, by2 = rr.boxes.xyxy[j].cpu().numpy()
                    cf = float(rr.boxes.conf[j])
                    if inside(pitch_d, (bx1 + bx2) / 2 + ox, (by1 + by2) / 2 + oy) and (best is None or cf > best[4]):
                        best = [round(float(bx1 + ox), 1), round(float(by1 + oy), 1), round(float(bx2 + ox), 1), round(float(by2 + oy), 1), round(cf, 3)]
            if best is not None:
                ball = best
                stats["ball_tiled"] += 1
        if ball is not None:
            bx, by = (ball[0] + ball[2]) / 2, (ball[1] + ball[3]) / 2
            if last_ball is not None and 0 < t - last_ball[0] <= 0.6:
                ball_vel = ((bx - last_ball[1]) / (t - last_ball[0]), (by - last_ball[2]) / (t - last_ball[0]))
            else:
                ball_vel = (0.0, 0.0)
            last_ball = (t, bx, by)
        frames.append({"t": round(t, 3), "p": people, "b": ball})
        stats["frames"] += 1
        fi += 1
        if time.time() > next_log:
            el = time.time() - t0
            log("PLAYER_DETECTION", f"{stats['frames']} frames, t={t:.0f}s, {stats['frames']/el:.1f} fps, ball {stats['ball_full']+stats['ball_roi']+stats['ball_tiled']}/{stats['frames']}", progress=round((fi - start_f) / max(1, end_f - start_f), 3))
            next_log = time.time() + 15
    stats["elapsed_s"] = round(time.time() - t0, 1)
    stats["analysis_fps"] = round(stats["frames"] / max(0.1, stats["elapsed_s"]), 2)
    stats["ball_rate"] = round((stats["ball_full"] + stats["ball_roi"] + stats["ball_tiled"]) / max(1, stats["frames"]), 3)
    return frames, colours, stats, vfps, (W, H)


def recolour(cap, frames, every=5):
    """Recompute torso colours from cached detections with a sequential decode (no re-detection)."""
    vfps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    colours = defaultdict(list)
    targets = sorted(((int(round(f["t"] * vfps)), f) for f in frames[::every]), key=lambda x: x[0])
    if not targets:
        return colours
    cap.set(cv2.CAP_PROP_POS_FRAMES, targets[0][0])
    fi = targets[0][0]
    for want, f in targets:
        while fi < want:
            if not cap.grab():
                return colours
            fi += 1
        ok, frame = cap.read()
        fi += 1
        if not ok:
            break
        for tid, x1, y1, x2, y2, cf in f["p"]:
            col = torso_colour(frame, (x1, y1, x2, y2))
            if col is not None:
                colours[int(tid)].append(col)
    return colours


# --------------------------------------------------------------------------- fragments → players

def build_fragments(frames, colours):
    frag = {}
    for f in frames:
        for tid, x1, y1, x2, y2, cf in f["p"]:
            d = frag.setdefault(tid, {"id": tid, "obs": []})
            d["obs"].append((f["t"], x1, y1, x2, y2))
    out = []
    for tid, d in frag.items():
        obs = d["obs"]
        dur = obs[-1][0] - obs[0][0]
        cols = colours.get(tid, [])
        out.append({
            "id": tid, "obs": obs, "start": obs[0][0], "end": obs[-1][0], "dur": dur,
            "colour": np.median(np.array(cols), axis=0) if cols else None,
        })
    return out


def _lab_to_hsv(lab):
    bgr = cv2.cvtColor(np.uint8([[lab]]), cv2.COLOR_LAB2BGR)[0, 0]
    return cv2.cvtColor(np.uint8([[bgr]]), cv2.COLOR_BGR2HSV)[0, 0].astype(int)


def assign_teams(fragments):
    """Team split. In organised small sided games one team wears bibs, so the most common vivid
    colour defines team 0 and everyone else is team 1. Falls back to 2-means on kit colour when
    no bib colour dominates (e.g. both teams in plain kits)."""
    usable = [f for f in fragments if f["colour"] is not None and f["dur"] >= 1.0]
    if len(usable) < 2:
        for f in fragments:
            f["team"] = 0 if f["colour"] is not None else -1
        return [np.array([128, 128, 128]), np.array([128, 128, 128])]
    total = sum(f["dur"] for f in usable)
    vivid = [f for f in usable if (lambda h: h[1] > 70 and h[2] > 70)(_lab_to_hsv(f["colour"]))]
    bins = defaultdict(float)
    for f in vivid:
        bins[int(_lab_to_hsv(f["colour"])[0] // 15)] += f["dur"]
    if bins:
        top = max(bins, key=bins.get)
        share = (bins[top] + bins.get((top + 1) % 12, 0) + bins.get((top - 1) % 12, 0)) / total
    else:
        top, share = None, 0.0
    if top is not None and share >= 0.22:
        members = [f for f in vivid if abs(((int(_lab_to_hsv(f["colour"])[0] // 15) - top + 6) % 12) - 6) <= 1]
        centre = np.average(np.array([f["colour"] for f in members]), axis=0, weights=np.array([f["dur"] for f in members]))
        for f in fragments:
            if f["colour"] is None:
                f["team"] = -1
                continue
            h = _lab_to_hsv(f["colour"])
            hue_ok = abs(((int(h[0] // 15) - top + 6) % 12) - 6) <= 1 and h[1] > 60 and h[2] > 60
            f["team"] = 0 if hue_ok and np.linalg.norm(f["colour"] - centre) < 60 else 1
        others = [f for f in fragments if f["team"] == 1]
        other_centre = np.average(np.array([f["colour"] for f in others]), axis=0, weights=np.array([f["dur"] for f in others])) if others else np.array([128, 128, 128])
        return [centre, other_centre]
    X = np.array([f["colour"][[1, 2, 0]] * np.array([1.0, 1.0, 0.35]) for f in usable])  # a, b, scaled L
    w = np.array([f["dur"] for f in usable])
    lab, centres = kmeans2(X, w)
    for f, l in zip(usable, lab):
        f["team"] = int(l)
    for f in fragments:
        if "team" not in f:
            if f["colour"] is None:
                f["team"] = -1
            else:
                x = f["colour"][[1, 2, 0]] * np.array([1.0, 1.0, 0.35])
                f["team"] = int(((centres - x) ** 2).sum(1).argmin())
    return [np.array([c[2] / 0.35, c[0], c[1]]) for c in centres]


def merge_fragments(fragments, per_team: int):
    """Greedy merge of non-overlapping fragments into at most per_team+1 players per team."""
    players = []
    for team in (0, 1):
        fr = sorted([f for f in fragments if f["team"] == team and f["dur"] >= 0.4], key=lambda f: f["start"])
        tp = []
        cap = per_team + 3
        for f in fr:
            best, best_score = None, None
            for p in tp:
                if f["start"] < p["end"] - 0.2:
                    continue  # overlaps in time: different person
                gap = max(0.05, f["start"] - p["end"])
                lx, ly, lh = p["last"]
                fx, fy = (f["obs"][0][1] + f["obs"][0][3]) / 2, f["obs"][0][4]
                jump = math.hypot(fx - lx, fy - ly) / max(lh, 1.0)
                speed = jump / gap  # body-heights per second
                col = 0.0
                if p["colour"] is not None and f["colour"] is not None:
                    col = float(np.linalg.norm(p["colour"] - f["colour"])) / 40.0
                score = min(speed / 3.0, 3.0) + col + (0.5 if gap > 30 else 0)
                if best_score is None or score < best_score:
                    best, best_score = p, score
            if best is not None and best_score < 1.6:
                target = best
            elif len(tp) < cap:
                target = {"team": team, "frags": [], "colour": f["colour"], "end": -1, "last": (0, 0, 1), "dur": 0}
                tp.append(target)
            elif best is not None:
                target = best
            else:
                target = {"team": team, "frags": [], "colour": f["colour"], "end": -1, "last": (0, 0, 1), "dur": 0}
                tp.append(target)
            target["frags"].append(f)
            target["end"] = f["end"]
            o = f["obs"][-1]
            target["last"] = ((o[1] + o[3]) / 2, o[4], o[4] - o[2])
            target["dur"] += f["dur"]
            if target["colour"] is None:
                target["colour"] = f["colour"]
        tp.sort(key=lambda p: -p["dur"])
        players.extend(tp)
    return finalize_players(players, per_team)


def finalize_players(players, per_team):
    for p in players:
        p["obs"] = sorted([o for f in p["frags"] for o in f["obs"]], key=lambda o: o[0])
    # Drop people who never move: subs and spectators standing at the edge of the pitch.
    kept = []
    for p in players:
        xs = np.array([(o[1] + o[3]) / 2 for o in p["obs"]]); ys = np.array([o[4] for o in p["obs"]])
        hs = np.array([o[4] - o[2] for o in p["obs"]])
        span = math.hypot(np.ptp(xs), np.ptp(ys)) / max(1.0, float(np.median(hs)))
        if p["dur"] >= 20 and span < 1.5:
            continue
        kept.append(p)
    players = consolidate(kept, per_team)
    players.sort(key=lambda p: (p["team"], -p["dur"]))
    for i, p in enumerate(players):
        p["label"] = f"Player {i + 1:02d}"
    return players


def _time_overlap(a_obs, b_obs, tol=0.25):
    """Seconds during which both identities are observed (sampled)."""
    bt = np.array([o[0] for o in b_obs])
    n = 0
    for o in a_obs:
        i = np.searchsorted(bt, o[0])
        if (i < len(bt) and bt[i] - o[0] <= tol) or (i > 0 and o[0] - bt[i - 1] <= tol):
            n += 1
    return n


def consolidate(players, per_team):
    """Second pass: merge identities that never coexist in time into each other,
    largest first, until each team has at most per_team + 2 identities.
    ByteTrack ID switches otherwise leave one real player split over several identities."""
    out = []
    for team in (0, 1, -1):
        ids = sorted([p for p in players if p["team"] == team], key=lambda p: -p["dur"])
        changed = True
        while changed and len(ids) > (per_team + 2 if team >= 0 else 0):
            changed = False
            # try to merge the smallest identity into the best larger one
            small = ids[-1]
            best, best_cost = None, None
            for big in ids[:-1]:
                ov = _time_overlap(small["obs"], big["obs"]) / max(1, len(small["obs"]))
                if ov > 0.15:
                    continue  # they coexist too often to be one person
                col = float(np.linalg.norm(big["colour"] - small["colour"])) / 40.0 if big["colour"] is not None and small["colour"] is not None else 0.5
                cost = col + 4.0 * ov - 0.001 * big["dur"]
                if best_cost is None or cost < best_cost:
                    best, best_cost = big, cost
            if best is None:
                # nothing compatible: drop it if tiny, otherwise keep and stop
                if small["dur"] < 30:
                    ids.pop(); changed = True
                    continue
                break
            best["frags"].extend(small["frags"])
            best["obs"] = sorted(best["obs"] + small["obs"], key=lambda o: o[0])
            best["dur"] += small["dur"]
            ids.pop()
            ids.sort(key=lambda p: -p["dur"])
            changed = True
        out.extend([p for p in ids if p["dur"] >= 20])
    return out


# --------------------------------------------------------------------------- possession & events

def build_possession(frames, players, thresh=0.8):
    """Per frame: (t, player_index or None, dist). Then segments."""
    # index observations by time for quick lookup
    obs_at = defaultdict(dict)
    for pi, p in enumerate(players):
        for t, x1, y1, x2, y2 in p["obs"]:
            obs_at[t][pi] = (x1, y1, x2, y2)
    per_frame = []
    for f in frames:
        if f["b"] is None:
            per_frame.append((f["t"], None, None, None))
            continue
        bx, by = (f["b"][0] + f["b"][2]) / 2, (f["b"][1] + f["b"][3]) / 2
        best, bd = None, None
        for pi, (x1, y1, x2, y2) in obs_at.get(f["t"], {}).items():
            h = max(y2 - y1, 1.0)
            cx = (x1 + x2) / 2
            d = math.hypot(bx - cx, by - y2) / h
            # ball in the body box counts as close
            if x1 <= bx <= x2 and y1 <= by <= y2:
                d = min(d, 0.3)
            if bd is None or d < bd:
                best, bd = pi, d
        per_frame.append((f["t"], best if (bd is not None and bd < thresh) else None, bd, (bx, by)))
    # segments
    segs = []
    cur = None
    for t, pi, d, pos in per_frame:
        if pi is None:
            if cur and t - cur["end"] > 0.45:
                segs.append(cur); cur = None
            continue
        if cur and cur["player"] == pi and t - cur["end"] <= 0.45:
            cur["end"] = t; cur["n"] += 1; cur["path"].append(pos)
        else:
            if cur:
                segs.append(cur)
            cur = {"player": pi, "start": t, "end": t, "n": 1, "path": [pos]}
    if cur:
        segs.append(cur)
    segs = [s for s in segs if s["n"] >= 2 or (s["end"] - s["start"]) >= 0.25]
    return per_frame, segs


def ball_track(frames):
    pts = [(f["t"], (f["b"][0] + f["b"][2]) / 2, (f["b"][1] + f["b"][3]) / 2) for f in frames if f["b"] is not None]
    return pts


def player_height_near(players, t, x, y):
    hs = []
    for p in players:
        for ot, x1, y1, x2, y2 in p["obs"]:
            if abs(ot - t) < 0.3:
                hs.append((math.hypot((x1 + x2) / 2 - x, y2 - y), y2 - y1))
    if not hs:
        return 80.0
    hs.sort()
    return max(20.0, float(np.median([h for _, h in hs[:3]])))


def goal_zones(pitch, size, calibration):
    """Goal mouths as polygons. Calibrated per camera when available, else guessed from the pitch mask."""
    W, H = size
    if calibration and calibration.get("goals"):
        out = []
        for g in calibration["goals"]:
            poly = np.array(g["polygon"], dtype=np.int32)
            out.append({"end": g["end"], "poly": poly, "mid": (float(poly[:, 0].mean()), float(poly[:, 1].mean())), "calibrated": True})
        return out
    ys = pitch[:, 1]; top_y, bot_y = ys.min(), ys.max()
    top_pts = pitch[ys < top_y + 0.06 * H]; bot_pts = pitch[ys > bot_y - 0.06 * H]
    top_mid = (float(top_pts[:, 0].mean()), float(top_y)); bot_mid = (float(bot_pts[:, 0].mean()), float(bot_y))
    top_w = max(0.12 * W, float(np.ptp(top_pts[:, 0])) * 0.35 if len(top_pts) > 1 else 0.12 * W)
    bot_w = max(0.18 * W, float(np.ptp(bot_pts[:, 0])) * 0.35 if len(bot_pts) > 1 else 0.18 * W)
    def rect(mid, hw, hh):
        return np.array([[mid[0] - hw, mid[1] - hh], [mid[0] + hw, mid[1] - hh], [mid[0] + hw, mid[1] + hh], [mid[0] - hw, mid[1] + hh]], dtype=np.int32)
    return [{"end": "far", "poly": rect(top_mid, top_w / 2, 0.05 * H), "mid": top_mid, "calibrated": False},
            {"end": "near", "poly": rect(bot_mid, bot_w / 2, 0.09 * H), "mid": bot_mid, "calibrated": False}]


def detect_events(frames, players, per_frame, segs, pitch, size, calibration=None):
    W, H = size
    goals = goal_zones(pitch, size, calibration)

    def in_goal_zone(x, y):
        for g in goals:
            if inside(g["poly"], x, y):
                return g
        return None

    bt = ball_track(frames)
    bt_by_t = {t: (x, y) for t, x, y in bt}
    events = []

    def add(type_, t, primary, conf, start=None, end=None, secondary=None, team=None, **meta):
        p = players[primary]
        ev = {"type": type_, "timestamp": round(t, 2), "startTime": round(max(0, start if start is not None else t - 6), 2),
              "endTime": round(end if end is not None else t + 6, 2), "confidence": round(float(min(0.95, max(0.05, conf))), 2),
              "team": p["team"], "trackedLabels": [p["label"]] + ([players[secondary]["label"]] if secondary is not None else []),
              "metadata": {k: (round(v, 3) if isinstance(v, float) else v) for k, v in meta.items()}}
        events.append(ev)

    # --- touches / dribbles
    for s in segs:
        dur = s["end"] - s["start"]
        p = players[s["player"]]
        # displacement of the ball during the segment, normalised by local body height
        x0, y0 = s["path"][0]; x1, y1 = s["path"][-1]
        h = player_height_near(players, s["start"], x0, y0)
        disp = math.hypot(x1 - x0, y1 - y0) / h
        opp_near = False
        for q in players:
            if q["team"] == p["team"]:
                continue
            for ot, qx1, qy1, qx2, qy2 in q["obs"]:
                if s["start"] <= ot <= s["end"]:
                    for (bx, by) in s["path"][::3]:
                        if math.hypot((qx1 + qx2) / 2 - bx, qy2 - by) / max(qy2 - qy1, 1) < 1.3:
                            opp_near = True; break
                if opp_near:
                    break
            if opp_near:
                break
        s["disp"] = disp; s["opp_near"] = opp_near
        if dur >= 2.0 and disp >= 2.0 and opp_near:
            add("DRIBBLE", s["start"] + dur / 2, s["player"], 0.35 + min(0.4, disp / 12), start=s["start"] - 3, end=s["end"] + 3, duration=dur, displacement=disp)

    # --- shots, goals, saves, key passes, assists
    for i, s in enumerate(segs):
        # ball motion in the 0.8s after the segment ends
        t_end = s["end"]
        after = [(t, x, y) for t, x, y in bt if t_end < t <= t_end + 1.2]
        if len(after) < 2:
            continue
        (ta, xa, ya), (tb, xb, yb) = after[0], after[-1]
        if tb - ta < 0.15:
            continue
        h = player_height_near(players, t_end, xa, ya)
        speed = math.hypot(xb - xa, yb - ya) / h / (tb - ta)  # body heights per second
        if speed < 4.0:
            continue
        # direction toward which goal?
        best_goal, best_cos = None, -1
        for g in goals:
            gx, gy = g["mid"]
            v = np.array([xb - xa, yb - ya]); u = np.array([gx - xa, gy - ya])
            if np.linalg.norm(v) == 0 or np.linalg.norm(u) == 0:
                continue
            cos = float(v @ u / (np.linalg.norm(v) * np.linalg.norm(u)))
            if cos > best_cos:
                best_goal, best_cos = g, cos
        if best_goal is None or best_cos < 0.75:
            continue
        gx, gy = best_goal["mid"]
        dist_goal = math.hypot(gx - xa, gy - ya) / h
        if dist_goal > 14:
            continue
        shooter = s["player"]
        conf = 0.35 + min(0.3, (speed - 4) / 20) + 0.15 * (best_cos - 0.75) / 0.25 + (0.1 if dist_goal < 7 else 0)
        # what happened next (3.5 s window)
        later = [(t, x, y) for t, x, y in bt if tb < t <= tb + 3.5]
        outcome = "unknown"
        ended_in_goal = any(in_goal_zone(x, y) is best_goal for _, x, y in later[-4:]) if later else False
        # ball lost for a while right after entering goal zone → likely in the net
        zone_hit = any(in_goal_zone(x, y) is best_goal for _, x, y in later)
        lost_after = not any(tb + 1.0 < t <= tb + 3.5 for t, _, _ in bt)
        # kick-off pattern: ball near the centre of the pitch with low speed 5–25 s later
        cx_, cy_ = float(pitch[:, 0].mean()), float(pitch[:, 1].mean())
        kick = [(t, x, y) for t, x, y in bt if tb + 5 <= t <= tb + 25 and math.hypot(x - cx_, y - cy_) < 0.12 * W]
        next_seg = next((q for q in segs[i + 1:] if q["start"] > tb), None)
        if (zone_hit and lost_after) or (ended_in_goal and kick):
            outcome = "goal"
        elif next_seg and players[next_seg["player"]]["team"] != players[shooter]["team"] and next_seg["start"] - tb < 1.2:
            qx, qy = next_seg["path"][0]
            outcome = "saved" if in_goal_zone(qx, qy) is best_goal or math.hypot(qx - gx, qy - gy) / h < 3.0 else "blocked"
        add("SHOT", t_end, shooter, conf, start=t_end - 8, end=tb + 5, speed=speed, toward=best_goal["end"], dist=dist_goal, outcome=outcome)
        if outcome == "goal":
            gconf = 0.4 + (0.2 if kick else 0) + (0.15 if zone_hit and lost_after else 0)
            add("GOAL", tb, shooter, gconf, start=t_end - 10, end=tb + 8, speed=speed, kickoff_seen=bool(kick), zone_hit=zone_hit)
            # assist: previous possession by a team-mate within 3 s
            prev = next((q for q in reversed(segs[:i]) if s["start"] - q["end"] <= 3.0), None)
            if prev and players[prev["player"]]["team"] == players[shooter]["team"] and prev["player"] != shooter:
                add("ASSIST", prev["end"], prev["player"], gconf * 0.9, start=prev["start"] - 6, end=tb + 6, for_goal_at=round(tb, 2))
        elif outcome == "saved" and next_seg:
            add("SAVE", next_seg["start"], next_seg["player"], conf * 0.8, start=t_end - 6, end=next_seg["end"] + 4)
        else:
            prev = next((q for q in reversed(segs[:i]) if s["start"] - q["end"] <= 3.0), None)
            if prev and players[prev["player"]]["team"] == players[shooter]["team"] and prev["player"] != shooter and outcome != "blocked":
                add("KEY_PASS", prev["end"], prev["player"], conf * 0.6, start=prev["start"] - 5, end=tb + 4)

    # --- tackles / interceptions: possession changes team
    for a, b in zip(segs, segs[1:]):
        pa, pb = players[a["player"]], players[b["player"]]
        if pa["team"] == pb["team"] or pa["team"] < 0 or pb["team"] < 0:
            continue
        gap = b["start"] - a["end"]
        if gap > 2.5:
            continue
        ax, ay = a["path"][-1]; bx, by = b["path"][0]
        h = player_height_near(players, b["start"], bx, by)
        d = math.hypot(ax - bx, ay - by) / h
        if gap <= 1.0 and d < 1.5:
            add("TACKLE", b["start"], b["player"], 0.3 + (0.2 if d < 0.8 else 0), start=a["start"] - 3, end=b["end"] + 3, secondary=a["player"], gap=gap, dist=d)
        elif d >= 2.5:
            add("INTERCEPTION", b["start"], b["player"], 0.3 + min(0.2, d / 20), start=a["end"] - 4, end=b["end"] + 3, secondary=a["player"], gap=gap, dist=d)

    # --- goals from restarts: after a goal in small sided football the conceding team restarts
    # from the centre. A stationary ball mid-pitch with nobody on it, followed by a first touch,
    # is a kick-off; the goal happened in the 25 s before it.
    gm = [g["mid"] for g in goals]
    def rel_pos(x, y):
        dn = math.hypot(x - gm[1][0], y - gm[1][1]); df = math.hypot(x - gm[0][0], y - gm[0][1])
        return dn / max(1e-6, dn + df)
    kickoffs = []
    i = 0
    while i < len(bt) - 1:
        t0, x0, y0 = bt[i]
        j = i
        while j + 1 < len(bt) and bt[j + 1][0] - t0 <= 6.0 and math.hypot(bt[j + 1][1] - x0, bt[j + 1][2] - y0) < 0.02 * W:
            j += 1
        still = bt[j][0] - t0
        if still >= 1.2 and 0.3 <= rel_pos(x0, y0) <= 0.7:
            # nobody in possession while it sits there
            busy = any(s["start"] <= bt[j][0] and s["end"] >= t0 + 0.4 for s in segs)
            if not busy:
                first = next((s for s in segs if s["start"] >= bt[j][0] - 0.3 and s["start"] <= bt[j][0] + 4.0), None)
                kickoffs.append({"t": t0, "until": bt[j][0], "taker": first["player"] if first else None})
            i = j + 1
            continue
        i += 1
    existing_goal_ts = [e["timestamp"] for e in events if e["type"] == "GOAL"]
    for k in kickoffs:
        if any(abs(k["t"] - gt) < 30 for gt in existing_goal_ts):
            continue
        if k["t"] < 20:
            continue  # match start
        conceding = players[k["taker"]]["team"] if k["taker"] is not None else None
        # scorer: last shot by the other team in the 25 s before the restart, else last possession of that team
        window = [e for e in events if e["type"] == "SHOT" and k["t"] - 25 <= e["timestamp"] <= k["t"] and (conceding is None or e["team"] != conceding)]
        if window:
            sh = window[-1]
            pi = next((idx for idx, p in enumerate(players) if p["label"] == sh["trackedLabels"][0]), None)
            if pi is None:
                continue
            add("GOAL", sh["timestamp"] + 1.0, pi, 0.55 if conceding is not None else 0.45, start=sh["timestamp"] - 9, end=sh["timestamp"] + 7, restart_at=round(k["t"], 1), via="restart+shot")
            sh["metadata"]["outcome"] = "goal"
        else:
            poss = [s for s in segs if k["t"] - 25 <= s["end"] <= k["t"] and (conceding is None or players[s["player"]]["team"] != conceding)]
            if poss:
                sp = poss[-1]
                add("GOAL", sp["end"], sp["player"], 0.35, start=sp["start"] - 8, end=sp["end"] + 7, restart_at=round(k["t"], 1), via="restart+possession")
        existing_goal_ts.append(k["t"])
    events.sort(key=lambda e: e["timestamp"])

    # --- touches as involvement moments (kept separate; the app decides whether to show them)
    touches = [{"player": players[s["player"]]["label"], "start": round(s["start"], 2), "end": round(s["end"], 2)} for s in segs]
    events.sort(key=lambda e: e["timestamp"])
    # de-duplicate near-identical events
    dedup = []
    for e in events:
        if any(d["type"] == e["type"] and d["trackedLabels"][0] == e["trackedLabels"][0] and abs(d["timestamp"] - e["timestamp"]) < 3 for d in dedup):
            continue
        dedup.append(e)
    return dedup, touches, goals


# --------------------------------------------------------------------------- debug frames

def write_debug(args, cap, vfps, frames, players, events, pitch, ball_by_t, out_dir: Path, limit: int, goals=None):
    out_dir.mkdir(parents=True, exist_ok=True)
    obs_at = defaultdict(list)
    for p in players:
        for t, x1, y1, x2, y2 in p["obs"]:
            obs_at[t].append((p["label"], p["team"], x1, y1, x2, y2))
    ts = sorted({f["t"] for f in frames})
    def nearest_t(t):
        i = int(np.searchsorted(ts, t))
        c = [ts[j] for j in (i - 1, i) if 0 <= j < len(ts)]
        return min(c, key=lambda x: abs(x - t)) if c else None
    written = []
    for i, e in enumerate(events[:limit]):
        t = nearest_t(e["timestamp"])
        if t is None:
            continue
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(round(t * vfps)))
        ok, frame = cap.read()
        if not ok:
            continue
        cv2.polylines(frame, [pitch.reshape(-1, 1, 2)], True, (0, 255, 255), 2)
        for g in goals or []:
            cv2.polylines(frame, [g["poly"].reshape(-1, 1, 2)], True, (255, 255, 255), 2)
        for label, team, x1, y1, x2, y2 in obs_at.get(t, []):
            colr = (255, 120, 0) if team == 0 else (0, 140, 255) if team == 1 else (160, 160, 160)
            thick = 4 if label in e["trackedLabels"] else 2
            cv2.rectangle(frame, (int(x1), int(y1)), (int(x2), int(y2)), colr, thick)
            cv2.putText(frame, label, (int(x1), int(y1) - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.6, colr, 2)
        b = ball_by_t.get(t)
        if b:
            cv2.circle(frame, (int(b[0]), int(b[1])), 14, (0, 0, 255), 3)
        cv2.putText(frame, f"{e['type']} {e['trackedLabels'][0]} conf {e['confidence']} t={e['timestamp']}s", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 3)
        name = f"{args.tag}_{i:03d}_{e['type']}_{int(e['timestamp'])}s.jpg"
        cv2.imwrite(str(out_dir / name), frame, [cv2.IMWRITE_JPEG_QUALITY, 80])
        written.append(name)
    return written


# --------------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="yolo11m.pt")
    ap.add_argument("--imgsz", type=int, default=1280)
    ap.add_argument("--fps", type=float, default=5.0, help="analysis frames per second")
    ap.add_argument("--start", type=float, default=0.0)
    ap.add_argument("--duration", type=float, default=0.0, help="seconds; 0 = whole video")
    ap.add_argument("--per-team", type=int, default=5)
    ap.add_argument("--device", default="mps")
    ap.add_argument("--debug-frames", type=int, default=0)
    ap.add_argument("--tag", default="run")
    ap.add_argument("--reuse", action="store_true", help="reuse cached detections from a previous run with the same --out")
    ap.add_argument("--calibration", default="", help="JSON with per-camera goal polygons (ai/calibration/<id>.json)")
    ap.add_argument("--recolour", action="store_true", help="with --reuse: recompute kit colours from the video")
    ap.add_argument("--reid", action="store_true", help="appearance re-identification (DINOv2) to merge track fragments into players")
    ap.add_argument("--reid-tau", type=float, default=0.62)
    args = ap.parse_args()

    from ultralytics import YOLO

    cap = cv2.VideoCapture(args.video)
    if not cap.isOpened():
        log("FAILED", f"cannot open {args.video}"); sys.exit(2)
    vfps = cap.get(cv2.CAP_PROP_FPS)
    log("PROCESSING", f"video {args.video} {int(cap.get(3))}x{int(cap.get(4))} @ {vfps:.2f} fps, {cap.get(7)/vfps:.0f}s")

    pitch = estimate_pitch_polygon(cap)
    pitch_d = dilate_polygon(pitch, 0.03 * cap.get(4))
    global GRASS_LAB
    GRASS_LAB = estimate_grass_lab(cap, pitch)
    log("PROCESSING", f"grass colour (Lab) {None if GRASS_LAB is None else [round(float(v)) for v in GRASS_LAB]}")
    log("PROCESSING", f"pitch polygon with {len(pitch)} points, area {cv2.contourArea(pitch)/(cap.get(3)*cap.get(4)):.0%} of frame")

    cache = Path(args.out).with_suffix(".detections.json")
    if args.reuse and cache.exists():
        c = json.loads(cache.read_text())
        frames, stats, vfps, size = c["frames"], c["stats"], c["vfps"], tuple(c["size"])
        colours = {int(k): [np.array(v) for v in vs] for k, vs in c["colours"].items()}
        log("PLAYER_DETECTION", f"reused cached detections: {stats}")
        if args.recolour:
            log("PLAYER_TRACKING", "recomputing kit colours from the video")
            colours = recolour(cap, frames)
            c["colours"] = {str(k): [list(map(float, v)) for v in vs] for k, vs in colours.items()}
            cache.write_text(json.dumps(c))
    else:
        here = Path(__file__).resolve().parent
        if not Path(args.model).exists() and (here / args.model).exists():
            args.model = str(here / args.model)
        elif not Path(args.model).exists():
            os.chdir(here)  # first run: weights download next to the pipeline, not into the project root
        model = YOLO(args.model)
        log("PLAYER_DETECTION", f"model {args.model} imgsz {args.imgsz} device {args.device} sampling {args.fps} fps")
        frames, colours, stats, vfps, size = run_detection(args, cap, model, pitch, pitch_d)
        log("PLAYER_DETECTION", f"done: {stats}")
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps({"frames": frames, "stats": stats, "vfps": vfps, "size": list(size),
                                     "colours": {str(k): [list(map(float, v)) for v in vs] for k, vs in colours.items()}}))

    log("PLAYER_TRACKING", "merging track fragments into players")
    fragments = build_fragments(frames, colours)
    team_lab = assign_teams(fragments)
    if args.reid:
        from reid import fragment_embeddings, cluster_identities
        emb_cache = Path(args.out).with_suffix(".embeddings.npz")
        if args.reuse and emb_cache.exists():
            z = np.load(emb_cache)
            embeddings = {int(k): (z[k][:-1], int(z[k][-1])) for k in z.files}
            log("PLAYER_TRACKING", f"reused {len(embeddings)} cached re-id embeddings")
        else:
            log("PLAYER_TRACKING", "computing re-id embeddings (DINOv2)")
            embeddings = fragment_embeddings(cap, frames, device=args.device, log=log)
            np.savez_compressed(emb_cache, **{str(k): np.append(v[0], v[1]) for k, v in embeddings.items()})
        players = finalize_players(cluster_identities(fragments, embeddings, args.per_team, tau=args.reid_tau, log=log), args.per_team)
    else:
        players = merge_fragments(fragments, args.per_team)
    team_names = [colour_name(c) for c in team_lab]
    log("PLAYER_TRACKING", f"{len(fragments)} fragments → {len(players)} players; teams {team_names}")

    log("EVENT_DETECTION", "possession and events")
    per_frame, segs = build_possession(frames, players)
    calibration = json.loads(Path(args.calibration).read_text()) if args.calibration and Path(args.calibration).exists() else None
    log("EVENT_DETECTION", f"goal zones: {'calibrated' if calibration else 'estimated from pitch mask'}")
    events, touches, goals = detect_events(frames, players, per_frame, segs, pitch, size, calibration)
    by_type = defaultdict(int)
    for e in events:
        by_type[e["type"]] += 1
    log("EVENT_DETECTION", f"{len(segs)} possessions, {len(events)} events {dict(by_type)}")
    log("EVENT_DETECTION", f"restarts detected: {sum(1 for e in events if e['type'] == 'GOAL' and 'restart_at' in e['metadata'])} goals inferred from restarts")

    debug_files = []
    if args.debug_frames:
        log("GENERATING_KLIPS", "writing debug frames")
        ball_by_t = {f["t"]: ((f["b"][0] + f["b"][2]) / 2, (f["b"][1] + f["b"][3]) / 2) for f in frames if f["b"]}
        debug_files = write_debug(args, cap, vfps, frames, players, events, pitch, ball_by_t, Path(args.out).parent.parent / "debug", args.debug_frames, goals)

    out = {
        "engine": "KLIPD-CV-v0",
        "video": {"path": args.video, "width": size[0], "height": size[1], "fps": vfps, "analysedFps": args.fps, "start": args.start, "duration": args.duration},
        "model": args.model,
        "stats": {**stats, "fragments": len(fragments), "players": len(players), "possessions": len(segs), "events": len(events), "eventsByType": dict(by_type)},
        "teams": [{"index": i, "colour": team_names[i], "lab": [round(float(v), 1) for v in team_lab[i]]} for i in range(2)],
        "pitchPolygon": pitch.tolist(),
        "goals": [{"end": g["end"], "mid": [round(g["mid"][0]), round(g["mid"][1])], "calibrated": g["calibrated"], "polygon": g["poly"].tolist()} for g in goals],
        "tracked": [{
            "label": p["label"], "team": p["team"], "colour": team_names[p["team"]] if p["team"] in (0, 1) else None,
            "coverageSeconds": round(p["dur"], 1), "fragments": len(p["frags"]),
            "touches": sum(1 for s in segs if players[s["player"]] is p),
            "possessionSeconds": round(sum(s["end"] - s["start"] for s in segs if players[s["player"]] is p), 1),
            "confidence": round(min(0.95, 0.5 + p["dur"] / 600), 2),
            "embedding": [round(float(v), 4) for v in p["embedding"]] if p.get("embedding") is not None else None,
            "trackIds": [f["id"] for f in p["frags"]],
        } for p in players],
        "events": events,
        "touches": touches,
        "debugFrames": debug_files,
    }
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(json.dumps(out))
    log("READY", f"wrote {args.out}")


if __name__ == "__main__":
    main()
