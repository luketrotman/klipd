"use server";

import { revalidatePath } from "next/cache";
import { assertAdmin } from "@/lib/auth/admin";
import { getViewer } from "@/lib/auth/session";
import { getDb, mutate, newId, nowIso } from "@/lib/db/store";
import type { PlayerLinkMethod } from "@/lib/domain/types";

function setLink(trackedPlayerId: string, playerId: string, method: PlayerLinkMethod) {
  mutate((db) => {
    db.playerLinks = db.playerLinks.filter((l) => l.trackedPlayerId !== trackedPlayerId);
    db.playerLinks.push({ id: newId("link"), trackedPlayerId, playerId, method, confidence: 1, createdAt: nowIso() });
  });
}

/** Admin: link a tracked player ("Player 03") to a real player profile, replacing any existing link. */
export async function linkTrackedPlayer(trackedPlayerId: string, playerId: string, method: PlayerLinkMethod) {
  await assertAdmin();
  const db = getDb();
  if (!db.trackedPlayers.some((t) => t.id === trackedPlayerId) || !db.playerProfiles.some((p) => p.id === playerId)) throw new Error("Unknown player");
  setLink(trackedPlayerId, playerId, method);
  revalidatePath("/", "layout");
}

export async function unlinkTrackedPlayer(trackedPlayerId: string) {
  await assertAdmin();
  mutate((db) => {
    db.playerLinks = db.playerLinks.filter((l) => l.trackedPlayerId !== trackedPlayerId);
  });
  revalidatePath("/", "layout");
}

/**
 * "That's me" from the match page. A player can only claim an unlinked player in a published game
 * they are on the roster for, and never more than four per game. It can never overwrite an existing link.
 */
export async function claimTrackedPlayer(trackedPlayerId: string) {
  const viewer = await getViewer();
  if (!viewer?.profile) return { ok: false, reason: "Sign in to claim your moments." };
  const me = viewer.profile;
  const db = getDb();
  const tracked = db.trackedPlayers.find((t) => t.id === trackedPlayerId);
  const match = tracked ? db.matches.find((m) => m.id === tracked.matchId) : null;
  if (!tracked || !match) return { ok: false, reason: "That player no longer exists." };
  const released = !!match.publishedAt || (match.publishMode ?? "REVIEWED") === "AUTO";
  if (!released) return { ok: false, reason: "This game is still being checked." };
  if (!db.matchPlayers.some((mp) => mp.matchId === match.id && mp.playerId === me.id)) return { ok: false, reason: "You are not on this game's roster." };
  if (db.playerLinks.some((l) => l.trackedPlayerId === trackedPlayerId)) return { ok: false, reason: "That player is already linked." };
  const mine = db.playerLinks.filter((l) => l.playerId === me.id && db.trackedPlayers.find((t) => t.id === l.trackedPlayerId)?.matchId === match.id).length;
  if (mine >= 4) return { ok: false, reason: "You have already claimed the maximum for this game. Ask the organiser to fix the rest." };
  setLink(trackedPlayerId, me.id, "SELF_CLAIM");
  revalidatePath("/", "layout");
  return { ok: true };
}
