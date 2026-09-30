/**
 * LocalCvEngine: REAL computer vision, run locally.
 *
 * Executes ai/run.py (YOLO + ByteTrack + pitch mask + team clustering + rule-based
 * events) on the match video and adapts its JSON output to the AiEngine contracts.
 * One Python run per video is shared by all five services.
 *
 * Requirements: ai/.venv created with ultralytics + opencv (see README), the video
 * downloaded to ai/videos/<externalId>.mp4 (downloaded automatically for Vimeo).
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { EventType, MatchStatus, Team, Video } from "../domain/types";
import type { AiEngine, DetectedEvent, DetectedPlayer, GeneratedClip, IdentitySuggestion, TrackedPlayerResult } from "./services";

export interface CvOutput {
  engine: string;
  stats: Record<string, unknown>;
  teams: Array<{ index: number; colour: string }>;
  tracked: Array<{ label: string; team: number; colour: string | null; coverageSeconds: number; touches: number; possessionSeconds: number; confidence: number; trackIds?: number[] }>;
  events: Array<{ type: string; timestamp: number; startTime: number; endTime: number; confidence: number; team: number; trackedLabels: string[]; metadata: Record<string, unknown> }>;
  debugFrames: string[];
}

export interface LocalCvOptions {
  perTeam: number;
  fps?: number;
  imgsz?: number;
  model?: string;
  /** Analyse only part of the video (seconds). 0 = whole video. */
  duration?: number;
  start?: number;
  debugFrames?: number;
  /** Use this CV output instead of running the Python pipeline (results uploaded by a remote worker). */
  preloaded?: CvOutput;
  onLog?: (stage: MatchStatus, msg: string, progress?: number) => void;
}

const ROOT = process.cwd();
const PY = path.join(ROOT, "ai", ".venv", "bin", "python");
const YTDLP = path.join(ROOT, "ai", ".venv", "bin", "yt-dlp");
const VIDEOS = path.join(ROOT, "ai", "videos");
const OUTPUT = path.join(ROOT, "ai", "output");

export function localCvAvailable(): boolean {
  return fs.existsSync(PY) && fs.existsSync(path.join(ROOT, "ai", "run.py"));
}

