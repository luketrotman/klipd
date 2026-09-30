"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, mutate, newId, nowIso } from "@/lib/db/store";
import { SESSION_COOKIE, demoLoginEnabled, getSessionUserId, setSessionCookie } from "@/lib/auth/session";
import { allowMagicRequest, appUrl, consumeMagicToken, issueMagicToken } from "@/lib/auth/magic";
import { sendSignInEmail } from "@/lib/auth/email";

/** Development only: sign in as a seeded demo player. Disabled in production unless DEMO_LOGIN=1. */
export async function signInAs(userId: string) {
  if (!demoLoginEnabled()) redirect("/login");
  const user = getDb().users.find((u) => u.id === userId);
  if (!user) redirect("/login?error=unknown");
  await setSessionCookie(userId);
  const profile = getDb().playerProfiles.find((p) => p.userId === userId);
  redirect(profile ? "/home" : "/onboarding");
}

export async function requestMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) redirect("/login?error=email");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!allowMagicRequest(`${email}|${ip}`)) redirect("/login?error=rate");
  const link = `${appUrl()}/auth/verify?token=${encodeURIComponent(issueMagicToken(email))}`;
  let devLink: string | undefined;
  try {
    devLink = (await sendSignInEmail(email, link)).devLink;
  } catch (e) {
    console.error("[auth] sign-in email failed", e);
    redirect("/login?error=send");
  }
  const jar = await cookies();
  if (devLink) jar.set("klipd_devlink", devLink, { maxAge: 900, path: "/login", httpOnly: true, sameSite: "lax" });
  redirect(`/login?sent=${encodeURIComponent(email)}`);
}

/** POST from the verify page (a button, so email-scanner prefetches cannot burn the link). */
export async function consumeLink(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const r = consumeMagicToken(token);
  if (!r.ok) redirect(`/login?error=${r.reason}`);
  await setSessionCookie(r.user.id);
  const profile = getDb().playerProfiles.find((p) => p.userId === r.user.id);
  redirect(profile ? "/home" : "/onboarding");
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
    const claim = claimProfileId ? db.playerProfiles.find((p) => p.id === claimProfileId && !p.userId) : null;
    if (claim) {
      claim.userId = uid;
      claim.displayName = displayName;
      claim.position = position;
      return;
    }
    const email = db.users.find((u) => u.id === uid)?.email;
    const handleBase = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 16) || "player";
    let handle = handleBase;
    let n = 1;
    while (db.playerProfiles.some((p) => p.handle === handle)) handle = `${handleBase}${++n}`;
    db.playerProfiles.push({ id: newId("player"), userId: uid, email, displayName, handle, position, createdAt: nowIso() });
  });
  redirect("/home");
}
