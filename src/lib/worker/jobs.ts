/**
 * Work queue for external processing workers (ai/worker.py on a Mac or GPU box).
 *
 * PROCESSING_MODE=local  the web server runs detection and ffmpeg itself (single machine, dev).
 * PROCESSING_MODE=worker the web server only queues jobs; a worker with the footage does the heavy work.
 * Default: local when the Python environment exists on this machine, otherwise worker.
 */
import { getDb, mutate, newId, nowIso } from "../db/store";
import { eventVisibleToPlayers, type Match, type WorkerJob } from "../domain/types";
import { localCvAvailable } from "../ai/local";
import { klipFileOk } from "../video/files";

export function processingMode(): "local" | "worker" {
  const m = process.env.PROCESSING_MODE;
  if (m === "local" || m === "worker") return m;
  return localCvAvailable() ? "local" : "worker";
}

const STALE_MS = 45 * 60_000;

export function enqueueProcess(matchId: string, params: { duration?: number } = {}): WorkerJob {
  return mutate((db) => {
    db.workerJobs ??= [];
    for (const j of db.workerJobs) if (j.matchId === matchId && j.type === "PROCESS" && (j.status === "QUEUED" || j.status === "RUNNING")) { j.status = "FAILED"; j.error = "Superseded by a newer request"; j.finishedAt = nowIso(); }
    const job: WorkerJob = { id: newId("wjob"), type: "PROCESS", matchId, status: "QUEUED", createdAt: nowIso(), params };
    db.workerJobs.push(job);
    const m = db.matches.find((x) => x.id === matchId);
    if (m && !m.publishedAt) m.status = "UPLOADED";
    return job;
  });
}

/** Queue a render job for every player-visible KLIP without a file. Returns null when there is nothing to render. */
export function enqueueRender(matchId: string): WorkerJob | null {
  return mutate((db) => {
    db.workerJobs ??= [];
    const match = db.matches.find((m) => m.id === matchId);
    if (!match) return null;
    const need = db.klips
      .filter((k) => k.matchId === matchId && !klipFileOk(k))
      .filter((k) => { const e = db.events.find((x) => x.id === k.eventId); return e ? eventVisibleToPlayers(e, match) : false; })
      .map((k) => k.id);
    if (!need.length) return null;
    const open = db.workerJobs.find((j) => j.matchId === matchId && j.type === "RENDER" && j.status === "QUEUED");
    if (open) { open.klipIds = need; return open; }
    const job: WorkerJob = { id: newId("wjob"), type: "RENDER", matchId, status: "QUEUED", createdAt: nowIso(), klipIds: need };
    db.workerJobs.push(job);
    return job;
  });
}

export function claimNext(workerId: string): WorkerJob | null {
  return mutate((db) => {
    const now = Date.now();
    const job =
      (db.workerJobs ?? []).find((j) => j.status === "QUEUED") ??
      (db.workerJobs ?? []).find((j) => j.status === "RUNNING" && j.claimedAt && now - Date.parse(j.claimedAt) > STALE_MS);
    if (!job) return null;
    Object.assign(job, { status: "RUNNING", claimedAt: nowIso(), workerId });
    if (job.type === "PROCESS") {
      const m = db.matches.find((x) => x.id === job.matchId);
      if (m && !m.publishedAt) m.status = "PROCESSING";
    }
    return { ...job };
  });
}

export function jobPayload(job: WorkerJob) {
  const db = getDb();
  const match = db.matches.find((m) => m.id === job.matchId) as Match | undefined;
  const video = match?.videoId ? db.videos.find((v) => v.id === match.videoId) : null;
  if (!match || !video) return null;
  const perTeam = match.format === "7v7" ? 7 : match.format === "6v6" ? 6 : 5;
  return {
    id: job.id,
    type: job.type,
    matchId: match.id,
    perTeam,
    params: job.params ?? {},
    video: { provider: video.provider, externalId: video.externalId, sourceUrl: video.sourceUrl, durationSeconds: video.durationSeconds },
    klips: job.type === "RENDER"
      ? db.klips.filter((k) => job.klipIds?.includes(k.id)).map((k) => ({ id: k.id, startTime: k.startTime, endTime: k.endTime, thumbAt: db.events.find((e) => e.id === k.eventId)?.timestamp ?? k.startTime + 3 }))
      : undefined,
  };
}

export function finishJob(id: string, error?: string) {
  mutate((db) => {
    const j = (db.workerJobs ?? []).find((x) => x.id === id);
    if (!j) return;
    j.status = error ? "FAILED" : "DONE";
    j.error = error ?? null;
    j.finishedAt = nowIso();
    if (error && j.type === "PROCESS") {
      const m = db.matches.find((x) => x.id === j.matchId);
      if (m && !m.publishedAt) m.status = "FAILED";
    }
  });
}

/** Render locally when possible, otherwise queue for a worker. */
export async function renderOrQueue(matchId: string): Promise<"local" | "queued" | "nothing"> {
  const { sourceFileFor, renderKlipsForMatch, logToMatch } = await import("../video/clips");
  const { ffmpegAvailable } = await import("../video/render");
  const video = getDb().videos.find((v) => v.matchId === matchId);
  if (processingMode() === "local" && video && sourceFileFor(video) && ffmpegAvailable()) {
    void renderKlipsForMatch(matchId, { log: (m) => logToMatch(matchId, m) }).catch(() => {});
    return "local";
  }
  return enqueueRender(matchId) ? "queued" : "nothing";
}
