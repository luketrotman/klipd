import { EVENT_LABEL } from "./types";
import type { KlipCardData } from "../db/queries";

/** Human title for a KLIP, safe to use on server and client. */
export function klipTitle(c: KlipCardData): string {
  const who = c.primary?.label ?? "Player";
  const t = (c.klip.title ?? c.event.metadata.title) as string | undefined;
  return t ? `${who} · ${t}` : `${who} · ${EVENT_LABEL[c.event.type]}`;
}
