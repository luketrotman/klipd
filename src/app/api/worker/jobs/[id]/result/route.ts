import { NextResponse } from "next/server";
import { rejectUnlessWorker } from "@/lib/worker/auth";
import { getDb } from "@/lib/db/store";
import { finishJob } from "@/lib/worker/jobs";
import { ingestCvOutput } from "@/lib/ai/pipeline";
import type { CvOutput } from "@/lib/ai/local";

/** The worker posts the CV output JSON for a PROCESS job. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = rejectUnlessWorker(req);
  if (denied) return denied;
  const { id } = await params;
  const job = (getDb().workerJobs ?? []).find((j) => j.id === id);
  if (!job || job.type !== "PROCESS" || job.status !== "RUNNING") return new NextResponse("No such running PROCESS job", { status: 404 });
  const output = (await req.json().catch(() => null)) as CvOutput | null;
  if (!output || !Array.isArray(output.tracked) || !Array.isArray(output.events)) return new NextResponse("Bad CV output", { status: 400 });
  try {
    await ingestCvOutput(job.matchId, output);
    finishJob(id);
    return NextResponse.json({ ok: true, events: output.events.length, players: output.tracked.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    finishJob(id, msg);
    return new NextResponse(msg, { status: 500 });
  }
}
