import { NextResponse } from "next/server";
import { rejectUnlessWorker } from "@/lib/worker/auth";
import { getDb } from "@/lib/db/store";
import { appendJobLog } from "@/lib/ai/pipeline";

/** Progress line from a worker; shown in the admin processing log. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = rejectUnlessWorker(req);
  if (denied) return denied;
  const { id } = await params;
  const job = (getDb().workerJobs ?? []).find((j) => j.id === id);
  if (!job) return new NextResponse("No such job", { status: 404 });
  const { message } = (await req.json().catch(() => ({}))) as { message?: string };
  if (message) appendJobLog(job.matchId, `[worker] ${message.slice(0, 300)}`);
  return NextResponse.json({ ok: true });
}
