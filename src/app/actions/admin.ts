"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, mutate, newId, nowIso, resetDb } from "@/lib/db/store";
import { EVENT_TYPES, type EventType, type Team, type MatchFormat } from "@/lib/domain/types";
import { appendJobLog, playersPerTeam, runProcessingPipeline } from "@/lib/ai/pipeline";
import { LocalCvEngine, localCvAvailable } from "@/lib/ai/local";
import { getVideoProvider } from "@/lib/video";
import { VimeoVideoProvider } from "@/lib/video/vimeo";
import { providerFor } from "@/lib/video";
import { clipRenderStatus, logToMatch, renderKlipsForMatch } from "@/lib/video/clips";

export interface EventInput {
  matchId: string;
  type: EventType;
  timestamp: number;
  startTime: number;
  endTime: number;
  team: Team | null;
  title: string | null;
  /** Either a real player profile id or a tracked player id. */
  primaryPlayerId: string | null;
  primaryTrackedId: string | null;
  assistPlayerId: string | null;
  createKlip: boolean;
}

function validate(input: EventInput) {
  if (!EVENT_TYPES.includes(input.type)) throw new Error("Invalid event type");
  if (!(input.startTime < input.endTime)) throw new Error("Clip end must be after clip start");
  if (input.endTime - input.startTime > 60) throw new Error("KLIPs should be 60 seconds or shorter");
  if (!input.primaryPlayerId && !input.primaryTrackedId) throw new Error("Select a player");
}

export async function saveEvent(input: EventInput, eventId?: string) {
  validate(input);
  const id = mutate((db) => {
    const match = db.matches.find((m) => m.id === input.matchId);
    if (!match) throw new Error("Match not found");
    const existing = eventId ? db.events.find((e) => e.id === eventId) : null;
    const evId = existing?.id ?? newId("evt");
    const event = existing ?? {
      id: evId, matchId: input.matchId, videoId: match.videoId, type: input.type, timestamp: input.timestamp,
      startTime: input.startTime, endTime: input.endTime, confidence: 1, team: input.team, source: "MANUAL" as const,
      metadata: {}, createdAt: nowIso(),
    };
    Object.assign(event, {
      type: input.type, timestamp: input.timestamp, startTime: input.startTime, endTime: input.endTime, team: input.team,
      source: "MANUAL", confidence: 1, metadata: { ...event.metadata, title: input.title ?? undefined, editedAt: nowIso() },
    });
    if (!existing) db.events.push(event);

    db.eventPlayers = db.eventPlayers.filter((ep) => ep.eventId !== evId);
    db.eventPlayers.push({ id: newId("evp"), eventId: evId, playerId: input.primaryPlayerId, trackedPlayerId: input.primaryTrackedId, role: "PRIMARY" });
    if (input.assistPlayerId) db.eventPlayers.push({ id: newId("evp"), eventId: evId, playerId: input.assistPlayerId, trackedPlayerId: null, role: "ASSIST" });

    const klip = db.klips.find((k) => k.eventId === evId);
    if (klip) {
      klip.startTime = input.startTime;
      klip.endTime = input.endTime;
      klip.title = input.title;
    } else if (input.createKlip && match.videoId) {
      db.klips.push({ id: newId("klip"), matchId: match.id, eventId: evId, videoId: match.videoId, startTime: input.startTime, endTime: input.endTime, title: input.title, status: "VIRTUAL", clipUrl: null, thumbnailUrl: null, createdAt: nowIso() });
    }
    return evId;
  });
  revalidatePath("/", "layout");
  return id;
}

export async function deleteEvent(eventId: string) {
  mutate((db) => {
    db.events = db.events.filter((e) => e.id !== eventId);
    db.eventPlayers = db.eventPlayers.filter((ep) => ep.eventId !== eventId);
    const klipIds = db.klips.filter((k) => k.eventId === eventId).map((k) => k.id);
    db.klips = db.klips.filter((k) => k.eventId !== eventId);
    db.klipLikes = db.klipLikes.filter((l) => !klipIds.includes(l.klipId));
    db.klipShares = db.klipShares.filter((s) => !klipIds.includes(s.klipId));
    db.klipViews = db.klipViews.filter((v) => !klipIds.includes(v.klipId));
  });
  revalidatePath("/", "layout");
}

/** Delete only the KLIP, keeping the labelled event. */
export async function deleteKlip(klipId: string) {
  mutate((db) => {
    db.klips = db.klips.filter((k) => k.id !== klipId);
    db.klipLikes = db.klipLikes.filter((l) => l.klipId !== klipId);
    db.klipShares = db.klipShares.filter((s) => s.klipId !== klipId);
    db.klipViews = db.klipViews.filter((v) => v.klipId !== klipId);
  });
  revalidatePath("/", "layout");
}

