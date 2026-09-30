import fs from "node:fs";
import { NextResponse } from "next/server";
import { rejectUnlessWorker } from "@/lib/worker/auth";
import { getDb, mutate } from "@/lib/db/store";
import { getStorage } from "@/lib/storage";

const MAX_BYTES = 60 * 1024 * 1024;

/** PUT /api/worker/klips/<id>?kind=clip|thumb with the raw file as the body. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = rejectUnlessWorker(req);
  if (denied) return denied;
  const { id } = await params;
  const kind = new URL(req.url).searchParams.get("kind") === "thumb" ? "thumb" : "clip";
  const klip = getDb().klips.find((k) => k.id === id);
  if (!klip) return new NextResponse("No such KLIP", { status: 404 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (!buf.length || buf.length > MAX_BYTES) return new NextResponse("Bad file size", { status: 413 });
  const storage = getStorage();
  const key = `klips/${id}.${kind === "clip" ? "mp4" : "jpg"}`;
  const local = storage.localPathFor ? storage.localPathFor(key) : null;
  if (!local) return new NextResponse("Storage provider cannot accept uploads", { status: 501 });
  fs.writeFileSync(local, buf);
  const url = await storage.putFile(local, key);
  mutate((db) => {
    const k = db.klips.find((x) => x.id === id);
    if (!k) return;
    if (kind === "clip") Object.assign(k, { status: "RENDERED", clipUrl: url });
    else k.thumbnailUrl = url;
  });
  return NextResponse.json({ ok: true, url });
}
