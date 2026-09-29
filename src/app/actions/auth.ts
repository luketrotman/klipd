"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, mutate, newId, nowIso } from "@/lib/db/store";
import { SESSION_COOKIE, getSessionUserId } from "@/lib/auth/session";

async function setSession(userId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}

export async function signInAs(userId: string) {
  const user = getDb().users.find((u) => u.id === userId);
  if (!user) redirect("/login?error=unknown");
  await setSession(userId);
  const profile = getDb().playerProfiles.find((p) => p.userId === userId);
  redirect(profile ? "/home" : "/onboarding");
}

export async function signInWithEmail(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email || !email.includes("@")) redirect("/login?error=email");
  let user = getDb().users.find((u) => u.email.toLowerCase() === email);
  if (!user) {
    user = mutate((db) => {
      const u = { id: newId("user"), email, createdAt: nowIso() };
      db.users.push(u);
      return u;
    });
  }
  await signInAs(user.id);
}

export async function signOut() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  redirect("/");
}

export async function completeOnboarding(formData: FormData) {
  const uid = await getSessionUserId();
  if (!uid) redirect("/login");
  const displayName = String(formData.get("displayName") ?? "").trim();
  const position = String(formData.get("position") ?? "").trim() || undefined;
  const claimProfileId = String(formData.get("claimProfileId") ?? "");
  if (!displayName) redirect("/onboarding?error=name");

  mutate((db) => {
    const existing = db.playerProfiles.find((p) => p.userId === uid);
    if (existing) {
      existing.displayName = displayName;
      existing.position = position;
      return;
    }
    // A player may already exist on rosters (booked via an organiser) without an account: claim it.
    const claim = claimProfileId ? db.playerProfiles.find((p) => p.id === claimProfileId && !p.userId) : null;
    if (claim) {
      claim.userId = uid;
      claim.displayName = displayName;
      claim.position = position;
      return;
    }
    const handleBase = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "player";
    let handle = handleBase;
    let n = 1;
    while (db.playerProfiles.some((p) => p.handle === handle)) handle = `${handleBase}${++n}`;
    db.playerProfiles.push({ id: newId("player"), userId: uid, displayName, handle, position, createdAt: nowIso() });
  });
  redirect("/home");
}
