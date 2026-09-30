# KLIPD

Your game. Your moments.

KLIPD automatically turns full 5 a side match footage into individual player highlights.
This repo is the MVP: the complete post-match product experience, a real data model,
mock AI behind clearly-labelled seams, and an admin editor for labelling matches by hand.

## Run it

```bash
cd ~/klipd
npm install
npm run dev -- --port 3010
```

Then, once only, the Python environment for the CV pipeline (it is not portable, so it is
recreated rather than copied):

```bash
python3.13 -m venv --system-site-packages ai/.venv && ai/.venv/bin/pip install ultralytics opencv-python-headless numpy yt-dlp
```

Open http://localhost:3000. Sign in as **Luke Trotman** from the demo list on `/login`
(Luke is the admin). The database is a JSON file at `data/db.json`, created from the seed
on first run. Delete it, or press "Reset to seed data" in `/admin`, to start over.

Requires Node 18.18+ (pinned to Next.js 15 for that reason).

## Real computer vision (local)

`ai/run.py` is a real detection pipeline that runs on this machine: YOLO11 (COCO
weights) for people and the ball, ByteTrack for tracking, a green-pitch mask to drop
spectators, kit-colour clustering into two teams, track merging into "Player 01…",
ball possession, and rule-based events (shots, goal candidates, saves, assists, key
passes, dribbles, tackles, interceptions) with confidences.

```bash
python3.13 -m venv --system-site-packages ai/.venv     # Python 3.10 or newer; torch with MPS on Apple Silicon
ai/.venv/bin/pip install ultralytics opencv-python-headless numpy yt-dlp
```

Then in `/admin/matches/[id]` press **Run REAL pipeline (local CV)**. The footage is
downloaded from Vimeo on first use (`ai/videos/<id>.mp4`), output goes to `ai/output/`,
and annotated frames for each detected event go to `ai/debug/` so you can eyeball them.
Or from the shell:

```bash
ai/.venv/bin/python ai/run.py --video ai/videos/938101072.mp4 --out ai/output/938101072.json --duration 180 --debug-frames 40
```

Speed on an M1 Pro: 3.5–4.5 analysed fps end to end, so a 40-minute match at 5 analysed
fps takes 45–55 minutes. Detections are cached (`ai/output/<id>.detections.json`), so rule
changes re-run in about a minute with `--reuse` (add `--recolour` if the kit-colour sampling
changed). Per-camera goal mouths live in `ai/calibration/<id>.json`.

Results on the two test matches (September 2026), unlabelled so precision is unknown:

| | Tuesday (real 12–9) | Thursday (real 8–10) |
| --- | --- | --- |
| Frames analysed | 11,785 | 12,471 |
| Ball found | 60% | 76% |
| Tracked identities (10 real players) | 19 | 16 |
| Shots | 41 | 44 |
| Goals found (by team) | 13 (5 + 8) | 22 (9 + 13) |

Two goal rules run: ball into a calibrated goal mouth after a shot, and the restart from the
centre spot that follows every goal in small sided football. Identity is the weak point: the
tracker splits each player into roughly two identities per match, so a player claims each one
("That's me"). Appearance re-identification is the next model to add. Accuracy is unmeasured
until games are labelled in the editor; `ai/evaluate.py` scores AI events against those labels.

## Going live

`docs/DEPLOY.md` (Fly.io + Resend + worker) and `docs/PILOT.md` (running a game). Product controls in
place: publish gate (players only see approved moments), signed sessions with emailed one-time links,
web push, installable app (PWA), watermarked MP4 clips, and a worker API so the hosted app never needs
a GPU. `.env.example` lists every setting.

## Training interface

`/admin/label/[matchId]` (or **Train** from the admin match list) is a hazard-perception style
labeller. Watch at 1–2×, press **Space** when something happens, click the player on the
frame, press **1–8** for what it was, and playback resumes. The first time you tap an
unidentified tracked player it asks "Who is this?" and one tap links that identity for the
whole game. **Review AI calls** steps through every detection: **y** correct, **n** wrong,
**p** wrong player then click the right one. Every answer is stored as ground truth
(MANUAL events with `metadata.labeller`, AI events with `metadata.review`, identity links),
survives pipeline re-runs (labels are re-attached by tracker fragment id), and feeds:

