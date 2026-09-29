/**
 * Read model for KLIPD. All functions are synchronous over the in-memory DB.
 * They return plain serialisable objects so server components can pass them to
 * client components directly.
 */
import { getDb } from "./store";
import {
  CATEGORY_OF,
  type Database,
  type EventPlayerRole,
  type Klip,
  type KlipCategory,
  type Match,
  type MatchEvent,
  type PlayerProfile,
  type TrackedPlayer,
  type Venue,
  type Video,
  type Pitch,
  type MatchPlayer,
  type ID,
} from "../domain/types";

export interface ResolvedEventPlayer {
  role: EventPlayerRole;
  profile: PlayerProfile | null;
  tracked: TrackedPlayer | null;
  label: string;
}

export interface KlipCardData {
  klip: Klip;
  event: MatchEvent;
  match: Match;
  venue: Venue;
  pitch: Pitch | null;
  video: Video;
  players: ResolvedEventPlayer[];
  primary: ResolvedEventPlayer | null;
  category: KlipCategory;
  likeCount: number;
  viewCount: number;
  shareCount: number;
  likedByMe: boolean;
}

function linkFor(db: Database, trackedPlayerId: ID): PlayerProfile | null {
  const link = db.playerLinks.find((l) => l.trackedPlayerId === trackedPlayerId);
  if (!link) return null;
  return db.playerProfiles.find((p) => p.id === link.playerId) ?? null;
}

export function resolveEventPlayers(db: Database, eventId: ID): ResolvedEventPlayer[] {
  return db.eventPlayers
    .filter((ep) => ep.eventId === eventId)
    .map((ep) => {
      const tracked = ep.trackedPlayerId ? db.trackedPlayers.find((t) => t.id === ep.trackedPlayerId) ?? null : null;
      const profile =
        (ep.playerId ? db.playerProfiles.find((p) => p.id === ep.playerId) : null) ??
        (tracked ? linkFor(db, tracked.id) : null);
      return {
        role: ep.role,
        profile,
        tracked,
        label: profile?.displayName ?? tracked?.label ?? "Unknown player",
      };
    });
}

/** Does this event involve the given player (directly or via a tracked-player link)? */
function eventInvolves(db: Database, eventId: ID, playerId: ID, roles: EventPlayerRole[] = ["PRIMARY"]): boolean {
  return resolveEventPlayers(db, eventId).some((p) => roles.includes(p.role) && p.profile?.id === playerId);
}

export function getKlipCard(klipId: ID, viewerUserId?: ID | null): KlipCardData | null {
  const db = getDb();
  const klip = db.klips.find((k) => k.id === klipId);
  if (!klip) return null;
  return buildCard(db, klip, viewerUserId ?? null);
}

function buildCard(db: Database, klip: Klip, viewerUserId: ID | null): KlipCardData | null {
  const event = db.events.find((e) => e.id === klip.eventId);
  const match = db.matches.find((m) => m.id === klip.matchId);
  const video = db.videos.find((v) => v.id === klip.videoId);
  if (!event || !match || !video) return null;
  const venue = db.venues.find((v) => v.id === match.venueId)!;
  const pitch = db.pitches.find((p) => p.id === match.pitchId) ?? null;
  const players = resolveEventPlayers(db, event.id);
  const primary = players.find((p) => p.role === "PRIMARY") ?? players[0] ?? null;
  return {
    klip,
    event,
    match,
    venue,
    pitch,
    video,
    players,
    primary,
    category: CATEGORY_OF[event.type],
    likeCount: db.klipLikes.filter((l) => l.klipId === klip.id).length,
    viewCount: db.klipViews.filter((v) => v.klipId === klip.id).length,
    shareCount: db.klipShares.filter((s) => s.klipId === klip.id).length,
    likedByMe: !!viewerUserId && db.klipLikes.some((l) => l.klipId === klip.id && l.userId === viewerUserId),
  };
}

function sortCards(cards: KlipCardData[]): KlipCardData[] {
  return cards.sort((a, b) => {
    const k = Date.parse(b.match.kickoffAt) - Date.parse(a.match.kickoffAt);
    return k !== 0 ? k : a.klip.startTime - b.klip.startTime;
  });
}

export function listKlipsForMatch(matchId: ID, viewerUserId?: ID | null): KlipCardData[] {
  const db = getDb();
  return db.klips
    .filter((k) => k.matchId === matchId)
    .map((k) => buildCard(db, k, viewerUserId ?? null))
    .filter((c): c is KlipCardData => !!c)
    .sort((a, b) => a.klip.startTime - b.klip.startTime);
}

export function listKlipsForPlayer(
  playerId: ID,
  opts: { matchId?: ID; category?: KlipCategory; viewerUserId?: ID | null; limit?: number } = {},
): KlipCardData[] {
  const db = getDb();
  const cards = db.klips
    .filter((k) => !opts.matchId || k.matchId === opts.matchId)
    .filter((k) => eventInvolves(db, k.eventId, playerId))
    .map((k) => buildCard(db, k, opts.viewerUserId ?? null))
    .filter((c): c is KlipCardData => !!c)
    .filter((c) => !opts.category || c.category === opts.category);
  const sorted = sortCards(cards);
  return opts.limit ? sorted.slice(0, opts.limit) : sorted;
}

export function categoryCounts(cards: KlipCardData[]): Array<{ category: KlipCategory; count: number }> {
  const order: KlipCategory[] = ["GOALS", "ASSISTS", "SKILLS", "SHOTS", "DEFENSIVE", "OTHER"];
  return order
    .map((category) => ({ category, count: cards.filter((c) => c.category === category).length }))
    .filter((c) => c.count > 0);
}

