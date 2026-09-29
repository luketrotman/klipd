/**
 * Auth for the MVP.
 *
 * A signed-in user is identified by the httpOnly cookie `klipd_uid`. This is a
 * development stand-in for Supabase Auth: replace `getSessionUserId` with a call
 * to supabase.auth.getUser() and the rest of the app is unchanged.
 */
import { cookies } from "next/headers";
import { getDb } from "../db/store";
import type { PlayerProfile, User } from "../domain/types";

export const SESSION_COOKIE = "klipd_uid";

export async function getSessionUserId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value ?? null;
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
