#!/bin/zsh
# Wait for run 1 to finish and video 2 to download, then run video 2.
cd "$(dirname "$0")"
until grep -q '"stage": "READY"' output/938101072.log 2>/dev/null || grep -q '"stage": "FAILED"' output/938101072.log 2>/dev/null; do sleep 20; done
until [ -f videos/932352844.mp4 ] && [ ! -f videos/932352844.mp4.part ]; do sleep 20; done
.venv/bin/python run.py --video videos/932352844.mp4 --out output/932352844.json --fps 5 --imgsz 1280 --per-team 5 --debug-frames 60 --tag 932352844 --calibration calibration/932352844.json > output/932352844.log 2>&1
tail -1 output/932352844.log
