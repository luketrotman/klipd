import { getDb, mutate, newId, nowIso } from "./db/store";
import { eventVisibleToPlayers } from "./domain/types";

/**
 * Release a game to its players: mark it published, notify every booked player who has an account,
 * and start rendering clip files for what they can now see. Returns how many players were notified.
 * Does nothing (returns 0) when the game is already published, so it can never notify twice.
 * Callers must have authorised the release (an admin, or Auto mode after processing).
 */
export async function releaseMatch(matchId: string): Promise<number> {
  const { sendPushToUser } = await import("./push/server");
  const { renderOrQueue } = await import("./worker/jobs");
  const targets = mutate((db) => {
    const m = db.matches.find((x) => x.id === matchId);
    if (!m) throw new Error("No match");
    if (m.publishedAt) return [];
    m.publishedAt = nowIso();
    const visibleEvents = new Set(db.events.filter((e) => e.matchId === matchId && eventVisibleToPlayers(e, m)).map((e) => e.id));
    const links = new Map(db.playerLinks.map((l) => [l.trackedPlayerId, l.playerId]));
    const perPlayer = new Map<string, number>();
    for (const ep of db.eventPlayers) {
      if (!visibleEvents.has(ep.eventId) || ep.role !== "PRIMARY") continue;
      const pid = ep.playerId ?? (ep.trackedPlayerId ? links.get(ep.trackedPlayerId) : null);
      if (pid) perPlayer.set(pid, (perPlayer.get(pid) ?? 0) + 1);
    }
    const out: Array<{ userId: string; count: number }> = [];
    for (const mp of db.matchPlayers.filter((x) => x.matchId === matchId)) {
      const profile = db.playerProfiles.find((p) => p.id === mp.playerId);
      if (!profile?.userId) continue;
      const count = perPlayer.get(mp.playerId) ?? 0;
      db.notifications.push({ id: newId("notif"), userId: profile.userId, type: "KLIPS_READY", title: count ? "Your KLIPs are ready" : "Your game is up", body: `${m.title} · ${count ? `${count} moments found` : "match highlights available"}`, matchId, read: false, createdAt: nowIso() });
      out.push({ userId: profile.userId, count });
    }
    return out;
  });
  await renderOrQueue(matchId).catch(() => {});
  const m = getDb().matches.find((x) => x.id === matchId);
  await Promise.all(targets.map((t) => sendPushToUser(t.userId, { title: t.count ? "Your KLIPs are ready" : "Your game is up", body: `${m?.title ?? "Your game"} · ${t.count ? `${t.count} moments` : "highlights"}`, url: `/matches/${matchId}` }).catch(() => 0)));
  return targets.length;
}
