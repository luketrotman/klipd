import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { getViewer } from "@/lib/auth/session";

/** Serves annotated detection frames written by ai/run.py (admin only). */
export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const viewer = await getViewer();
  if (!viewer?.user.isAdmin) return new NextResponse("Forbidden", { status: 403 });
  const { name } = await params;
  if (!/^[\w.-]+\.jpg$/.test(name)) return new NextResponse("Bad name", { status: 400 });
  const file = path.join(process.cwd(), "ai", "debug", name);
  if (!fs.existsSync(file)) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(fs.readFileSync(file), { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
}