```bash
python3 ai/evaluate.py --match match_thu5s          # precision from reviews, recall from labels
ai/.venv/bin/python ai/export_labels.py --match match_thu5s --crops   # training data + player crops
```

## Player identity (re-identification)

`ai/reid.py` embeds every tracked fragment with DINOv2 (ViT-S/14, ~360 crops/s on an M1 Pro),
mean-centres per team so bibs and grass cancel out, and clusters fragments into identities with
a physical constraint: two tracks seen at the same moment in different places are different
people. The similarity threshold self-calibrates from those known-different pairs. Result on the
test matches: 15–17 identities for 10–12 people, down from 19–21 without it. The remaining
splits need a re-id model fine-tuned on the identity labels the training interface produces.

## What is real and what is mocked

| Real product logic | Mock |
| --- | --- |
| Data model, matches, rosters, events, KLIPs, identity links, likes, shares, views, notifications | `src/lib/ai/mock.ts`: placeholder engine kept for UI testing; every record it produces is tagged `MOCK` |
| `ai/run.py` + `src/lib/ai/local.ts`: real detection, tracking and rule-based events (source `AI`) | Player identity: v0 has no face/appearance matching; players self-claim with "That's me" |
| Virtual clip playback from source video by in/out points (`VideoProvider`) | Rendered clip files (download) - a Mux/ffmpeg provider will produce them |
| Processing pipeline state machine and job log (`src/lib/ai/pipeline.ts`) | The stage timing is a fixed delay |
| Public share links `/klip/{id}` | |
| Admin event editor with Vimeo scrubbing | |
| Sign-in and profile flow | Cookie session stands in for Supabase Auth |

Seed events on the Tuesday and Thursday matches are hand-written demo labels (tagged
DEMO LABEL in the UI, `metadata.demo = true`), not verified against the footage. They keep
the product demo populated; `ai/evaluate.py` ignores them. Real ground truth is whatever you
label yourself in the editor.

## Pages

`/` landing · `/login` · `/onboarding` · `/home` · `/matches` · `/matches/[id]`
(`?player=` gives the per-player post-match feed, `?tab=` switches highlights / players /
goals / all) · `/players/[id]` · `/profile` · `/klips/[id]` · `/klip/[id]` (public share) ·
`/venues/[id]` · `/admin` · `/admin/matches` · `/admin/matches/new` · `/admin/matches/[id]`

## Architecture

```
src/lib/domain/types.ts        entities (mirrors supabase/migrations/0001_init.sql)
src/lib/db/store.ts            JSON file store; swap for Postgres without touching queries
src/lib/db/queries.ts          read model used by pages
src/lib/db/seed.ts             three Vimeo test matches, Powerleague Battersea, Footy Addicts
src/lib/video/                 VideoProvider interface + Vimeo implementation
src/lib/ai/services.ts         PlayerDetection / Tracking / Identification / EventDetection / ClipGeneration contracts
src/lib/ai/mock.ts             MOCK engine
src/lib/ai/pipeline.ts         status machine: UPLOADED → … → READY, notifications
src/lib/integrations/          BookingProvider / MatchProvider / PlayerRosterProvider (Manual, Footy Addicts stub)
src/lib/auth/                  session + admin gate
src/app/actions/               server actions (auth, klips, identity, admin)
src/components/                KlipPlayer (Vimeo virtual clips), KlipFeed (swipe), KlipCard, admin/EventEditor
docs/COMPUTE_ESTIMATE.md       compute, time and cost to process every game across 500 pitches
```

Test footage (treated as real KLIPD matches):
https://vimeo.com/938101072 · https://vimeo.com/932352844 · https://vimeo.com/912465212

## Moving to Supabase

1. `supabase/migrations/0001_init.sql` creates every table with RLS.
2. Replace `src/lib/db/store.ts` reads/writes with a Postgres repository behind the same
   function names used in `queries.ts` and the server actions.
3. Replace `getSessionUserId()` in `src/lib/auth/session.ts` with `supabase.auth.getUser()`.