function runCommand(cmd: string, args: string[], onLine?: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    let buf = "";
    let errTail = "";
    child.stdout.on("data", (d) => {
      buf += d.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) onLine?.(l);
    });
    child.stderr.on("data", (d) => {
      errTail = (errTail + d.toString()).slice(-2000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (buf.trim()) onLine?.(buf);
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(cmd)} exited with ${code}: ${errTail.trim().split("\n").slice(-3).join(" | ")}`));
    });
  });
}

export class LocalCvEngine implements AiEngine {
  readonly name = "REAL" as const;
  private runs = new Map<string, Promise<CvOutput>>();

  constructor(private readonly opts: LocalCvOptions) {}

  private log(stage: MatchStatus, msg: string, progress?: number) {
    this.opts.onLog?.(stage, msg, progress);
  }

  private async ensureVideo(video: Video): Promise<string> {
    fs.mkdirSync(VIDEOS, { recursive: true });
    const file = path.join(VIDEOS, `${video.externalId}.mp4`);
    if (fs.existsSync(file)) return file;
    if (video.provider !== "vimeo") throw new Error(`No local file for ${video.provider} video ${video.externalId}`);
    this.log("UPLOADED", `Downloading 1080p footage for Vimeo ${video.externalId}`);
    await runCommand(YTDLP, [
      "-q", "--no-warnings", "--referer", "https://vimeo.com/",
      "-f", "hls-fastly_skyfire-5731/hls-akfire_interconnect_quic-5731/bv*[height<=1080]",
      "-N", "8", "-o", file, `https://player.vimeo.com/video/${video.externalId}`,
    ]);
    if (!fs.existsSync(file)) throw new Error("Download finished but no file was written");
    return file;
  }

  private run(video: Video): Promise<CvOutput> {
    if (this.opts.preloaded) return Promise.resolve(this.opts.preloaded);
    const key = `${video.externalId}:${this.opts.start ?? 0}:${this.opts.duration ?? 0}`;
    let p = this.runs.get(key);
    if (!p) {
      p = (async () => {
        if (!localCvAvailable()) throw new Error("Local CV environment missing: create ai/.venv (see README)");
        const file = await this.ensureVideo(video);
        fs.mkdirSync(OUTPUT, { recursive: true });
        const out = path.join(OUTPUT, `${video.externalId}${this.opts.duration ? `_${this.opts.start ?? 0}_${this.opts.duration}` : ""}.json`);
        const args = [
          path.join(ROOT, "ai", "run.py"), "--video", file, "--out", out,
          "--fps", String(this.opts.fps ?? 5), "--imgsz", String(this.opts.imgsz ?? 1280),
          "--model", this.opts.model ?? "yolo11m.pt", "--per-team", String(this.opts.perTeam),
          "--start", String(this.opts.start ?? 0), "--duration", String(this.opts.duration ?? 0),
          "--debug-frames", String(this.opts.debugFrames ?? 0), "--tag", video.externalId,
          "--reuse", "--reid", "--calibration", path.join(ROOT, "ai", "calibration", `${video.externalId}.json`),
        ];
        await runCommand(PY, args, (line) => {
          try {
            const rec = JSON.parse(line) as { stage: MatchStatus; msg: string; progress?: number };
            this.log(rec.stage, rec.msg, rec.progress);
          } catch {
            this.log("PROCESSING", line.slice(0, 200));
          }
        });
        return JSON.parse(fs.readFileSync(out, "utf8")) as CvOutput;
      })();
      this.runs.set(key, p);
      p.catch(() => this.runs.delete(key));
    }
    return p;
  }

  /** Team index → side. Prefer calling the blue kit HOME because seeded matches are Blue vs Orange. */
  private side(out: CvOutput, idx: number): Team | null {
    if (idx !== 0 && idx !== 1) return null;
    const blue = out.teams.findIndex((t) => t.colour === "blue");
    const homeIdx = blue >= 0 ? blue : 0;
    return idx === homeIdx ? "HOME" : "AWAY";
  }

  playerDetection = {
    detectPlayers: async (video: Video): Promise<DetectedPlayer[]> => {
      const out = await this.run(video);
      return out.tracked.map((t) => ({ label: t.label, team: this.side(out, t.team), shirtColour: t.colour, shirtNumber: null, confidence: t.confidence, trackIds: t.trackIds }));
    },
  };

  playerTracking = {
    trackPlayers: async (video: Video, detected: DetectedPlayer[]): Promise<TrackedPlayerResult[]> => {
      const out = await this.run(video);
      return detected.map((d) => {
        const t = out.tracked.find((x) => x.label === d.label);
        return { ...d, coverageSeconds: t?.coverageSeconds ?? 0 };
      });
    },
  };

  playerIdentification = {
    /** v0 has no identity model. Players confirm themselves with "That's me"; the admin can link. */
    identify: async (): Promise<IdentitySuggestion[]> => [],
  };

  eventDetection = {
    detectEvents: async (video: Video): Promise<DetectedEvent[]> => {
      const out = await this.run(video);
      return out.events.map((e) => ({
        type: e.type as EventType,
        timestamp: e.timestamp,
        startTime: e.startTime,
        endTime: e.endTime,
        confidence: e.confidence,
        team: this.side(out, e.team),
        trackedLabels: e.trackedLabels,
        metadata: e.metadata,
      }));
    },
  };

  clipGeneration = {
    generateClips: async (events: DetectedEvent[]): Promise<GeneratedClip[]> =>
      events.map((e, i) => ({ eventIndex: i, startTime: e.startTime, endTime: e.endTime, title: null })),
  };
}
