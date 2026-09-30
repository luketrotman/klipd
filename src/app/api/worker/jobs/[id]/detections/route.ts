import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { rejectUnlessWorker } from "@/lib/worker/auth";
import { DATA_DIR, getDb } from "@/lib/db/store";

/** Stores the cached detection frames so the labeller overlay works on a hosted server. Full-match runs only. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = rejectUnlessWorker(req);
  if (denied) return denied;
  const { id } = await params;
  const db = getDb();
  const job = (db.workerJobs ?? []).find((j) => j.id === id);
  if (!job || job.type !== "PROCESS") return new NextResponse("No such PROCESS job", { status: 404 });
  if (job.params?.duration) return NextResponse.json({ ok: true, skipped: "partial run" });
  const match = db.matches.find((m) => m.id === job.matchId);
  const video = match?.videoId ? db.videos.find((v) => v.id === match.videoId) : null;
  if (!video) return new NextResponse("No video", { status: 404 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length || buf.length > 200 * 1024 * 1024) return new NextResponse("Bad size", { status: 413 });
  try { JSON.parse(buf.toString("utf8").slice(0, 2)); } catch { return new NextResponse("Not JSON", { status: 400 }); }
  const dir = path.join(DATA_DIR, "detections");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${video.externalId}.json`), buf);
  return NextResponse.json({ ok: true, bytes: buf.length });
}