export async function createKlipForEvent(eventId: string) {
  mutate((db) => {
    const e = db.events.find((x) => x.id === eventId);
    if (!e || !e.videoId || db.klips.some((k) => k.eventId === eventId)) return;
    db.klips.push({ id: newId("klip"), matchId: e.matchId, eventId, videoId: e.videoId, startTime: e.startTime, endTime: e.endTime, title: (e.metadata.title as string) ?? null, status: "VIRTUAL", clipUrl: null, thumbnailUrl: null, createdAt: nowIso() });
  });
  revalidatePath("/", "layout");
}

export async function setMatchScore(matchId: string, home: number, away: number) {
  mutate((db) => {
    const m = db.matches.find((x) => x.id === matchId);
    if (m) m.score = { home, away };
  });
  revalidatePath("/", "layout");
}

/** Kick off processing. Runs in the background; the UI polls status. */
export async function startProcessing(matchId: string, engineKey: "MOCK" | "LOCAL_CV" = "MOCK", opts: { duration?: number } = {}) {
  if (engineKey === "LOCAL_CV") {
    if (!localCvAvailable()) throw new Error("Local CV environment is not set up (ai/.venv).");
    const match = getDb().matches.find((m) => m.id === matchId);
    if (!match) throw new Error("Match not found");
    const engine = new LocalCvEngine({
      perTeam: playersPerTeam(match.format),
      duration: opts.duration,
      debugFrames: 40,
      onLog: (stage, msg, progress) => appendJobLog(matchId, `${stage}: ${msg}${progress !== undefined ? ` (${Math.round(progress * 100)}%)` : ""}`),
    });
    void runProcessingPipeline(matchId, { engine, stepDelayMs: 0, renderClips: true }).catch((err) => console.error("[pipeline]", err));
  } else {
    void runProcessingPipeline(matchId, { stepDelayMs: 2500 }).catch((err) => console.error("[pipeline]", err));
  }
  revalidatePath("/", "layout");
}

export async function localCvStatus() {
  return { available: localCvAvailable() };
}

export async function createMatch(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const venueId = String(formData.get("venueId") ?? "");
  const pitchId = String(formData.get("pitchId") ?? "");
  const kickoffAt = String(formData.get("kickoffAt") ?? "");
  const format = String(formData.get("format") ?? "5v5") as MatchFormat;
  const videoUrl = String(formData.get("videoUrl") ?? "").trim();
  const playerIds = formData.getAll("playerIds").map(String);
  const pasted = await parseRoster(String(formData.get("roster") ?? ""));
  if (!title || !venueId || !pitchId || !kickoffAt) throw new Error("Missing fields");

  const vimeoId = videoUrl ? VimeoVideoProvider.parseExternalId(videoUrl) : null;
  const meta = vimeoId ? await getVideoProvider("vimeo").getVideoMetadata(vimeoId).catch(() => null) : null;

  const matchId = mutate((db) => {
    const id = newId("match");
    const videoId = vimeoId ? newId("video") : null;
    const camera = db.cameras.find((c) => c.pitchId === pitchId);
    db.matches.push({
      id, title, venueId, pitchId, organiserId: "org_footy_addicts", bookingProviderId: "bp_manual", externalBookingRef: null,
      kickoffAt: new Date(kickoffAt).toISOString(), durationMinutes: 40, format, status: videoId ? "UPLOADED" : "SCHEDULED",
      homeTeam: { name: "Blue", colour: "#3b82f6" }, awayTeam: { name: "Orange", colour: "#f97316" }, score: null, videoId, createdAt: nowIso(),
    });
    if (videoId && vimeoId) {
      db.videos.push({ id: videoId, matchId: id, provider: "vimeo", externalId: vimeoId, sourceUrl: `https://vimeo.com/${vimeoId}`, durationSeconds: meta?.durationSeconds ?? 0, thumbnailUrl: meta?.thumbnailUrl ?? null, width: meta?.width ?? null, height: meta?.height ?? null, cameraId: camera?.id ?? null, status: meta ? "AVAILABLE" : "PENDING" });
    }
    // Roster = ticked existing players + pasted lines (created or matched by email). Teams: explicit H/A, else split evenly.
    const entries: Array<{ pid: string; team: Team | null }> = [
      ...playerIds.map((pid) => ({ pid, team: null as Team | null })),
      ...pasted.map((r) => ({ pid: upsertProfile(db, r), team: r.team })),
    ].filter((e, i, arr) => arr.findIndex((x) => x.pid === e.pid) === i);
    const unassigned = entries.filter((e) => !e.team);
    const home = entries.filter((e) => e.team === "HOME").length, away = entries.filter((e) => e.team === "AWAY").length;
    let toHome = Math.max(0, Math.ceil(entries.length / 2) - home);
    for (const e of unassigned) { e.team = toHome > 0 ? "HOME" : "AWAY"; if (toHome > 0) toHome--; }
    void away;
    const counters = { HOME: 0, AWAY: 0 };
    for (const e of entries) {
      counters[e.team!]++;
      db.matchPlayers.push({ id: newId("mp"), matchId: id, playerId: e.pid, team: e.team!, shirtNumber: counters[e.team!], source: "MANUAL" });
    }
    return id;
  });
  revalidatePath("/", "layout");
  redirect(`/admin/matches/${matchId}`);
}

