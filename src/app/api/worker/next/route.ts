import { NextResponse } from "next/server";
import { rejectUnlessWorker } from "@/lib/worker/auth";
import { claimNext, finishJob, jobPayload } from "@/lib/worker/jobs";

export async function GET(req: Request) {
  const denied = rejectUnlessWorker(req);
  if (denied) return denied;
  const workerId = new URL(req.url).searchParams.get("worker") ?? "worker";
  const job = claimNext(workerId);
  if (!job) return NextResponse.json({ job: null });
  const payload = jobPayload(job);
  if (!payload) { finishJob(job.id, "Match or video no longer exists"); return NextResponse.json({ job: null }); }
  return NextResponse.json({ job: payload });
}
