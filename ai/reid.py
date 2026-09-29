"""
Player re-identification for KLIPD.

Each tracked fragment (a run of ByteTrack detections with one id) gets an appearance
embedding: DINOv2 ViT-S/14 features of the player crops, averaged. Fragments are then
clustered into identities with a hard constraint that two fragments of the same person
cannot overlap in time. Bibs make team-mates look alike, so the embedding leans on
shorts, socks, boots, hair, build and height; kit colour is a small extra term.
"""
from __future__ import annotations

from collections import defaultdict

import cv2
import numpy as np
import torch
import torch.nn.functional as F

CROP_H, CROP_W = 224, 112  # multiples of 14 for DINOv2


class Embedder:
    def __init__(self, device: str = "mps"):
        self.device = device if (device != "mps" or torch.backends.mps.is_available()) else "cpu"
        self.model = torch.hub.load("facebookresearch/dinov2", "dinov2_vits14", verbose=False).eval().to(self.device)
        self.mean = torch.tensor([0.485, 0.456, 0.406], device=self.device).view(1, 3, 1, 1)
        self.std = torch.tensor([0.229, 0.224, 0.225], device=self.device).view(1, 3, 1, 1)

    @torch.no_grad()
    def embed(self, crops: list[np.ndarray]) -> np.ndarray:
        if not crops:
            return np.zeros((0, 384), np.float32)
        arr = np.stack([cv2.cvtColor(cv2.resize(c, (CROP_W, CROP_H)), cv2.COLOR_BGR2RGB) for c in crops])
        x = torch.from_numpy(arr).to(self.device).permute(0, 3, 1, 2).float() / 255.0
        x = (x - self.mean) / self.std
        out = self.model(x)
        return F.normalize(out, dim=1).cpu().numpy()


def fragment_embeddings(cap, frames, every: int = 5, max_per_track: int = 24, device: str = "mps", log=None):
    """Sequential pass over the video; returns {track_id: (mean_embedding, n_crops)}."""
    emb = Embedder(device)
    vfps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    targets = sorted(((int(round(f["t"] * vfps)), f) for f in frames[::every]), key=lambda x: x[0])
    sums: dict[int, np.ndarray] = {}
    counts: dict[int, int] = defaultdict(int)
    if not targets:
        return {}
    cap.set(cv2.CAP_PROP_POS_FRAMES, targets[0][0])
    fi = targets[0][0]
    pending_crops, pending_ids = [], []
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)); W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))

    def flush():
        nonlocal pending_crops, pending_ids
        if not pending_crops:
            return
        vecs = emb.embed(pending_crops)
        for tid, v in zip(pending_ids, vecs):
            sums[tid] = sums.get(tid, 0) + v
            counts[tid] += 1
        pending_crops, pending_ids = [], []

    done = 0
    for want, f in targets:
        while fi < want:
            if not cap.grab():
                flush()
                return {k: (sums[k] / counts[k], counts[k]) for k in sums}
            fi += 1
        ok, frame = cap.read()
        fi += 1
        if not ok:
            break
        for tid, x1, y1, x2, y2, cf in f["p"]:
            if counts[int(tid)] >= max_per_track:
                continue
            w, h = x2 - x1, y2 - y1
            if h < 24 or w < 8:
                continue
            # a little context around the box helps with shorts/boots at the edges
            X1, Y1 = int(max(0, x1 - 0.05 * w)), int(max(0, y1 - 0.03 * h))
            X2, Y2 = int(min(W, x2 + 0.05 * w)), int(min(H, y2 + 0.03 * h))
            crop = frame[Y1:Y2, X1:X2]
            if crop.size == 0:
                continue
            pending_crops.append(crop); pending_ids.append(int(tid))
            if len(pending_crops) >= 64:
                flush()
        done += 1
        if log and done % 400 == 0:
            log("PLAYER_TRACKING", f"re-id embeddings: {done}/{len(targets)} frames")
    flush()
    return {k: (sums[k] / counts[k], counts[k]) for k in sums}


def _overlap_seconds(a_iv, b_iv):
    """Total seconds two sorted interval lists overlap, and the longest single overlap."""
    i = j = 0
    total = 0.0
    longest = 0.0
    while i < len(a_iv) and j < len(b_iv):
        s = max(a_iv[i][0], b_iv[j][0]); e = min(a_iv[i][1], b_iv[j][1])
        if e > s:
            total += e - s
            longest = max(longest, e - s)
        if a_iv[i][1] < b_iv[j][1]:
            i += 1
        else:
            j += 1
    return total, longest


def _overlaps(a_iv, b_iv, dur_a=None, dur_b=None):
    """Can these two identities NOT be the same person? Tracker id switches leave brief
    overlaps, so a small proportional overlap is tolerated."""
    total, longest = _overlap_seconds(a_iv, b_iv)
    small = min(dur_a if dur_a is not None else 1e9, dur_b if dur_b is not None else 1e9)
    return longest > 2.0 or total > max(1.0, 0.06 * small)


def _track_of(frags):
    """Sampled positions keyed by tenths of a second: {t10: (cx, feet_y, h)}."""
    d = {}
    for f in frags:
        for t, x1, y1, x2, y2 in f["obs"]:
            d[int(round(t * 10))] = ((x1 + x2) / 2, y2, max(1.0, y2 - y1))
    return d


