/**
 * VideoProvider abstraction.
 *
 * KLIPD must never be tightly coupled to Vimeo. Every place that needs to play,
 * cut or thumbnail footage goes through this interface. Implementations:
 *   - VimeoVideoProvider (MVP test footage)        src/lib/video/vimeo.ts
 *   - future: Mux, Cloudflare Stream, S3/venue camera storage, direct uploads
 */
import type { Video, VideoProviderKey } from "../domain/types";

export interface VideoMetadata {
  externalId: string;
  title: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
}

/** What a player component needs to render a video or a section of it. */
export type PlaybackSource =
  | { kind: "vimeo"; externalId: string; embedUrl: string; startTime?: number; endTime?: number }
  | { kind: "file"; src: string; mimeType: string; startTime?: number; endTime?: number };

export interface ClipRequest {
  video: Video;
  startTime: number;
  endTime: number;
}

export interface ClipResult {
  /** VIRTUAL: play the source between in/out points. RENDERED: a standalone file exists. */
  status: "VIRTUAL" | "RENDERED";
  clipUrl: string | null;
  thumbnailUrl: string | null;
}

export interface VideoProvider {
  readonly key: VideoProviderKey;
  getVideoMetadata(externalId: string): Promise<VideoMetadata>;
  getPlaybackUrl(video: Video, range?: { startTime: number; endTime: number }): PlaybackSource;
  createClip(req: ClipRequest): Promise<ClipResult>;
  getThumbnail(video: Video, atSeconds?: number): string | null;
}
