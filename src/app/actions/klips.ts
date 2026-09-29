"use server";

import { revalidatePath } from "next/cache";
import { getSessionUserId } from "@/lib/auth/session";
import { mutate, newId, nowIso } from "@/lib/db/store";
import type { ShareChannel } from "@/lib/domain/types";

export async function toggleLike(klipId: string) {
  const uid = await getSessionUserId();
  if (!uid) return { liked: false, count: 0, authed: false };
  const result = mutate((db) => {
    const idx = db.klipLikes.findIndex((l) => l.klipId === klipId && l.userId === uid);
    if (idx >= 0) db.klipLikes.splice(idx, 1);
    else db.klipLikes.push({ id: newId("like"), klipId, userId: uid, createdAt: nowIso() });
    return { liked: idx < 0, count: db.klipLikes.filter((l) => l.klipId === klipId).length, authed: true };
  });
  revalidatePath("/", "layout");
  return result;
}

export async function recordShare(klipId: string, channel: ShareChannel) {
  const uid = await getSessionUserId();
  mutate((db) => {
    db.klipShares.push({ id: newId("share"), klipId, userId: uid, channel, createdAt: nowIso() });
  });
}

export async function recordView(klipId: string) {
  const uid = await getSessionUserId();
  mutate((db) => {
    db.klipViews.push({ id: newId("view"), klipId, userId: uid, createdAt: nowIso() });
  });
}

export async function markNotificationsRead() {
  const uid = await getSessionUserId();
  if (!uid) return;
  mutate((db) => {
    for (const n of db.notifications) if (n.userId === uid) n.read = true;
  });
  revalidatePath("/home");
}
