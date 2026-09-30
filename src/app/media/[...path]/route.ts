import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { mediaRoot } from "@/lib/storage";

const TYPES: Record<string, string> = { ".mp4": "video/mp4", ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

/** Serves rendered clips and thumbnails from the media volume, with HTTP Range so phones can seek and stream. */
export async function GET(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const root = path.resolve(mediaRoot());
  const file = path.resolve(root, ...parts);
  if (!file.startsWith(root + path.sep)) return new NextResponse("Not found", { status: 404 });
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type || !fs.existsSync(file)) return new NextResponse("Not found", { status: 404 });
  const size = fs.statSync(file).size;
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=3600" };
  const range = req.headers.get("range");
  const m = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end || start >= size) return new NextResponse("Range not satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    const stream = Readable.toWeb(fs.createReadStream(file, { start, end })) as unknown as ReadableStream;
    return new NextResponse(stream, { status: 206, headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) } });
  }
  const stream = Readable.toWeb(fs.createReadStream(file)) as unknown as ReadableStream;
  return new NextResponse(stream, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
}
