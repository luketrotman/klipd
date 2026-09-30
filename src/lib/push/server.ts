/**
 * Web push delivery (VAPID). Needs VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
 * Without keys everything here is a safe no-op and the UI says notifications are not configured.
 */
import webpush from "web-push";
import { getDb, mutate } from "../db/store";

let configured: boolean | null = null;

export function pushConfigured(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return (configured = false);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:hello@klipd.app", pub, priv);
  return (configured = true);
}

export function vapidPublicKey(): string | null {
  return pushConfigured() ? process.env.VAPID_PUBLIC_KEY ?? null : null;
}

export interface PushPayload { title: string; body: string; url?: string; tag?: string }

/** Returns how many devices accepted the notification. Dead subscriptions (404/410) are removed. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!pushConfigured()) return 0;
  const subs = (getDb().pushSubscriptions ?? []).filter((s) => s.userId === userId);
  let ok = 0;
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 60 * 60 * 24 });
        ok++;
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
        else console.error("[push] send failed", code, (err as Error).message);
      }
    }),
  );
  if (dead.length) mutate((db) => { db.pushSubscriptions = (db.pushSubscriptions ?? []).filter((s) => !dead.includes(s.id)); });
  return ok;
}
