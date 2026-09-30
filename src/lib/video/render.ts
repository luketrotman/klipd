/**
 * ffmpeg clip rendering. Produces a standalone MP4 (H.264, no audio) with the KLIPD
 * watermark, plus a JPEG thumbnail. Uses the Apple hardware encoder when present.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

let encoder: string | null = null;

export function ffmpegAvailable(): boolean {
  return spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;
}

function pickEncoder(): string {
  if (encoder) return encoder;
  const out = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout ?? "";
  encoder = process.env.FFMPEG_ENCODER ?? (out.includes("h264_videotoolbox") ? "h264_videotoolbox" : "libx264");
  return encoder;
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
    let err = "";
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${err.trim().slice(-400)}`))));
  });
}

export interface RenderClipArgs {
  sourcePath: string;
  startTime: number;
  endTime: number;
  outPath: string;
  watermarkPath?: string;
  /** Output height; source is scaled down to this (default 720) to keep files small for sharing. */
  height?: number;
}

export async function renderClipFile({ sourcePath, startTime, endTime, outPath, watermarkPath, height = 720 }: RenderClipArgs): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const dur = Math.max(1, endTime - startTime);
  const enc = pickEncoder();
  const quality = enc === "libx264" ? ["-preset", "veryfast", "-crf", "23"] : ["-b:v", "4M"];
  const wm = watermarkPath && fs.existsSync(watermarkPath) ? watermarkPath : null;
  const filter = wm
    ? `[0:v]scale=-2:${height}[v];[1:v]scale=-1:${Math.round(height * 0.1)}[wm];[v][wm]overlay=W-w-24:24`
    : `[0:v]scale=-2:${height}`;
  const args = ["-ss", startTime.toFixed(2), "-i", sourcePath, ...(wm ? ["-i", wm] : []), "-t", dur.toFixed(2), "-filter_complex", filter, "-c:v", enc, ...quality, "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", outPath];
  await run(args);
}

export async function renderThumbnail(sourcePath: string, at: number, outPath: string, width = 640): Promise<void> {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await run(["-ss", at.toFixed(2), "-i", sourcePath, "-frames:v", "1", "-vf", `scale=${width}:-2`, "-q:v", "4", outPath]);
}
