"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/session";
import { getDb, mutate, newId, nowIso } from "@/lib/db/store";
import { EVENT_TYPES, type EventType } from "@/lib/domain/types";
import { linkTrackedPlayer } from "./identity";

async function requireAdmin() {
  const v = await getViewer();
  if (!v?.user.isAdmin) throw new Error("Admin only");
  return v;
}

export interface QuickLabelInput {
  matchId: string;
  timestamp: number;
  type: EventType;
  trackedPlayerId: string | null;
  playerId: string | null;
  trackId?: number | null;
  lead?: number;
  tail?: number;
}

/** One tap in the quick labeller: a verified human label (source MANUAL). */
export async function saveQuickLabel(input: QuickLabelInput) {
  await requireAdmin();
  if (!EVENT_TYPES.includes(input.type)) throw new Error("Bad type");
  if (!input.trackedPlayerId && !input.playerId) throw new Error("Pick a player");
  const lead = input.lead ?? 8, tail = input.tail ?? 7;
  const id = mutate((db) => {
    const match = db.matches.find((m) => m.id === input.matchId);
    if (!match) throw new Error("No match");
    const evId = newId("evt");
    const t = Math.round(input.timestamp * 10) / 10;
    db.events.push({ id: evId, matchId: match.id, videoId: match.videoId, type: input.type, timestamp: t, startTime: Math.max(0, t - lead), endTime: t + tail, confidence: 1, team: null, source: "MANUAL", metadata: { labeller: "quick", labelledAt: nowIso(), trackId: input.trackId ?? null }, createdAt: nowIso() });
    // resolve the player: a linked tracked identity gives us both
    let playerId = input.playerId;
    if (!playerId && input.trackedPlayerId) {
      const link = db.playerLinks.find((l) => l.trackedPlayerId === input.trackedPlayerId);
      playerId = link?.playerId ?? null;
    }
    db.eventPlayers.push({ id: newId("evp"), eventId: evId, playerId, trackedPlayerId: input.trackedPlayerId, role: "PRIMARY" });
    if (match.videoId) db.klips.push({ id: newId("klip"), matchId: match.id, eventId: evId, videoId: match.videoId, startTime: Math.max(0, t - lead), endTime: t + tail, title: null, status: "VIRTUAL", clipUrl: null, thumbnailUrl: null, createdAt: nowIso() });
    return evId;
  });
  revalidatePath("/", "layout");
  return id;
}

export async function deleteLabel(eventId: string) {
  await requireAdmin();
  mutate((db) => {
    const e = db.events.find((x) => x.id === eventId);
    if (!e || e.source !== "MANUAL") return;
    db.events = db.events.filter((x) => x.id !== eventId);
    db.eventPlayers = db.eventPlayers.filter((x) => x.eventId !== eventId);
    const klipIds = db.klips.filter((k) => k.eventId === eventId).map((k) => k.id);
    db.klips = db.klips.filter((k) => k.eventId !== eventId);
    db.klipViews = db.klipViews.filter((v) => !klipIds.includes(v.klipId));
    db.klipLikes = db.klipLikes.filter((v) => !klipIds.includes(v.klipId));
    db.klipShares = db.klipShares.filter((v) => !klipIds.includes(v.klipId));
  });
  revalidatePath("/", "layout");
}

/** "Who is Player 07?" from the labeller: links a tracked identity to a roster player. */
export async function identifyTracked(trackedPlayerId: string, playerId: string) {
  await requireAdmin();
  await linkTrackedPlayer(trackedPlayerId, playerId, "MANUAL");
}

export type ReviewVerdict = "correct" | "wrong" | "wrong_player" | "wrong_type";

/**
 * Review an AI event. "correct" and corrections create a MANUAL twin so the evaluator has
 * ground truth; "wrong" just marks the AI event rejected (kept for training as a negative).
 */
export async function reviewAiEvent(eventId: string, verdict: ReviewVerdict, correction: { trackedPlayerId?: string | null; playerId?: string | null; type?: EventType } = {}) {
  await requireAdmin();
  const twinId = mutate((db) => {
    const e = db.events.find((x) => x.id === eventId);
    if (!e) throw new Error("No event");
    e.metadata = { ...e.metadata, review: verdict, reviewedAt: nowIso() };
    if (verdict === "wrong") return null;
    const primary = db.eventPlayers.find((ep) => ep.eventId === eventId && ep.role === "PRIMARY");
    const trackedPlayerId = verdict === "wrong_player" ? correction.trackedPlayerId ?? null : primary?.trackedPlayerId ?? null;
    let playerId = verdict === "wrong_player" ? correction.playerId ?? null : primary?.playerId ?? null;
    if (!playerId && trackedPlayerId) playerId = db.playerLinks.find((l) => l.trackedPlayerId === trackedPlayerId)?.playerId ?? null;
    const type = verdict === "wrong_type" && correction.type ? correction.type : e.type;
    const twin = newId("evt");
    db.events.push({ id: twin, matchId: e.matchId, videoId: e.videoId, type, timestamp: e.timestamp, startTime: e.startTime, endTime: e.endTime, confidence: 1, team: e.team, source: "MANUAL", metadata: { labeller: "review", fromEventId: eventId, labelledAt: nowIso() }, createdAt: nowIso() });
    db.eventPlayers.push({ id: newId("evp"), eventId: twin, playerId, trackedPlayerId, role: "PRIMARY" });
    return twin;
  });
  revalidatePath("/", "layout");
  return twinId;
}

export async function labelStats(matchId: string) {
  const db = getDb();
  const ev = db.events.filter((e) => e.matchId === matchId);
  return {
    quick: ev.filter((e) => e.source === "MANUAL" && e.metadata.labeller === "quick").length,
    reviewed: ev.filter((e) => e.source === "AI" && e.metadata.review).length,
    ai: ev.filter((e) => e.source === "AI").length,
  };
}
