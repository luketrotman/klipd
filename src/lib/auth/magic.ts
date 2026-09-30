import { getDb, mutate, newId, nowIso } from "../db/store";
import type { User } from "../domain/types";
import { b64url, fromB64url, hmac, randomId, safeEqual } from "./crypto";

const LINK_MINUTES = 15;

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3010").replace(/\/$/, "");
}

/** Signed one-time token: base64url(email|exp|nonce).hmac */
export function issueMagicToken(email: string): string {
  const body = b64url(`${email}|${Date.now() + LINK_MINUTES * 60_000}|${randomId(9)}`);
  return `${body}.${hmac(`magic:${body}`)}`;
}

export type ConsumeResult = { ok: true; user: User; isNew: boolean } | { ok: false; reason: "invalid" | "expired" | "used" };

export function consumeMagicToken(token: string): ConsumeResult {
  const [body, sig] = token.split(".");
  if (!body || !sig || !safeEqual(sig, hmac(`magic:${body}`))) return { ok: false, reason: "invalid" };
  const [email, exp, nonce] = fromB64url(body).split("|");
  if (!email || !nonce || Number(exp) < Date.now()) return { ok: false, reason: "expired" };
  const db = getDb();
  if (db.authNonces?.some((n) => n.id === nonce)) return { ok: false, reason: "used" };
  const isAdminEmail = (process.env.ADMIN_EMAILS ?? "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean).includes(email);
  return mutate((d) => {
    d.authNonces = [...(d.authNonces ?? []).slice(-500), { id: nonce, usedAt: nowIso() }];
    let user = d.users.find((u) => u.email.toLowerCase() === email);
    let isNew = false;
    if (!user) {
      user = { id: newId("user"), email, createdAt: nowIso(), isAdmin: isAdminEmail || undefined };
      d.users.push(user);
      isNew = true;
    } else if (isAdminEmail && !user.isAdmin) {
      user.isAdmin = true;
    }
    // A booked player signing in with the email the organiser has on file claims that profile.
    const profile = d.playerProfiles.find((p) => p.email?.toLowerCase() === email && !p.userId);
    if (profile && !d.playerProfiles.some((p) => p.userId === user!.id)) profile.userId = user.id;
    return { ok: true as const, user, isNew };
  });
}

/** Naive in-memory limiter: 5 link requests per address per 15 minutes. */
const hits = new Map<string, number[]>();
export function allowMagicRequest(key: string): boolean {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < LINK_MINUTES * 60_000);
  if (arr.length >= 5) return false;
  arr.push(now);
  hits.set(key, arr);
  return true;
}
