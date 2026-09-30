import { NextResponse } from "next/server";
import { safeEqual } from "../auth/crypto";

/** Worker endpoints require `Authorization: Bearer <WORKER_TOKEN>`. Returns a response when the request must be rejected. */
export function rejectUnlessWorker(req: Request): NextResponse | null {
  const token = process.env.WORKER_TOKEN;
  if (!token || token.length < 16) return new NextResponse("Worker API is not configured (WORKER_TOKEN)", { status: 503 });
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!given || !safeEqual(given, token)) return new NextResponse("Unauthorized", { status: 401 });
  return null;
}
