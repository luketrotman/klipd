"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getSessionUserId } from "@/lib/auth/session";
import { getDb, mutate, newId, nowIso } from "@/lib/db/store";
import type { ShareChannel } from "@/lib/domain/types";

const CHANNELS: ShareChannel[] = ["NATIVE", "COPY_LINK", "WHATSAPP", "INSTAGRAM", "TIKTOK", "DOWNLOAD"];

/** Views and shares are public counters, so they are de-duplicated per viewer to keep the database from being flooded. */
const recent = new Map<string, number>();
function firstTime(key: string, windowMs: number): boolean {
  const now = Date.now();
  const t = recent.get(key);
  if (t !== undefined && now - t < windowMs) return false;
  recent.set(key, now);
  if (recent.size > 5000) for (const [k, v] of recent) if (now - v > 3_600_000) recent.delete(k);
  return true;
}
async function actor(): Promise<string> {
  const uid = await getSessionUserId();
  if (uid) return uid;
  return `ip:${(await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local"}`;
}
const klipExists = (id: string) => getDb().klips.some((k) => k.id === id);

export async function toggleLike(klipId: string) {
  const uid = await getSessionUserId();
  if (!uid) return { liked: false, count: 0, authed: false };
  if (!klipExists(klipId)) return { liked: false, count: 0, authed: true };
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
  if (!CHANNELS.includes(channel) || !klipExists(klipId)) return;
  if (!firstTime(`share:${klipId}:${channel}:${await actor()}`, 10_000)) return;
  const uid = await getSessionUserId();
  mutate((db) => {
    db.klipShares.push({ id: newId("share"), klipId, userId: uid, channel, createdAt: nowIso() });
  });
}

export async function recordView(klipId: string) {
  if (!klipExists(klipId)) return;
  if (!firstTime(`view:${klipId}:${await actor()}`, 30 * 60_000)) return;
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