export interface PlayerStats {
  games: number;
  goals: number;
  assists: number;
  klips: number;
}

export function getPlayerStats(playerId: ID): PlayerStats {
  const db = getDb();
  const games = db.matchPlayers.filter((mp) => mp.playerId === playerId).length;
  const cards = listKlipsForPlayer(playerId);
  return {
    games,
    goals: cards.filter((c) => c.event.type === "GOAL").length,
    assists: cards.filter((c) => c.event.type === "ASSIST").length,
    klips: cards.length,
  };
}

export function getProfile(playerId: ID): PlayerProfile | null {
  return getDb().playerProfiles.find((p) => p.id === playerId) ?? null;
}

export function getProfileByUserId(userId: ID): PlayerProfile | null {
  return getDb().playerProfiles.find((p) => p.userId === userId) ?? null;
}

export function listProfiles(): PlayerProfile[] {
  return getDb().playerProfiles;
}

export interface MatchSummary {
  match: Match;
  venue: Venue;
  pitch: Pitch | null;
  video: Video | null;
  organiserName: string | null;
  playerCount: number;
  klipCount: number;
}

function summarise(db: Database, match: Match): MatchSummary {
  return {
    match,
    venue: db.venues.find((v) => v.id === match.venueId)!,
    pitch: db.pitches.find((p) => p.id === match.pitchId) ?? null,
    video: match.videoId ? db.videos.find((v) => v.id === match.videoId) ?? null : null,
    organiserName: match.organiserId ? db.organisers.find((o) => o.id === match.organiserId)?.name ?? null : null,
    playerCount: db.matchPlayers.filter((mp) => mp.matchId === match.id).length,
    klipCount: db.klips.filter((k) => k.matchId === match.id).length,
  };
}

export function listMatches(opts: { playerId?: ID } = {}): MatchSummary[] {
  const db = getDb();
  return db.matches
    .filter((m) => !opts.playerId || db.matchPlayers.some((mp) => mp.matchId === m.id && mp.playerId === opts.playerId))
    .sort((a, b) => Date.parse(b.kickoffAt) - Date.parse(a.kickoffAt))
    .map((m) => summarise(db, m));
}

export function getMatchSummary(matchId: ID): MatchSummary | null {
  const db = getDb();
  const m = db.matches.find((x) => x.id === matchId);
  return m ? summarise(db, m) : null;
}

export interface RosterEntry {
  matchPlayer: MatchPlayer;
  profile: PlayerProfile;
  klipCount: number;
  goals: number;
}

export interface TrackedEntry {
  tracked: TrackedPlayer;
  linkedProfile: PlayerProfile | null;
  linkMethod: string | null;
  eventCount: number;
}

export interface MatchDetail extends MatchSummary {
  roster: RosterEntry[];
  tracked: TrackedEntry[];
  jobs: Database["processingJobs"];
  klips: KlipCardData[];
}

export function getMatchDetail(matchId: ID, viewerUserId?: ID | null): MatchDetail | null {
  const db = getDb();
  const match = db.matches.find((m) => m.id === matchId);
  if (!match) return null;
  const klips = listKlipsForMatch(matchId, viewerUserId);
  const roster: RosterEntry[] = db.matchPlayers
    .filter((mp) => mp.matchId === matchId)
    .map((mp) => {
      const profile = db.playerProfiles.find((p) => p.id === mp.playerId)!;
      const mine = klips.filter((c) => c.primary?.profile?.id === mp.playerId);
      return { matchPlayer: mp, profile, klipCount: mine.length, goals: mine.filter((c) => c.event.type === "GOAL").length };
    })
    .sort((a, b) => (a.matchPlayer.team === b.matchPlayer.team ? b.klipCount - a.klipCount : a.matchPlayer.team === "HOME" ? -1 : 1));
  const tracked: TrackedEntry[] = db.trackedPlayers
    .filter((t) => t.matchId === matchId)
    .map((t) => {
      const link = db.playerLinks.find((l) => l.trackedPlayerId === t.id);
      return {
        tracked: t,
        linkedProfile: link ? db.playerProfiles.find((p) => p.id === link.playerId) ?? null : null,
        linkMethod: link?.method ?? null,
        eventCount: db.eventPlayers.filter((ep) => ep.trackedPlayerId === t.id).length,
      };
    });
  return {
    ...summarise(db, match),
    roster,
    tracked,
    jobs: db.processingJobs.filter((j) => j.matchId === matchId).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt)),
    klips,
  };
}

export function getVenueDetail(venueId: ID) {
  const db = getDb();
  const venue = db.venues.find((v) => v.id === venueId);
  if (!venue) return null;
  const pitches = db.pitches
    .filter((p) => p.venueId === venueId)
    .map((p) => ({ pitch: p, cameras: db.cameras.filter((c) => c.pitchId === p.id) }));
  const matches = listMatches().filter((m) => m.match.venueId === venueId);
  const klipCount = matches.reduce((n, m) => n + m.klipCount, 0);
  return { venue, pitches, matches, klipCount };
}

export function listVenues() {
  return getDb().venues;
}

export function listNotifications(userId: ID) {
  return getDb()
    .notifications.filter((n) => n.userId === userId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export function listAllEventsForMatch(matchId: ID) {
  const db = getDb();
  return db.events
    .filter((e) => e.matchId === matchId)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((event) => ({
      event,
      players: resolveEventPlayers(db, event.id),
      klip: db.klips.find((k) => k.eventId === event.id) ?? null,
    }));
}