export async function resetSeedData() {
  resetDb();
  revalidatePath("/", "layout");
  redirect("/admin");
}

export async function refreshVideoMetadata(videoId: string) {
  const db = getDb();
  const video = db.videos.find((v) => v.id === videoId);
  if (!video) return;
  const meta = await providerFor(video).getVideoMetadata(video.externalId);
  mutate((d) => {
    const v = d.videos.find((x) => x.id === videoId)!;
    v.durationSeconds = meta.durationSeconds;
    v.thumbnailUrl = meta.thumbnailUrl;
    v.width = meta.width;
    v.height = meta.height;
    v.status = "AVAILABLE";
  });
  revalidatePath("/", "layout");
}

/** Render MP4 files (with watermark) for every KLIP of a match that is still virtual. Background. */
export async function startClipRendering(matchId: string) {
  const st = clipRenderStatus(matchId);
  if (!st.sourceAvailable) throw new Error("Source footage is not on this machine (ai/videos/<id>.mp4)");
  if (!st.ffmpeg) throw new Error("ffmpeg is not installed");
  void renderKlipsForMatch(matchId, { log: (m) => logToMatch(matchId, m) }).catch((err) => logToMatch(matchId, `Rendering failed: ${err instanceof Error ? err.message : String(err)}`));
  revalidatePath("/", "layout");
}

export async function getClipRenderStatus(matchId: string) {
  return clipRenderStatus(matchId);
}

/* ---------------- roster / players ---------------- */

export interface RosterLine { name: string; email: string | null; team: Team | null }

/** Parse pasted roster text. One player per line: `Name, email, H|A` (email and team optional). */
export async function parseRoster(text: string): Promise<RosterLine[]> {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,\t;]/).map((x) => x.trim()).filter((x) => x !== "");
      const email = parts.find((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))?.toLowerCase() ?? null;
      const teamRaw = parts.find((x) => /^(h|a|home|away|blue|orange)$/i.test(x))?.toLowerCase();
      const team: Team | null = !teamRaw ? null : ["h", "home", "blue"].includes(teamRaw) ? "HOME" : "AWAY";
      const name = parts.find((x) => x !== email && !/^(h|a|home|away|blue|orange)$/i.test(x)) ?? (email ? email.split("@")[0] : "");
      return { name, email, team };
    })
    .filter((r) => r.name);
}

function upsertProfile(db: import("@/lib/domain/types").Database, r: RosterLine): string {
  const byEmail = r.email ? db.playerProfiles.find((p) => p.email?.toLowerCase() === r.email) : null;
  const byUserEmail = r.email ? db.users.find((u) => u.email.toLowerCase() === r.email) : null;
  const existing = byEmail ?? (byUserEmail ? db.playerProfiles.find((p) => p.userId === byUserEmail.id) : null) ?? db.playerProfiles.find((p) => !r.email && p.displayName.toLowerCase() === r.name.toLowerCase());
  if (existing) {
    if (r.email && !existing.email) existing.email = r.email;
    return existing.id;
  }
  const base = r.name.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "player";
  let handle = base, n = 1;
  while (db.playerProfiles.some((p) => p.handle === handle)) handle = `${base}${++n}`;
  const id = newId("player");
  const user = r.email ? db.users.find((u) => u.email.toLowerCase() === r.email) : null;
  db.playerProfiles.push({ id, userId: user && !db.playerProfiles.some((p) => p.userId === user.id) ? user.id : null, email: r.email ?? undefined, displayName: r.name, handle, createdAt: nowIso() });
  return id;
}

export async function addPlayers(formData: FormData) {
  const lines = await parseRoster(String(formData.get("roster") ?? ""));
  if (!lines.length) throw new Error("Add at least one player");
  mutate((db) => { for (const r of lines) upsertProfile(db, r); });
  revalidatePath("/admin/players");
  redirect("/admin/players?added=" + lines.length);
}