def _conflict(a, b, min_common=3, max_dist=0.8):
    """Same moment, different place → different people. Same moment, same place → duplicate box."""
    small, big = (a["track"], b["track"]) if len(a["track"]) <= len(b["track"]) else (b["track"], a["track"])
    dists = []
    for k, (cx, cy, h) in small.items():
        q = big.get(k)
        if q is None:
            continue
        dists.append(np.hypot(cx - q[0], cy - q[1]) / max(h, q[2]))
    if len(dists) < min_common:
        return False
    return float(np.median(dists)) > max_dist


def cluster_identities(fragments, embeddings, per_team: int, tau: float | None = None, colour_w: float = 0.15, max_extra: int = 3, log=None):
    """Constrained agglomerative clustering of fragments into identities, per team.

    Constraint: fragments that coexist in different places cannot merge. Similarity: cosine of
    per-team mean-centred DINOv2 embeddings, minus a small kit-colour penalty. Threshold is
    self-calibrated from pairs that are known to be different people (they conflict).
    Long fragments (≥3 s) form the identities; short ones are attached afterwards.
    """
    players = []
    for team in (0, 1):
        fr = [f for f in fragments if f["team"] == team and f["dur"] >= 0.4]
        if not fr:
            continue
        raw = {f["id"]: embeddings[f["id"]][0] for f in fr if f["id"] in embeddings}
        if len(raw) >= 3:
            w = np.array([f["dur"] for f in fr if f["id"] in raw])
            M = np.stack([raw[f["id"]] for f in fr if f["id"] in raw])
            mean = np.average(M, axis=0, weights=w)
            emb = {k: (v - mean) / (np.linalg.norm(v - mean) + 1e-9) for k, v in raw.items()}
        else:
            emb = {k: v / (np.linalg.norm(v) + 1e-9) for k, v in raw.items()}

        def make(f):
            e = emb.get(f["id"])
            return {"team": team, "frags": [f], "dur": f["dur"], "emb": None if e is None else e * f["dur"], "embw": 0.0 if e is None else f["dur"],
                    "colour": f["colour"], "colw": 0.0 if f["colour"] is None else f["dur"], "track": _track_of([f])}

        def mean_emb(c):
            return None if c["embw"] == 0 else c["emb"] / c["embw"]

        def sim(a, b):
            ea, eb = mean_emb(a), mean_emb(b)
            s = 0.0 if ea is None or eb is None else float(ea @ eb / (np.linalg.norm(ea) * np.linalg.norm(eb) + 1e-9))
            if a["colour"] is not None and b["colour"] is not None:
                s -= colour_w * min(1.0, float(np.linalg.norm(a["colour"] - b["colour"])) / 60.0)
            return s

        def merge(a, b):
            return {"team": team, "frags": a["frags"] + b["frags"], "dur": a["dur"] + b["dur"],
                    "emb": (a["emb"] if a["emb"] is not None else 0) + (b["emb"] if b["emb"] is not None else 0) if (a["emb"] is not None or b["emb"] is not None) else None,
                    "embw": a["embw"] + b["embw"],
                    "colour": (a["colour"] * a["colw"] + b["colour"] * b["colw"]) / (a["colw"] + b["colw"]) if a["colour"] is not None and b["colour"] is not None else (a["colour"] if a["colour"] is not None else b["colour"]),
                    "colw": a["colw"] + b["colw"], "track": {**a["track"], **b["track"]}}

        long_fr = [f for f in fr if f["dur"] >= 3.0]
        short_fr = [f for f in fr if f["dur"] < 3.0]
        clusters = [make(f) for f in long_fr]

        # self-calibrated threshold from pairs known to be different people
        t_tau = tau
        if t_tau is None:
            diff = [sim(clusters[i], clusters[j]) for i in range(len(clusters)) for j in range(i + 1, len(clusters)) if _conflict(clusters[i], clusters[j])]
            t_tau = float(max(0.35, min(0.7, np.percentile(diff, 90)))) if len(diff) > 30 else 0.5
        if log:
            log("PLAYER_TRACKING", f"team {team}: {len(long_fr)} long + {len(short_fr)} short fragments, re-id threshold {t_tau:.2f}")

        while len(clusters) > 1:
            n = len(clusters)
            best, best_s = None, -1.0
            for i in range(n):
                for j in range(i + 1, n):
                    s_ = sim(clusters[i], clusters[j])
                    if s_ <= best_s or s_ < t_tau:
                        continue
                    if _conflict(clusters[i], clusters[j]):
                        continue
                    best, best_s = (i, j), s_
            if best is None:
                break
            i, j = best
            clusters = [c for k, c in enumerate(clusters) if k not in (i, j)] + [merge(clusters[i], clusters[j])]

        # attach short fragments to the best compatible identity
        attached = 0
        for f in sorted(short_fr, key=lambda f: -f["dur"]):
            c = make(f)
            best, best_s = None, t_tau - 0.1
            for cl in clusters:
                s_ = sim(c, cl)
                if s_ > best_s and not _conflict(c, cl, min_common=2):
                    best, best_s = cl, s_
            if best is not None:
                idx = clusters.index(best)
                clusters[idx] = merge(best, c)
                attached += 1
        clusters.sort(key=lambda c: -c["dur"])
        if log:
            log("PLAYER_TRACKING", f"team {team}: {len(clusters)} identities, {attached}/{len(short_fr)} short fragments attached")
        for c in clusters:
            players.append({"team": team, "frags": c["frags"], "colour": c["colour"], "dur": c["dur"], "end": max(f["end"] for f in c["frags"]), "last": (0, 0, 1), "embedding": mean_emb(c)})
    return players
