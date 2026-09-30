import { NextResponse } from "next/server";
import { rejectUnlessWorker } from "@/lib/worker/auth";
import { finishJob } from "@/lib/worker/jobs";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = rejectUnlessWorker(req);
  if (denied) return denied;
  const { id } = await params;
  const { error } = (await req.json().catch(() => ({}))) as { error?: string };
  finishJob(id, error);
  return NextResponse.json({ ok: true });
}
