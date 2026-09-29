import type { Video, VideoProviderKey } from "../domain/types";
import type { VideoProvider } from "./provider";
import { VimeoVideoProvider } from "./vimeo";

const registry: Partial<Record<VideoProviderKey, VideoProvider>> = {
  vimeo: new VimeoVideoProvider(),
};

export function getVideoProvider(key: VideoProviderKey): VideoProvider {
  const p = registry[key];
  if (!p) throw new Error(`No VideoProvider registered for "${key}"`);
  return p;
}

export function providerFor(video: Video): VideoProvider {
  return getVideoProvider(video.provider);
}

export * from "./provider";
