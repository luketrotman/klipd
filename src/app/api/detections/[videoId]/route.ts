import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/session";
import { DATA_DIR, getDb } from "@/lib/db/store";

/**
 * Detected boxes at a moment of a video, for the labelling overlay.
 * GET /api/detections/<videoId>?t=123.4  →  { t, width, height, players: [...], ball }
 * Frames come from the worker's detection cache (DATA_DIR/detections/<id>.json, or ai/output locally);
 * identities come from the database (tracked players and their tracker fragment ids). Admin only.
 */
interface CachedFrame { t: number; p: number[][]; b: number[] | null }
interface Cache { frames: CachedFrame[]; size: [number, number]; mtime: number }

const g = globalThis as unknown as { __klipdDet?: Map<string, Cache> };
if (!g.__klipdDet) g.__klipdDet = new Map();

function detectionFile(externalId: string): string | null {
  const a = path.join(DATA_DIR, "detections", `${externalId}.json`);
  if (fs.existsSync(a)) return a;
  const b = path.join(process.cwd(), "ai", "output", `${externalId}.detections.json`);
  return fs.existsSync(b) ? b : null;
}

function load(externalId: string): Cache | null {
  const file = detectionFile(externalId);
  if (!file) return null;
  const mtime = fs.statSync(file).mtimeMs;
  const hit = g.__klipdDet!.get(externalId);
  if (hit && hit.mtime === mtime) return hit;
  const det = JSON.parse(fs.readFileSync(file, "utf8")) as { frames: CachedFrame[]; size: [number, number] };
  const cache = { frames: det.frames, size: det.size, mtime };
  g.__klipdDet!.set(externalId, cache);
  return cache;
}

export async function GET(req: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const viewer = await getViewer();
  if (!viewer?.user.isAdmin) return new NextResponse("Forbidden", { status: 403 });
  const { videoId } = await params;
  const t = Number(new URL(req.url).searchParams.get("t") ?? "0");
  const db = getDb();
  const video = db.videos.find((v) => v.id === videoId);
  if (!video) return new NextResponse("No video", { status: 404 });
  const cache = load(video.externalId);
  if (!cache) return NextResponse.json({ t, width: video.width ?? 1920, height: video.height ?? 1080, players: [], ball: null, available: false });

  // nearest cached frame (binary search)
  const fr = cache.frames;
  let lo = 0, hi = fr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (fr[mid].t < t) lo = mid + 1; else hi = mid;
  }
  const cand = [fr[lo], fr[lo - 1]].filter(Boolean);
  const f = cand.sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
  const tracked = db.trackedPlayers.filter((x) => x.matchId === video.matchId);
  const links = db.playerLinks;
  const trackToTracked = new Map<number, (typeof tracked)[number]>();
  for (const tp of tracked) for (const id of tp.trackIds ?? []) trackToTracked.set(id, tp);
  const players = f.p.map(([trackId, x1, y1, x2, y2, conf]) => {
    const tp = trackToTracked.get(trackId) ?? null;
    const label = tp?.label ?? null;
    const link = tp ? links.find((l) => l.trackedPlayerId === tp.id) : null;
    const profile = link ? db.playerProfiles.find((p) => p.id === link.playerId) : null;
    return { trackId, label, trackedPlayerId: tp?.id ?? null, team: tp ? (tp.team === "HOME" ? 0 : tp.team === "AWAY" ? 1 : null) : null, x1, y1, x2, y2, conf, linkedName: profile?.displayName ?? null, linkedPlayerId: profile?.id ?? null };
  });
  return NextResponse.json({ t: f.t, width: cache.size[0], height: cache.size[1], players, ball: f.b, available: true });
}
