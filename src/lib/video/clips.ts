/**
 * Renders KLIP files for a match from the local source footage and records their URLs.
 * Runs in the background; progress goes into the match's processing job log.
 */
import fs from "node:fs";
import path from "node:path";
import { getDb, mutate, newId, nowIso } from "../db/store";
import { eventVisibleToPlayers, type Video } from "../domain/types";
import { getStorage } from "../storage";
import { ffmpegAvailable, renderClipFile, renderThumbnail } from "./render";
import { klipFileOk } from "./files";
import { processingMode } from "../worker/jobs";

export function sourceFileFor(video: Video): string | null {
  const p = path.join(process.cwd(), "ai", "videos", `${video.externalId}.mp4`);
  return fs.existsSync(p) ? p : null;
}

export function clipRenderStatus(matchId: string) {
  const db = getDb();
  const match = db.matches.find((m) => m.id === matchId);
  const video = match?.videoId ? db.videos.find((v) => v.id === match.videoId) ?? null : null;
  const klips = db.klips.filter((k) => k.matchId === matchId && match && (() => { const e = db.events.find((x) => x.id === k.eventId); return e ? eventVisibleToPlayers(e, match) : false; })());
  return {
    total: klips.length,
    rendered: klips.filter((k) => klipFileOk(k)).length,
    sourceAvailable: !!(video && sourceFileFor(video)),
    ffmpeg: ffmpegAvailable(),
    viaWorker: processingMode() === "worker",
  };
}

const running = new Set<string>();
const rerun = new Set<string>();

export async function renderKlipsForMatch(matchId: string, opts: { onlyKlipIds?: string[]; concurrency?: number; log?: (msg: string) => void } = {}) {
  // Already busy: remember to look again when done, so clips added meanwhile are not missed.
  if (running.has(matchId)) { rerun.add(matchId); return 0; }
  running.add(matchId);
  try {
    const db = getDb();
    const match = db.matches.find((m) => m.id === matchId);
    const video = match?.videoId ? db.videos.find((v) => v.id === match.videoId) : null;
    if (!match || !video) throw new Error("Match has no video");
    const src = sourceFileFor(video);
    if (!src) throw new Error(`Source footage not on disk (ai/videos/${video.externalId}.mp4)`);
    if (!ffmpegAvailable()) throw new Error("ffmpeg is not installed on this machine");
    const storage = getStorage();
    const watermark = path.join(process.cwd(), "public", "watermark.png");
    // Only what players can see; hidden AI guesses are not worth rendering.
    const todo = db.klips.filter((k) => {
      if (k.matchId !== matchId || klipFileOk(k)) return false;
      if (opts.onlyKlipIds && !opts.onlyKlipIds.includes(k.id)) return false;
      const e = db.events.find((x) => x.id === k.eventId);
      return e ? eventVisibleToPlayers(e, match) : false;
    });
    opts.log?.(`Rendering ${todo.length} KLIP files`);
    let done = 0;
    const worker = async () => {
      while (todo.length) {
        const k = todo.shift()!;
        const clipKey = `klips/${k.id}.mp4`;
        const thumbKey = `klips/${k.id}.jpg`;
        const clipPath = storage.localPathFor ? storage.localPathFor(clipKey) : path.join(process.cwd(), "tmp", clipKey);
        const thumbPath = storage.localPathFor ? storage.localPathFor(thumbKey) : path.join(process.cwd(), "tmp", thumbKey);
        try {
          await renderClipFile({ sourcePath: src, startTime: k.startTime, endTime: k.endTime, outPath: clipPath, watermarkPath: watermark });
          const ev = getDb().events.find((e) => e.id === k.eventId);
          await renderThumbnail(src, ev ? ev.timestamp : k.startTime + 3, thumbPath);
          const clipUrl = await storage.putFile(clipPath, clipKey);
          const thumbnailUrl = await storage.putFile(thumbPath, thumbKey);
          mutate((d) => {
            const kk = d.klips.find((x) => x.id === k.id);
            if (kk) Object.assign(kk, { status: "RENDERED", clipUrl, thumbnailUrl });
          });
          done++;
          if (done % 10 === 0) opts.log?.(`${done} KLIP files rendered`);
        } catch (err) {
          opts.log?.(`KLIP ${k.id} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };
    await Promise.all(Array.from({ length: opts.concurrency ?? 2 }, worker));
    opts.log?.(`Clip rendering finished: ${done} files`);
    return done;
  } finally {
    running.delete(matchId);
    if (rerun.delete(matchId)) void renderKlipsForMatch(matchId, { log: opts.log }).catch(() => {});
  }
}

/** Fire and forget: make sure every clip players can see has an MP4 (rendered here, or queued for a worker). */
export function ensureClips(matchId: string): void {
  void import("../worker/jobs").then((m) => m.renderOrQueue(matchId)).catch(() => {});
}

/** Run at server start: catch up on any visible clip that has no file yet. */
export async function sweepRenders(): Promise<void> {
  const { renderOrQueue } = await import("../worker/jobs");
  for (const m of getDb().matches) {
    const st = clipRenderStatus(m.id);
    if (st.total > st.rendered) await renderOrQueue(m.id).catch(() => {});
  }
}

/** Append a line to the latest processing job for the match (creates one if none is open). */
export function logToMatch(matchId: string, msg: string) {
  mutate((db) => {
    let job = [...db.processingJobs].reverse().find((j) => j.matchId === matchId && j.stage === "GENERATING_KLIPS");
    if (!job) {
      job = { id: newId("job"), matchId, stage: "GENERATING_KLIPS", engine: "REAL", startedAt: nowIso(), completedAt: nowIso(), log: [] };
      db.processingJobs.push(job);
    }
    job.log = [...job.log.slice(-40), msg];
  });
}
