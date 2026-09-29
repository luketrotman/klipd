"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth/session";
import { mutate, newId, nowIso } from "@/lib/db/store";
import type { PlayerLinkMethod } from "@/lib/domain/types";

/** Link a tracked player ("Player 03") to a real player profile. */
export async function linkTrackedPlayer(trackedPlayerId: string, playerId: string, method: PlayerLinkMethod) {
  mutate((db) => {
    db.playerLinks = db.playerLinks.filter((l) => l.trackedPlayerId !== trackedPlayerId);
    db.playerLinks.push({ id: newId("link"), trackedPlayerId, playerId, method, confidence: 1, createdAt: nowIso() });
  });
  revalidatePath("/", "layout");
}

export async function unlinkTrackedPlayer(trackedPlayerId: string) {
  mutate((db) => {
    db.playerLinks = db.playerLinks.filter((l) => l.trackedPlayerId !== trackedPlayerId);
  });
  revalidatePath("/", "layout");
}

/** "That's me" from the match page. */
export async function claimTrackedPlayer(trackedPlayerId: string) {
  const viewer = await getViewer();
  if (!viewer?.profile) return { ok: false, reason: "Sign in to claim your moments." };
  await linkTrackedPlayer(trackedPlayerId, viewer.profile.id, "SELF_CLAIM");
  return { ok: true };
}
