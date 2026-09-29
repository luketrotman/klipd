import type { Video } from "../domain/types";
import type { ClipRequest, ClipResult, PlaybackSource, VideoMetadata, VideoProvider } from "./provider";

/**
 * Vimeo implementation used for the MVP test footage.
 *
 * Vimeo cannot cut clips server-side on our plan, so createClip returns a
 * VIRTUAL clip: the player seeks to startTime and stops at endTime. A rendering
 * provider (Mux / ffmpeg worker) will return RENDERED clips with real files.
 */
export class VimeoVideoProvider implements VideoProvider {
  readonly key = "vimeo" as const;

  static parseExternalId(url: string): string | null {
    const m = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    return m ? m[1] : null;
  }

  async getVideoMetadata(externalId: string): Promise<VideoMetadata> {
    const res = await fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${externalId}`, {
      next: { revalidate: 3600 },
    });
    if (!res.ok) throw new Error(`Vimeo oEmbed failed: ${res.status}`);
    const j = (await res.json()) as {
      title: string;
      duration: number;
      thumbnail_url?: string;
      width?: number;
      height?: number;
    };
    return {
      externalId,
      title: j.title,
      durationSeconds: j.duration,
      thumbnailUrl: j.thumbnail_url ? j.thumbnail_url.replace(/_\d+x\d+/, "_1280x720") : null,
      width: j.width ?? null,
      height: j.height ?? null,
    };
  }

  getPlaybackUrl(video: Video, range?: { startTime: number; endTime: number }): PlaybackSource {
    const params = new URLSearchParams({
      autopause: "0",
      title: "0",
      byline: "0",
      portrait: "0",
      dnt: "1",
    });
    const hash = range ? `#t=${Math.floor(range.startTime)}s` : "";
    return {
      kind: "vimeo",
      externalId: video.externalId,
      embedUrl: `https://player.vimeo.com/video/${video.externalId}?${params.toString()}${hash}`,
      startTime: range?.startTime,
      endTime: range?.endTime,
    };
  }

  async createClip(req: ClipRequest): Promise<ClipResult> {
    return { status: "VIRTUAL", clipUrl: null, thumbnailUrl: this.getThumbnail(req.video) };
  }

  getThumbnail(video: Video): string | null {
    return video.thumbnailUrl;
  }
}
