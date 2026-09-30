# Deploying KLIPD

Two pieces run in two places:

| Piece | Where | Why |
| --- | --- | --- |
| **Web app** (players, admin, trainer, sign-in, notifications) | Fly.io, one small machine with a volume | Cheap, always on, HTTPS |
| **Worker** (`ai/worker.py`: detection, re-identification, clip cutting) | Your Mac now, a GPU box later | Needs the footage and the compute |

The web app never needs a GPU or the video files. The worker polls the app for jobs and uploads
results, so it works from anywhere with internet.

## One-time setup (about 30 minutes)

### 1. Sign-in email (Resend, free tier)
1. Create an account at https://resend.com and add your domain (or use the sandbox sender, which only delivers to your own address, fine for testing).
2. Create an API key. Keep it for step 3.

### 2. Fly.io
```bash
brew install flyctl
fly auth signup            # or: fly auth login
cd ~/klipd
```
Edit `app = "klipd"` in `fly.toml` to a unique name, then:
```bash
fly launch --no-deploy --copy-config
fly volumes create klipd_data --size 3 --region lhr
```

### 3. Secrets
Generate values locally, then set them on Fly (they are never written to git):
```bash
openssl rand -base64 32                 # AUTH_SECRET
openssl rand -base64 24                 # WORKER_TOKEN
npm run vapid                           # VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY
```
```bash
fly secrets set \
  APP_URL=https://YOUR-APP.fly.dev \
  AUTH_SECRET=... \
  ADMIN_EMAILS=luke@dexify.io \
  RESEND_API_KEY=... \
  EMAIL_FROM="KLIPD <hello@yourdomain.com>" \
  WORKER_TOKEN=... \
  VAPID_PUBLIC_KEY=... \
  VAPID_PRIVATE_KEY=... \
  VAPID_SUBJECT=mailto:luke@dexify.io
```

### 4. Deploy
```bash
npm run check    # authorization, types and lint must pass
fly deploy
```
Open `https://YOUR-APP.fly.dev/login`, enter the email in `ADMIN_EMAILS`, and click the link you receive. That account is the admin.
The production database starts empty (venue, pitches and providers only); there is no demo data and demo login is off.

### 5. Start the worker on your Mac
```bash
cd ~/klipd
export KLIPD_URL=https://YOUR-APP.fly.dev
export WORKER_TOKEN=...      # same value as the server
ai/.venv/bin/python ai/worker.py
```
Leave it running (or use `--once` per job). It needs `ai/.venv` (see README) and `ffmpeg`.

## Backups and safety
- Fly snapshots the volume daily and keeps 5 days. For more, run `fly ssh sftp get /data/db.json` on a schedule.
- `db.json` contains player emails. Do not commit a production copy to GitHub.
- Rotate `WORKER_TOKEN` or `AUTH_SECRET` with `fly secrets set` (rotating `AUTH_SECRET` signs everyone out).

## Cost (rough)
Fly machine and 3 GB volume about 4 to 6 pounds a month, Resend free up to 3,000 emails, push free.
Compute is the worker: your Mac now, and see `docs/COMPUTE_ESTIMATE.md` for a GPU fleet.

## Known limits of this setup
- One web instance with a JSON file store on a volume. Fine for a pilot (tens of games a week). Move to Postgres (`supabase/migrations/0001_init.sql`) before scale.
- Footage is read by the worker from Vimeo or `ai/videos/`. Direct camera uploads need an upload endpoint and a storage bucket; the interfaces exist, the plumbing does not.
- Clips are stored on the volume and served by the app. Move to S3 or R2 (`src/lib/storage`) when volume grows.
