/**
 * Match processing pipeline.
 *
 * Drives a match through the MatchStatus stages, writing processing_jobs so the
 * UI can show progress. The AI engine is injected; the MVP only has the MOCK
 * engine. The real product logic here (status transitions, persisting tracked
 * players, events and klips, notifying players) is what a real engine will
 * plug into unchanged.
 */
import { mutate, getDb, newId, nowIso } from "../db/store";
import type { MatchStatus, PlayerLink, Team } from "../domain/types";
import { providerFor } from "../video";
import type { AiEngine } from "./services";
import { createMockEngine } from "./mock";
import { renderKlipsForMatch, sourceFileFor } from "../video/clips";

const STAGES: MatchStatus[] = ["UPLOADED", "PROCESSING", "PLAYER_DETECTION", "PLAYER_TRACKING", "EVENT_DETECTION", "GENERATING_KLIPS"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function setStage(matchId: string, stage: MatchStatus, engine: AiEngine["name"], log: string[] = []) {
  mutate((db) => {
    const m = db.matches.find((x) => x.id === matchId);
    // A published match keeps its READY status while it is re-analysed, so players never lose sight of it.
    if (m && !(m.publishedAt && stage !== "READY")) m.status = stage;
    const open = db.processingJobs.find((j) => j.matchId === matchId && !j.completedAt);
    if (open) open.completedAt = nowIso();
    if (STAGES.includes(stage)) {
      db.processingJobs.push({ id: newId("job"), matchId, stage, engine, startedAt: nowIso(), completedAt: null, log: [`${stage} started (${engine} engine)`, ...log] });
    }
  });
}

export function appendJobLog(matchId: string, msg: string) {
  mutate((db) => {
    const open = [...db.processingJobs].reverse().find((j) => j.matchId === matchId && !j.completedAt);
    if (open) open.log = [...open.log.slice(-40), msg];
  });
}

interface HumanIdentity { playerId: string; trackIds: number[]; method: string }
interface HumanEventRef { eventPlayerId: string; trackIds: number[] }

/** Snapshot human identity knowledge before machine output is replaced. */
function snapshotHumanLabels(matchId: string): { links: HumanIdentity[]; refs: HumanEventRef[] } {
  const db = getDb();
  const tracked = db.trackedPlayers.filter((t) => t.matchId === matchId);
  const byId = new Map(tracked.map((t) => [t.id, t]));
  const links = db.playerLinks
    .filter((l) => byId.has(l.trackedPlayerId) && (byId.get(l.trackedPlayerId)!.trackIds?.length ?? 0) > 0)
    .map((l) => ({ playerId: l.playerId, trackIds: byId.get(l.trackedPlayerId)!.trackIds!, method: l.method }));
  const manualIds = new Set(db.events.filter((e) => e.matchId === matchId && e.source === "MANUAL").map((e) => e.id));
  const refs = db.eventPlayers
    .filter((ep) => manualIds.has(ep.eventId) && ep.trackedPlayerId && (byId.get(ep.trackedPlayerId)?.trackIds?.length ?? 0) > 0)
    .map((ep) => ({ eventPlayerId: ep.id, trackIds: byId.get(ep.trackedPlayerId!)!.trackIds! }));
  return { links, refs };
}

/** After new identities exist, re-attach human labels to whichever identity shares the most tracker fragments. */
function restoreHumanLabels(matchId: string, snap: { links: HumanIdentity[]; refs: HumanEventRef[] }) {
  mutate((db) => {
    const tracked = db.trackedPlayers.filter((t) => t.matchId === matchId && t.trackIds?.length);
    const bestFor = (ids: number[]) => {
      let best: { id: string; n: number } | null = null;
      for (const t of tracked) {
        const n = t.trackIds!.filter((x) => ids.includes(x)).length;
        if (n > 0 && (!best || n > best.n)) best = { id: t.id, n };
      }
      return best?.id ?? null;
    };
    for (const l of snap.links) {
      const id = bestFor(l.trackIds);
      if (id && !db.playerLinks.some((x) => x.trackedPlayerId === id)) {
        db.playerLinks.push({ id: newId("link"), trackedPlayerId: id, playerId: l.playerId, method: l.method as PlayerLink["method"], confidence: 1, createdAt: nowIso() });
      }
    }
    for (const r of snap.refs) {
      const ep = db.eventPlayers.find((x) => x.id === r.eventPlayerId);
      if (ep) ep.trackedPlayerId = bestFor(r.trackIds);
    }
  });
}

/** Remove previous machine-generated output for a match (mock or real). Manual labels are kept. */
function clearMockOutput(matchId: string) {
  mutate((db) => {
    const mockEventIds = new Set(db.events.filter((e) => e.matchId === matchId && e.source !== "MANUAL").map((e) => e.id));
    db.events = db.events.filter((e) => !mockEventIds.has(e.id));
    db.eventPlayers = db.eventPlayers.filter((ep) => !mockEventIds.has(ep.eventId));
    const klipIds = new Set(db.klips.filter((k) => mockEventIds.has(k.eventId)).map((k) => k.id));
    db.klips = db.klips.filter((k) => !klipIds.has(k.id));
    db.klipLikes = db.klipLikes.filter((l) => !klipIds.has(l.klipId));
    db.klipShares = db.klipShares.filter((s) => !klipIds.has(s.klipId));
    db.klipViews = db.klipViews.filter((v) => !klipIds.has(v.klipId));
    const trackedIds = new Set(db.trackedPlayers.filter((t) => t.matchId === matchId).map((t) => t.id));
    db.trackedPlayers = db.trackedPlayers.filter((t) => !trackedIds.has(t.id));
    db.playerLinks = db.playerLinks.filter((l) => !trackedIds.has(l.trackedPlayerId));
    db.processingJobs = db.processingJobs.filter((j) => j.matchId !== matchId);
  });
}

export function playersPerTeam(format: string): number {
  return format === "7v7" ? 7 : format === "6v6" ? 6 : 5;
}

export async function runProcessingPipeline(matchId: string, opts: { engine?: AiEngine; stepDelayMs?: number; renderClips?: boolean } = {}) {
  const db = getDb();
  const match = db.matches.find((m) => m.id === matchId);
  const video = match?.videoId ? db.videos.find((v) => v.id === match.videoId) : null;
  if (!match || !video) throw new Error("Match has no video to process");
  const perTeam = playersPerTeam(match.format);
  const engine = opts.engine ?? createMockEngine(perTeam);
  const delay = opts.stepDelayMs ?? 1500;

  const humanLabels = snapshotHumanLabels(matchId);
  try {
    clearMockOutput(matchId);
    setStage(matchId, "UPLOADED", engine.name);
    await sleep(delay);
    setStage(matchId, "PROCESSING", engine.name);
    await sleep(delay);

    setStage(matchId, "PLAYER_DETECTION", engine.name);
    const detected = await engine.playerDetection.detectPlayers(video);
    await sleep(delay);

    setStage(matchId, "PLAYER_TRACKING", engine.name, [`${detected.length} players detected`]);
    const tracked = await engine.playerTracking.trackPlayers(video, detected);
    const trackedIds = mutate((d) => {
      const ids: Record<string, string> = {};
      for (const t of tracked) {
        const id = newId("trk");
        ids[t.label] = id;
        d.trackedPlayers.push({ id, matchId, label: t.label, team: t.team, shirtColour: t.shirtColour, shirtNumber: t.shirtNumber, confidence: Math.round(t.confidence * 100) / 100, engine: engine.name, trackIds: t.trackIds });
      }
      return ids;
    });
    restoreHumanLabels(matchId, humanLabels);
    // Identity suggestions: stored as low-confidence links only when confidence is high enough to be useful.
    const roster = getDb().matchPlayers
      .filter((mp) => mp.matchId === matchId)
      .map((mp) => ({ profile: getDb().playerProfiles.find((p) => p.id === mp.playerId)!, team: mp.team as Team, shirtNumber: mp.shirtNumber }));
    const suggestions = await engine.playerIdentification.identify(tracked, roster);
    mutate((d) => {
      for (const s of suggestions) {
        if (s.confidence >= 0.8) {
          d.playerLinks.push({ id: newId("link"), trackedPlayerId: trackedIds[s.trackedLabel], playerId: s.playerId, method: s.method, confidence: s.confidence, createdAt: nowIso() });
        }
      }
    });
    await sleep(delay);

    setStage(matchId, "EVENT_DETECTION", engine.name, [`${tracked.length} players tracked`]);
    const events = await engine.eventDetection.detectEvents(video, tracked);
    await sleep(delay);

    setStage(matchId, "GENERATING_KLIPS", engine.name, [`${events.length} moments found`]);
    const clips = await engine.clipGeneration.generateClips(events);
    const provider = providerFor(video);
    const rendered = await Promise.all(clips.map((c) => provider.createClip({ video, startTime: c.startTime, endTime: c.endTime })));
    mutate((d) => {
      clips.forEach((c, i) => {
        const e = events[c.eventIndex];
        const eventId = newId("evt");
        d.events.push({ id: eventId, matchId, videoId: video.id, type: e.type, timestamp: e.timestamp, startTime: e.startTime, endTime: e.endTime, confidence: e.confidence, team: e.team, source: engine.name === "MOCK" ? "MOCK_AI" : "AI", metadata: { engine: engine.name, ...(e.metadata ?? {}) }, createdAt: nowIso() });
        e.trackedLabels.forEach((lbl, j) => {
          d.eventPlayers.push({ id: newId("evp"), eventId, playerId: null, trackedPlayerId: trackedIds[lbl], role: j === 0 ? "PRIMARY" : e.type === "GOAL" ? "ASSIST" : "INVOLVED" });
        });
        d.klips.push({ id: newId("klip"), matchId, eventId, videoId: video.id, startTime: c.startTime, endTime: c.endTime, title: c.title, status: rendered[i].status, clipUrl: rendered[i].clipUrl, thumbnailUrl: rendered[i].thumbnailUrl, createdAt: nowIso() });
      });
    });
    if (opts.renderClips && sourceFileFor(video)) {
      appendJobLog(matchId, "Rendering KLIP files with ffmpeg");
      try {
        const n = await renderKlipsForMatch(matchId, { log: (m) => appendJobLog(matchId, m) });
        appendJobLog(matchId, `${n} KLIP files rendered`);
      } catch (err) {
        appendJobLog(matchId, `Clip rendering skipped: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await sleep(delay);

    setStage(matchId, "READY", engine.name);
    // Players are told only once a person has checked the game and published it. Auto mode is the exception.
    const finished = getDb().matches.find((x) => x.id === matchId);
    if (finished && (finished.publishMode ?? "REVIEWED") === "AUTO" && !finished.publishedAt) {
      const { releaseMatch } = await import("../publish");
      await releaseMatch(matchId).catch((e) => appendJobLog(matchId, `Auto release failed: ${String(e)}`));
    }
  } catch (err) {
    setStage(matchId, "FAILED", engine.name, [String(err)]);
    throw err;
  }
}

/** Apply a CV result produced elsewhere (a worker) to a match: tracked players, events and KLIPs. */
export async function ingestCvOutput(matchId: string, output: import("./local").CvOutput) {
  const { LocalCvEngine } = await import("./local");
  const match = getDb().matches.find((m) => m.id === matchId);
  if (!match) throw new Error("Match not found");
  const engine = new LocalCvEngine({ perTeam: playersPerTeam(match.format), preloaded: output });
  await runProcessingPipeline(matchId, { engine, stepDelayMs: 0, renderClips: false });
}
