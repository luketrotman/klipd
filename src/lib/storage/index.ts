/**
 * StorageProvider: where rendered clip files and thumbnails live.
 * Local (default): <DATA_DIR>/media/<key>, served by the app at /media/<key>.
 * Production: an S3/R2 provider with the same interface (set STORAGE_PROVIDER=s3).
 */
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "../db/store";

/** Rendered clips and thumbnails live here (a persistent volume in production) and are served at /media/*. */
export function mediaRoot(): string {
  return process.env.MEDIA_DIR ?? path.join(DATA_DIR, "media");
}

export interface StorageProvider {
  readonly key: string;
  /** Store a local file under `destKey`; returns the public URL. */
  putFile(localPath: string, destKey: string): Promise<string>;
  publicUrl(destKey: string): string;
  exists(destKey: string): boolean;
  /** Absolute local path a renderer can write to directly (local provider only). */
  localPathFor?(destKey: string): string;
}

class LocalStorage implements StorageProvider {
  readonly key = "local";
  private root = mediaRoot();
  localPathFor(destKey: string) {
    const p = path.join(this.root, destKey);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    return p;
  }
  async putFile(localPath: string, destKey: string) {
    const dest = this.localPathFor(destKey);
    if (path.resolve(localPath) !== path.resolve(dest)) fs.copyFileSync(localPath, dest);
    return this.publicUrl(destKey);
  }
  publicUrl(destKey: string) {
    const base = process.env.MEDIA_BASE_URL ?? "";
    return `${base}/media/${destKey}`;
  }
  exists(destKey: string) {
    return fs.existsSync(path.join(this.root, destKey));
  }
}

let instance: StorageProvider | null = null;
export function getStorage(): StorageProvider {
  if (!instance) {
    const which = process.env.STORAGE_PROVIDER ?? "local";
    if (which !== "local") throw new Error(`Storage provider "${which}" not implemented yet (local only)`);
    instance = new LocalStorage();
  }
  return instance;
}
