import { NextResponse } from "next/server";
import { vapidPublicKey } from "@/lib/push/server";

export async function GET() {
  const key = vapidPublicKey();
  if (!key) return NextResponse.json({ configured: false }, { status: 200 });
  return NextResponse.json({ configured: true, key });
}
