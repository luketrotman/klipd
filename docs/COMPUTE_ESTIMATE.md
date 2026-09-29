# KLIPD: compute, time and cost to process every game

Scope: 500 permanently installed pitch cameras across London, every game automatically
turned into per-player KLIPs and stats. Figures are planning estimates from public GPU
benchmarks and current cloud list prices (September 2026), not measurements on KLIPD
footage. Treat them as ±40% until the pipeline is run on the three test videos.

## 1. Volume assumptions

| Assumption | Value | Notes |
| --- | --- | --- |
| Pitches | 500 | London, permanent fixed camera per pitch |
| Games per pitch per day | 4 (range 3–6) | Weekday evenings 17:00–22:00 in hour slots plus weekend daytime |
| Games per day | 2,000 (1,500–3,000) | 14,000 per week, ~730,000 per year |
| Footage per game | 50 min (40–60) | 60 minute slot, whistle to whistle |
| Footage per day | ~1,670 hours | |
| Camera output | 1080p at 25–30 fps, H.265 at 6 Mbps | ~2.25 GB per game (H.264 at 8 Mbps ≈ 3 GB) |
| Peak concurrency | ~450 games at once | Weekday 19:00–21:00, ~90% pitch utilisation |
| Players per game | 10–14 | KLIPs per game: ~80–120 across all players |

## 2. What the pipeline has to do

Per 50-minute game at 1080p, on one NVIDIA L4 (the cheapest sensible cloud inference GPU):

| Stage | Work | Rate on L4 | GPU minutes |
| --- | --- | --- | --- |
| Decode | 90k frames, NVDEC | ~1,500 fps | 1 |
| Player detection | YOLO-m class model, 1280 px input, analysed at 15 fps (45k frames) | ~65 fps | 12 |
| Ball detection | Small-object model. Full-frame search at 30 fps is ~55 min; tracked region-of-interest with periodic full-frame search brings it down | ~200 fps ROI | 8–25 |
| Tracking, team assignment | ByteTrack/BoT-SORT plus kit colour clustering; CPU, runs alongside | 2 vCPU | 0 (CPU 3 min) |
| Re-identification | Appearance embeddings on track breaks (~5% of detections) | | 1–2 |
| Pose estimation (optional) | Only on candidate windows (~15% of frames), for skills, shots, tackles | | 3–5 |
| Event classification | Temporal model over ~150 candidate windows of 6 s | | 1–2 |
| Clip rendering | ~100 clips × 15 s. NVENC re-encode with overlays, or stream-copy at keyframes if the camera uses a 1 s GOP | ~6× realtime | 0–4 |
| **Total** | | | **~30–50 GPU minutes per game** |

That is roughly 0.6–1.0× realtime on an L4. Other hardware, relative to L4:

| Hardware | Relative speed | Comment |
| --- | --- | --- |
| T4 | ~0.4× | ~100 GPU minutes per game, cheapest per hour but worst per game |
| A10G | ~1.3× | |
| A100 40GB | ~3× | Better per game only when batching many streams |
| CPU only, 8 vCPU | ~0.05× | ~5–8 hours per game for detection alone; no path to near-live. Not viable |
| Jetson Orin NX 16GB (edge, INT8) | ~0.5–0.7× | Enough for one pitch in realtime with a lighter ball model |
| Jetson Orin AGX 64GB (edge) | ~1.2–1.5× | One box per 2–4 pitches at a venue |

The bottleneck is the GPU, not the CPU. CPU is needed for decode orchestration, tracking,
API and clip muxing at roughly 2–4 vCPU per concurrent game.

**Measured on an M1 Pro laptop (September 2026, `ai/run.py`):** YOLO11m at 1280 px runs at
11 fps in isolation; the full pass (decode, tracking, ball region search, tiled sweep when the
ball is lost) runs at 3.3 to 6.6 analysed frames per second, so a 40-minute match sampled at
5 fps takes 30 to 60 minutes. An L4 is roughly 3 to 4 times faster than this laptop for the
detector, which is consistent with the table above.

## 3. Cost per game (cloud)

L4 on-demand: AWS g6.xlarge $0.80/h (US) to $0.93/h (London); GCP g2-standard-4 ~$0.71/h.
Spot or committed use: 30–45% of on-demand.

| Line | On-demand | Optimised (spot/committed, R2 or Cloudflare Stream) |
| --- | --- | --- |
| GPU, 0.5–0.8 h | $0.45–0.70 | $0.15–0.30 |
| CPU workers, API, database | $0.05 | $0.03 |
| Storage: raw match, 30-day retention | $0.05 | $0.03 (14-day retention) |
| Storage: clips (~0.8 GB per game, kept) | $0.02 per month, accumulating | $0.012 per month |
| Delivery: ~3 GB of clip views per game | $0.25 (CloudFront) | $0.05–0.10 |
| **Total per game** | **$0.85–1.10** | **$0.30–0.55** |
| Per player-game (10 players) | ~$0.10 | ~$0.04 |

Monthly at 2,000 games per day (60,000 games per month):

| | On-demand | Optimised |
| --- | --- | --- |
| GPU | $35–40k | $12–18k |
| CPU, API, database | $3–5k | $2–3k |
| Storage (month 1, grows ~1.5 TB per day of clips) | $3–5k | $2–3k |
| Delivery | $10–15k | $3–6k |
| **Total** | **$50–65k per month** | **$20–30k per month** |

Clip storage compounds: after one year the clip library is ~550 TB, which is ~$8–13k per
month on its own unless older clips move to cold storage or are re-encoded smaller.

## 4. Fleet sizing and latency

