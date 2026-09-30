import fs from "node:fs";
import path from "node:path";
import type { Klip } from "../domain/types";
import { mediaRoot } from "../storage";

/**
 * Is this KLIP's rendered MP4 actually available? Local media lives in public/media and is not
 * committed to git, so a fresh clone has database rows pointing at files that do not exist.
 * Remote (http) URLs are assumed to be fine.
 */
export function klipFileOk(k: Klip): boolean {
  if (k.status !== "RENDERED" || !k.clipUrl) return false;
  if (/^https?:\/\//.test(k.clipUrl) && !k.clipUrl.includes("localhost")) return true;
  const rel = k.clipUrl.replace(/^https?:\/\/[^/]+/, "");
  if (!rel.startsWith("/media/")) return true;
  return fs.existsSync(path.join(mediaRoot(), rel.slice("/media/".length)));
}
