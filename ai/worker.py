#!/usr/bin/env python3
"""
KLIPD processing worker.

Runs on a machine that has the footage and the compute (a Mac, a GPU box). It polls the KLIPD
server for jobs, does the heavy work, and uploads the results. The web app itself never needs
a GPU or the video files.

  PROCESS  detect + track + re-identify + events on a match video, upload the CV JSON
  RENDER   cut watermarked MP4 clips and thumbnails for KLIPs, upload them

Setup (on the worker machine):
  export KLIPD_URL=https://your-app.example.com
  export WORKER_TOKEN=<same value as on the server>
  ai/.venv/bin/python ai/worker.py            # loop forever
  ai/.venv/bin/python ai/worker.py --once     # process at most one job then exit

Footage lookup order for a job: ai/videos/<externalId>.mp4, then (Vimeo) an automatic download.
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
VIDEOS = HERE / "videos"
OUTPUT = HERE / "output"
PY = sys.executable
BASE = os.environ.get("KLIPD_URL", "http://localhost:3010").rstrip("/")
TOKEN = os.environ.get("WORKER_TOKEN", "")
WORKER_ID = os.environ.get("WORKER_ID", f"{platform.node()}-{os.getpid()}")


def api(method: str, path: str, body: bytes | None = None, content_type: str = "application/json", timeout: int = 120):
    req = urllib.request.Request(BASE + path, data=body, method=method, headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": content_type})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def say(job_id: str | None, msg: str):
    print(f"[worker] {msg}", flush=True)
    if job_id:
        try:
            api("POST", f"/api/worker/jobs/{job_id}/log", json.dumps({"message": msg}).encode())
        except Exception:
            pass


def ensure_video(video: dict, job_id: str) -> Path:
    VIDEOS.mkdir(parents=True, exist_ok=True)
    path = VIDEOS / f"{video['externalId']}.mp4"
    if path.exists():
        return path
    if video["provider"] != "vimeo":
        raise RuntimeError(f"Footage {video['externalId']} ({video['provider']}) is not on this worker. Put it at {path}.")
    say(job_id, f"Downloading Vimeo {video['externalId']}")
    ytdlp = shutil.which("yt-dlp") or str(HERE / ".venv" / "bin" / "yt-dlp")
    subprocess.run([ytdlp, "-q", "--no-warnings", "--referer", "https://vimeo.com/", "-f", "bv*[height<=1080]/bv*", "-N", "8", "-o", str(path), f"https://player.vimeo.com/video/{video['externalId']}"], check=True)
    if not path.exists():
        raise RuntimeError("Download finished but no file was written; Vimeo may require a browser session for this video.")
    return path


def do_process(job: dict):
    jid, video = job["id"], job["video"]
    src = ensure_video(video, jid)
    OUTPUT.mkdir(parents=True, exist_ok=True)
    tag = video["externalId"] + (f"_w{job['params']['duration']}" if job["params"].get("duration") else "")
    out = OUTPUT / f"{tag}.json"
    cal = HERE / "calibration" / f"{video['externalId']}.json"
    cmd = [PY, str(HERE / "run.py"), "--video", str(src), "--out", str(out), "--fps", "5", "--per-team", str(job["perTeam"]), "--reid", "--tag", video["externalId"]]
    if job["params"].get("duration"):
        cmd += ["--duration", str(job["params"]["duration"])]
    if cal.exists():
        cmd += ["--calibration", str(cal)]
    say(jid, "Detection started")
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=str(ROOT))
    last = 0.0
    tail: list[str] = []
    for line in proc.stdout:  # type: ignore[union-attr]
        try:
            rec = json.loads(line)
        except Exception:
            if line.strip() and "Warning" not in line:
                tail = (tail + [line.strip()])[-6:]
            continue
        if time.time() - last > 60 or rec.get("stage") in ("PLAYER_TRACKING", "EVENT_DETECTION", "READY"):
            say(jid, f"{rec.get('stage')}: {rec.get('msg')}")
            last = time.time()
    if proc.wait() != 0:
        raise RuntimeError("run.py failed: " + " | ".join(tail[-3:]))
    say(jid, "Uploading results")
    det = out.with_suffix(".detections.json")
    if det.exists() and not job["params"].get("duration"):
        api("PUT", f"/api/worker/jobs/{jid}/detections", det.read_bytes(), timeout=600)
    res = api("POST", f"/api/worker/jobs/{jid}/result", out.read_bytes(), timeout=600)
    say(jid, f"Done: {res.get('events')} events, {res.get('players')} players")


def encoder() -> list[str]:
    enc = subprocess.run(["ffmpeg", "-hide_banner", "-encoders"], capture_output=True, text=True).stdout
    return ["-c:v", "h264_videotoolbox", "-b:v", "4M"] if "h264_videotoolbox" in enc else ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23"]


def do_render(job: dict):
    jid, video = job["id"], job["video"]
    src = ensure_video(video, jid)
    wm = Path(tempfile.gettempdir()) / "klipd_watermark.png"
    try:
        wm.write_bytes(urllib.request.urlopen(BASE + "/watermark.png", timeout=30).read())
    except Exception:
        wm = None
    enc = encoder()
    klips = job["klips"] or []
    say(jid, f"Rendering {len(klips)} KLIPs")
    with tempfile.TemporaryDirectory() as tmp:
        for i, k in enumerate(klips, 1):
            clip, thumb = Path(tmp) / f"{k['id']}.mp4", Path(tmp) / f"{k['id']}.jpg"
            dur = max(1.0, k["endTime"] - k["startTime"])
            flt = "[0:v]scale=-2:720[v];[1:v]scale=-1:72[wm];[v][wm]overlay=W-w-24:24" if wm else "[0:v]scale=-2:720"
            args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{k['startTime']:.2f}", "-i", str(src)] + (["-i", str(wm)] if wm else []) + ["-t", f"{dur:.2f}", "-filter_complex", flt, *enc, "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", str(clip)]
            subprocess.run(args, check=True)
            subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{k['thumbAt']:.2f}", "-i", str(src), "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", str(thumb)], check=True)
            api("PUT", f"/api/worker/klips/{k['id']}?kind=clip", clip.read_bytes(), "video/mp4", timeout=300)
            api("PUT", f"/api/worker/klips/{k['id']}?kind=thumb", thumb.read_bytes(), "image/jpeg", timeout=120)
            if i % 10 == 0 or i == len(klips):
                say(jid, f"{i}/{len(klips)} uploaded")


def main():
    if sys.version_info < (3, 10):
        sys.exit(f"Python 3.10+ is required (this is {platform.python_version()}). Recreate ai/.venv with a newer Python.")
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--poll", type=int, default=15)
    args = ap.parse_args()
    if not TOKEN:
        sys.exit("Set WORKER_TOKEN (same value as the server).")
    print(f"[worker] {WORKER_ID} polling {BASE}", flush=True)
    while True:
        try:
            job = api("GET", f"/api/worker/next?worker={WORKER_ID}").get("job")
        except urllib.error.HTTPError as e:
            print(f"[worker] server said {e.code}: {e.read().decode()[:120]}", flush=True)
            job = None
        except Exception as e:
            print(f"[worker] cannot reach server: {e}", flush=True)
            job = None
        if job:
            print(f"[worker] job {job['id']} {job['type']} match {job['matchId']}", flush=True)
            try:
                (do_process if job["type"] == "PROCESS" else do_render)(job)
                if job["type"] == "RENDER":
                    api("POST", f"/api/worker/jobs/{job['id']}/complete", b"{}")
            except Exception as e:  # report and carry on
                print(f"[worker] job failed: {e}", flush=True)
                try:
                    api("POST", f"/api/worker/jobs/{job['id']}/complete", json.dumps({"error": str(e)[:400]}).encode())
                except Exception:
                    pass
            if args.once:
                return
            continue
        if args.once:
            return
        time.sleep(args.poll)


if __name__ == "__main__":
    main()
