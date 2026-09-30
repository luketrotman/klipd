import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/auth/session";
import { sendPushToUser } from "@/lib/push/server";

/** Sends a test notification to the signed-in user's own devices. */
export async function POST() {
  const uid = await getSessionUserId();
  if (!uid) return new NextResponse("Sign in first", { status: 401 });
  const delivered = await sendPushToUser(uid, { title: "KLIPD notifications are on", body: "This is how you will hear when your KLIPs are ready.", url: "/home", tag: "test" });
  return NextResponse.json({ delivered });
}
