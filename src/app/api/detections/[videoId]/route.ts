import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";

/**
 * Detected boxes at a moment of a video, for the labelling overlay.
 * GET /api/detections/<videoId>?t=123.4  →  { t, width, height, players: [...], ball }
 * Reads the cached detection pass (ai/output/<externalId>.detections.json) and the identity
 * mapping (ai/output/<externalId>.json). Admin only.
 */
interface CachedFrame { t: number; p: number[][]; b: number[] | null }
interface Cache { frames: CachedFrame[]; size: [number, number]; labelOfTrack: Map<number, string>; teamOfLabel: Map<string, number>; mtime: number }

const g = globalThis as unknown as { __klipdDet?: Map<string, Cache> };
if (!g.__klipdDet) g.__klipdDet = new Map();

function load(externalId: string): Cache | null {
  const detPath = path.join(process.cwd(), "ai", "output", `${externalId}.detections.json`);
  const outPath = path.join(process.cwd(), "ai", "output", `${externalId}.json`);
  if (!fs.existsSync(detPath)) return null;
  const mtime = fs.statSync(detPath).mtimeMs + (fs.existsSync(outPath) ? fs.statSync(outPath).mtimeMs : 0);
  const hit = g.__klipdDet!.get(externalId);
  if (hit && hit.mtime === mtime) return hit;
  const det = JSON.parse(fs.readFileSync(detPath, "utf8")) as { frames: CachedFrame[]; size: [number, number] };
  const labelOfTrack = new Map<number, string>();
  const teamOfLabel = new Map<string, number>();
  if (fs.existsSync(outPath)) {
    const out = JSON.parse(fs.readFileSync(outPath, "utf8")) as { tracked: Array<{ label: string; team: number; trackIds?: number[] }> };
    for (const t of out.tracked) {
      teamOfLabel.set(t.label, t.team);
      for (const id of t.trackIds ?? []) labelOfTrack.set(id, t.label);
    }
  }
  const cache = { frames: det.frames, size: det.size, labelOfTrack, teamOfLabel, mtime };
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
  const players = f.p.map(([trackId, x1, y1, x2, y2, conf]) => {
    const label = cache.labelOfTrack.get(trackId) ?? null;
    const tp = label ? tracked.find((x) => x.label === label) ?? null : null;
    const link = tp ? links.find((l) => l.trackedPlayerId === tp.id) : null;
    const profile = link ? db.playerProfiles.find((p) => p.id === link.playerId) : null;
    return { trackId, label, trackedPlayerId: tp?.id ?? null, team: label ? cache.teamOfLabel.get(label) ?? null : null, x1, y1, x2, y2, conf, linkedName: profile?.displayName ?? null, linkedPlayerId: profile?.id ?? null };
  });
  return NextResponse.json({ t: f.t, width: cache.size[0], height: cache.size[1], players, ball: f.b, available: true });
}
