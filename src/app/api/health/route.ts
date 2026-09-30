import { NextResponse } from "next/server";
import { getDb } from "@/lib/db/store";

export async function GET() {
  try {
    getDb();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
