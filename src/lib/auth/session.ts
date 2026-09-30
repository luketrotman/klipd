/**
 * Sessions. The cookie value is `<userId>.<expiresAtMs>.<hmac>`, signed with AUTH_SECRET, so a
 * user id alone cannot be forged into a session. Sign-in is by emailed one-time link (magic.ts).
 * Swapping in Supabase Auth later only changes getSessionUserId().
 */
import { cookies } from "next/headers";
import { getDb } from "../db/store";
import type { PlayerProfile, User } from "../domain/types";
import { hmac, safeEqual } from "./crypto";

export const SESSION_COOKIE = "klipd_session";
const SESSION_DAYS = 30;

export function makeSessionValue(userId: string): string {
  const exp = Date.now() + SESSION_DAYS * 86400_000;
  const body = `${userId}.${exp}`;
  return `${body}.${hmac(`session:${body}`)}`;
}

export function readSessionValue(value: string | undefined): string | null {
  if (!value) return null;
  const i = value.lastIndexOf(".");
  if (i < 0) return null;
  const body = value.slice(0, i), sig = value.slice(i + 1);
  if (!safeEqual(sig, hmac(`session:${body}`))) return null;
  const [userId, exp] = [body.slice(0, body.lastIndexOf(".")), Number(body.slice(body.lastIndexOf(".") + 1))];
  if (!userId || !Number.isFinite(exp) || exp < Date.now()) return null;
  return userId;
}

export async function setSessionCookie(userId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, makeSessionValue(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  return readSessionValue(jar.get(SESSION_COOKIE)?.value);
}

export interface Viewer {
  user: User;
  profile: PlayerProfile | null;
}

export async function getViewer(): Promise<Viewer | null> {
  const uid = await getSessionUserId();
  if (!uid) return null;
  const db = getDb();
  const user = db.users.find((u) => u.id === uid);
  if (!user) return null;
  return { user, profile: db.playerProfiles.find((p) => p.userId === uid) ?? null };
}

export function demoLoginEnabled(): boolean {
  return process.env.DEMO_LOGIN === "1" || process.env.NODE_ENV !== "production";
}
