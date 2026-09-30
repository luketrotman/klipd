import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { mutate, newId, nowIso } from "@/lib/db/store";

export async function POST(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return new NextResponse("Sign in first", { status: 401 });
  const body = (await req.json().catch(() => null)) as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | null;
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth || !/^https:\/\//.test(body.endpoint)) return new NextResponse("Bad subscription", { status: 400 });
  const { endpoint, keys } = body;
  mutate((db) => {
    db.pushSubscriptions ??= [];
    const existing = db.pushSubscriptions.find((s) => s.endpoint === endpoint);
    if (existing) Object.assign(existing, { userId: uid, p256dh: keys.p256dh!, auth: keys.auth! });
    else db.pushSubscriptions.push({ id: newId("push"), userId: uid, endpoint, p256dh: keys.p256dh!, auth: keys.auth!, userAgent: req.headers.get("user-agent") ?? undefined, createdAt: nowIso() });
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const uid = await getSessionUserId();
  if (!uid) return new NextResponse("Sign in first", { status: 401 });
  const { endpoint } = (await req.json().catch(() => ({}))) as { endpoint?: string };
  mutate((db) => { db.pushSubscriptions = (db.pushSubscriptions ?? []).filter((s) => !(s.userId === uid && s.endpoint === endpoint)); });
  return NextResponse.json({ ok: true });
}