**Batch (KLIPs by the next morning).** 2,000 games × 0.75 GPU hours = 1,500 GPU hours per
day, so ~65 L4s running around the clock, ~100 with headroom. Latency: 45–90 minutes after
the final whistle when a GPU is free, several hours behind on a busy evening.

**Near-live (KLIPs within 5–10 minutes of the final whistle).** The footage must be analysed
while the game is being played, so GPU count follows concurrency, not daily volume:

| Pipeline | Streams per L4 | L4s at peak (450 games) | Peak hourly cost (on-demand, London) |
| --- | --- | --- | --- |
| Full pipeline | ~1 | ~450 | ~$420/h |
| Optimised (ROI ball tracking, 12 fps player detection, no pose) | ~2 | ~225 | ~$210/h |

Peak lasts ~5 hours on weekdays and is spread across weekend days. Total GPU hours are the
same as batch; the difference is that 200–450 L4s must be obtainable in one region at 19:00
every evening. That means reserved or committed capacity, or the edge option below.

After the whistle, the remaining work is event classification, clip rendering and
notification: 2–5 minutes. That is what makes "8:08 PM: your KLIPs are ready" achievable.

## 5. Edge processing (recommended for 500 permanent cameras)

Put the detector on the camera side and only send tracks plus a low-bitrate proxy or the
finished clips to the cloud.

| Option | Hardware | Unit cost installed | Fleet capex | Covers |
| --- | --- | --- | --- | --- |
| Per pitch | Jetson Orin NX 16GB in a rugged PoE box | £1,200–1,800 | £600–900k | 1 pitch, realtime, lighter ball model |
| Per venue | Jetson Orin AGX 64GB | £2,500–3,500 | £375–525k for ~150 boxes | 2–4 pitches with the full pipeline |
| Per venue, x86 | Small server with one L4 or RTX 4000 Ada | £4,000–6,000 | £400–600k for ~100 boxes | 4–6 pitches, easiest to develop for |

Residual cloud cost with edge detection: clip rendering, event classification, storage and
delivery ≈ $0.15–0.30 per game, i.e. $9–18k per month at 2,000 games per day. Payback against
cloud-only is roughly 12–24 months, and the edge route also removes two other problems:

- **Upload bandwidth.** Cloud-only needs 6 Mbps upstream per pitch during play (36 Mbps for a
  six-pitch venue, sustained all evening) or a 2.25 GB upload per game afterwards. Edge sends
  ~0.8 GB of clips per game with no timing constraint.
- **Latency.** Detection is finished when the whistle goes.

Sensible path: cloud GPUs for the first 20–50 pitches while the models are changing weekly,
then move detection to the edge once the model is stable, keeping the cloud for everything
after tracking. The pipeline in this repo is split at exactly that seam (PlayerDetection and
PlayerTracking services versus EventDetection and ClipGeneration).

## 6. The cost that dwarfs compute: human review

Until accuracy is proven, a person needs to check output. At 5 minutes of review per game:

| | Per game | Per month at 60,000 games |
| --- | --- | --- |
| Reviewer time at £12/h | £1.00 | £60k |
| Compute (optimised cloud) | £0.25–0.45 | £16–24k |

Review has to be sampled, not universal: check low-confidence events only, plus a few percent
of games for drift. The admin event editor in this repo is the tool for that, and every
correction becomes training data.

## 7. Accuracy you should expect, and when

Wide-angle single-camera 5-a-side is a hard setting: ten players in close proximity, similar
bibs, a small fast ball, indoor lighting and netting. Honest first-year targets:

| Output | Realistic accuracy | Main failure mode |
| --- | --- | --- |
| Player detection | >95% per frame | Occlusion at the goal mouth |
| Tracking (who is who across the game) | 5–20 identity switches per player per game before re-ID; 1–3 after | Similar bibs, players crossing |
| Goals | 90–95% precision and recall | Needs a goal-mouth region and ball tracking; a second camera per goal end makes this near-certain |
| Shots | 80–90% | Blocked shots versus passes |
| Assists | 75–85% | Possession attribution before the goal |
| Tackles, interceptions, blocks | 70–80% | Ambiguous contact |
| Skills, nutmegs, dribbles | 50–70% initially | Needs pose-based action recognition and labelled examples |
| Stats (goals, assists per player) | Follows the above; usable after human confirmation, not before | |

Suggested plan to find out with the three test videos:

1. **Now, 2–3 weeks part-time.** Label 30–50 games in the admin editor (every goal, shot,
   assist, and a sample of skills and tackles). This is the ground truth; nothing else can be
   measured without it.
2. **Weeks 1–8.** Player and ball detection plus tracking on the test videos. Measure
   tracking (HOTA/IDF1) and goal detection precision/recall against the labels.
3. **Weeks 8–20.** Shots, saves, assists, tackles; "that's me" identity plus appearance re-ID
   across a game; near-live pipeline on 5–10 pitches.
4. **After.** Skills and nutmegs, stats you would publish without review, edge deployment.

## 8. Camera specification (so the compute above holds)

- 1080p at 25–30 fps minimum. 4K at 25 fps helps the ball at the far end but quadruples
  detection cost unless processed at 1080p with tiled full-resolution ball search.
- Mounted at the halfway line, 4–6 m high, 100–110° horizontal field of view; or two cameras,
  one behind each goal, which makes goal detection trivial and doubles ingest.
- H.265 at 4–8 Mbps, 1-second GOP so clips cut cleanly without re-encoding, NTP-synced
  timestamps so booking slots map to footage, PoE, and a 24–48 hour local ring buffer so a
  dropped connection never loses a game.
