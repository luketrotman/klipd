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
    void runProcessingPipeline(matchId, { engine, stepDelayMs: 0 }).catch((err) => console.error("[pipeline]", err));
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
    const perTeam = Math.ceil(playerIds.length / 2);
    playerIds.forEach((pid, i) => {
      db.matchPlayers.push({ id: newId("mp"), matchId: id, playerId: pid, team: i < perTeam ? "HOME" : "AWAY", shirtNumber: (i % perTeam) + 1, source: "MANUAL" });
    });
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
