/**
 * KLIPD domain model.
 *
 * These types mirror the SQL schema in supabase/migrations/0001_init.sql.
 * The MVP persists them in a JSON file store (src/lib/db/store.ts); the shapes
 * are designed so a Supabase/Postgres repository can be dropped in later.
 */

export type ID = string;

export type MatchFormat = "5v5" | "6v6" | "7v7";

export const MATCH_STATUSES = [
  "SCHEDULED",
  "RECORDING",
  "UPLOADED",
  "PROCESSING",
  "PLAYER_DETECTION",
  "PLAYER_TRACKING",
  "EVENT_DETECTION",
  "GENERATING_KLIPS",
  "READY",
  "FAILED",
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const EVENT_TYPES = [
  "GOAL",
  "ASSIST",
  "SHOT",
  "SAVE",
  "TACKLE",
  "INTERCEPTION",
  "DRIBBLE",
  "SKILL",
  "NUTMEG",
  "KEY_PASS",
  "CHANCE_CREATED",
  "BLOCK",
  "CELEBRATION",
  "FUNNY_MOMENT",
  "MISTAKE",
  "OTHER",
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Where an event came from. Mock AI output is never presented as real detection. */
export type EventSource = "MANUAL" | "MOCK_AI" | "AI";

export type Team = "HOME" | "AWAY";

export interface User {
  id: ID;
  email: string;
  createdAt: string;
  isAdmin?: boolean;
}

export interface PlayerProfile {
  id: ID;
  /** Booked-player email from the organiser roster. Sign-in with this email claims the profile. */
  email?: string;
  userId: ID | null;
  displayName: string;
  handle: string;
  position?: string;
  avatarUrl?: string;
  bio?: string;
  createdAt: string;
}

export interface Venue {
  id: ID;
  name: string;
  slug: string;
  address: string;
  city: string;
}

export interface Pitch {
  id: ID;
  venueId: ID;
  name: string;
  format: MatchFormat;
  surface?: string;
}

export type CameraKind = "FIXED" | "VEO" | "CCTV" | "MOBILE" | "UPLOAD";

export interface Camera {
  id: ID;
  pitchId: ID;
  label: string;
  kind: CameraKind;
  status: "ONLINE" | "OFFLINE" | "UNKNOWN";
}

export interface Organiser {
  id: ID;
  name: string;
  slug: string;
}

export type BookingProviderKey = "manual" | "footy_addicts";

export interface BookingProviderRecord {
  id: ID;
  key: BookingProviderKey;
  name: string;
}

export interface TeamInfo {
  name: string;
  colour: string; // css colour
}

export interface Match {
  id: ID;
  title: string;
  venueId: ID;
  pitchId: ID;
  organiserId: ID | null;
  bookingProviderId: ID;
  externalBookingRef: string | null;
  kickoffAt: string; // ISO
  durationMinutes: number;
  format: MatchFormat;
  status: MatchStatus;
  homeTeam: TeamInfo;
  awayTeam: TeamInfo;
  score: { home: number; away: number } | null;
  videoId: ID | null;
  createdAt: string;
  /** When players were given access to this game's KLIPs. Null = still being checked. */
  publishedAt?: string | null;
  /** REVIEWED: only human-approved moments reach players. AUTO: AI calls at or above autoThreshold go out unreviewed. */
  publishMode?: "REVIEWED" | "AUTO";
  autoThreshold?: number;
}

export interface MatchPlayer {
  id: ID;
  matchId: ID;
  playerId: ID;
  team: Team;
  shirtNumber?: number;
  source: "BOOKING" | "MANUAL";
}

export type VideoProviderKey = "vimeo" | "mux" | "cloudflare" | "s3" | "upload";

export interface Video {
  id: ID;
  matchId: ID;
  provider: VideoProviderKey;
  externalId: string;
  sourceUrl: string;
  durationSeconds: number;
  thumbnailUrl: string | null;
  width: number | null;
  height: number | null;
  cameraId: ID | null;
  status: "PENDING" | "AVAILABLE" | "FAILED";
}

export interface ProcessingJob {
  id: ID;
  matchId: ID;
  stage: MatchStatus;
  engine: "MOCK" | "REAL";
  startedAt: string;
  completedAt: string | null;
  log: string[];
}

/** A player detected & tracked on the pitch, before we know who they are. */
export interface TrackedPlayer {
  id: ID;
  matchId: ID;
  label: string; // "Player 01"
  team: Team | null;
  shirtColour: string | null;
  shirtNumber: number | null;
  confidence: number;
  engine: "MOCK" | "REAL";
  /** Tracker fragment ids that make up this identity (from the CV run). Used to carry human labels across re-runs. */
  trackIds?: number[];
}

export type PlayerLinkMethod =
  | "SELF_CLAIM"
  | "MANUAL"
  | "ROSTER"
  | "SHIRT_NUMBER"
  | "SHIRT_COLOUR"
  | "APPEARANCE"
  | "FACE"
  | "PRE_GAME_CONFIRMATION";

export interface PlayerLink {
  id: ID;
  trackedPlayerId: ID;
  playerId: ID;
  method: PlayerLinkMethod;
  confidence: number;
  createdAt: string;
}

export interface MatchEvent {
  id: ID;
  matchId: ID;
  videoId: ID | null;
  type: EventType;
  timestamp: number; // seconds into the video where the moment happens
  startTime: number; // clip in point
  endTime: number; // clip out point
  confidence: number;
  team: Team | null;
  source: EventSource;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type EventPlayerRole = "PRIMARY" | "ASSIST" | "INVOLVED" | "OPPONENT";

export interface EventPlayer {
  id: ID;
  eventId: ID;
  playerId: ID | null;
  trackedPlayerId: ID | null;
  role: EventPlayerRole;
}

/**
 * A KLIP is a short video extracted from the full game.
 * VIRTUAL klips play from the source video between in/out points.
 * RENDERED klips have a standalone clipUrl produced by a VideoProvider.
 */
export interface Klip {
  id: ID;
  matchId: ID;
  eventId: ID;
  videoId: ID;
  startTime: number;
  endTime: number;
  title: string | null;
  status: "VIRTUAL" | "RENDERED";
  clipUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
}

export interface KlipView {
  id: ID;
  klipId: ID;
  userId: ID | null;
  createdAt: string;
}

export interface KlipLike {
  id: ID;
  klipId: ID;
  userId: ID;
  createdAt: string;
}

export type ShareChannel = "NATIVE" | "COPY_LINK" | "WHATSAPP" | "INSTAGRAM" | "TIKTOK" | "DOWNLOAD";

export interface KlipShare {
  id: ID;
  klipId: ID;
  userId: ID | null;
  channel: ShareChannel;
  createdAt: string;
}

export interface Notification {
  id: ID;
  userId: ID;
  type: "KLIPS_READY" | "MATCH_PROCESSING" | "TAG_REQUEST" | "GENERIC";
  title: string;
  body: string;
  matchId: ID | null;
  read: boolean;
  createdAt: string;
}

export interface PushSubscriptionRecord {
  id: ID;
  userId: ID;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
  createdAt: string;
}

/** A unit of work for an external processing worker (a Mac or GPU box running ai/worker.py). */
export interface WorkerJob {
  id: ID;
  type: "PROCESS" | "RENDER";
  matchId: ID;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  createdAt: string;
  claimedAt?: string | null;
  finishedAt?: string | null;
  workerId?: string | null;
  error?: string | null;
  /** RENDER: klips to cut. */
  klipIds?: ID[];
}

export interface Database {
  users: User[];
  playerProfiles: PlayerProfile[];
  venues: Venue[];
  pitches: Pitch[];
  cameras: Camera[];
  organisers: Organiser[];
  bookingProviders: BookingProviderRecord[];
  matches: Match[];
  matchPlayers: MatchPlayer[];
  videos: Video[];
  processingJobs: ProcessingJob[];
  trackedPlayers: TrackedPlayer[];
  playerLinks: PlayerLink[];
  events: MatchEvent[];
  eventPlayers: EventPlayer[];
  klips: Klip[];
  klipViews: KlipView[];
  klipLikes: KlipLike[];
  klipShares: KlipShare[];
  notifications: Notification[];
  /** Used one-time sign-in link ids, capped. */
  authNonces?: Array<{ id: string; usedAt: string }>;
  pushSubscriptions?: PushSubscriptionRecord[];
  workerJobs?: WorkerJob[];
}

/* ---------- Presentation helpers (pure, no IO) ---------- */

export type KlipCategory = "GOALS" | "ASSISTS" | "SKILLS" | "SHOTS" | "DEFENSIVE" | "OTHER";

export const CATEGORY_OF: Record<EventType, KlipCategory> = {
  GOAL: "GOALS",
  ASSIST: "ASSISTS",
  SKILL: "SKILLS",
  NUTMEG: "SKILLS",
  DRIBBLE: "SKILLS",
  SHOT: "SHOTS",
  CHANCE_CREATED: "SHOTS",
  SAVE: "DEFENSIVE",
  TACKLE: "DEFENSIVE",
  INTERCEPTION: "DEFENSIVE",
  BLOCK: "DEFENSIVE",
  KEY_PASS: "OTHER",
  CELEBRATION: "OTHER",
  FUNNY_MOMENT: "OTHER",
  MISTAKE: "OTHER",
  OTHER: "OTHER",
};

export const CATEGORY_LABEL: Record<KlipCategory, { singular: string; plural: string; emoji: string }> = {
  GOALS: { singular: "Goal", plural: "Goals", emoji: "⚽" },
  ASSISTS: { singular: "Assist", plural: "Assists", emoji: "🎯" },
  SKILLS: { singular: "Skill", plural: "Skills", emoji: "🔥" },
  SHOTS: { singular: "Shot", plural: "Shots", emoji: "🥅" },
  DEFENSIVE: { singular: "Defensive moment", plural: "Defensive moments", emoji: "🛡" },
  OTHER: { singular: "Other moment", plural: "Other moments", emoji: "🎥" },
};

export const EVENT_LABEL: Record<EventType, string> = {
  GOAL: "Goal",
  ASSIST: "Assist",
  SHOT: "Shot",
  SAVE: "Save",
  TACKLE: "Tackle",
  INTERCEPTION: "Interception",
  DRIBBLE: "Dribble",
  SKILL: "Skill",
  NUTMEG: "Nutmeg",
  KEY_PASS: "Key pass",
  CHANCE_CREATED: "Chance created",
  BLOCK: "Block",
  CELEBRATION: "Celebration",
  FUNNY_MOMENT: "Funny moment",
  MISTAKE: "Mistake",
  OTHER: "Moment",
};

export const STATUS_COPY: Record<MatchStatus, { title: string; detail: string }> = {
  SCHEDULED: { title: "Kick off soon", detail: "Camera assigned. Recording starts automatically at kick off." },
  RECORDING: { title: "Recording your game", detail: "The pitch camera is rolling." },
  UPLOADED: { title: "Your match has finished", detail: "Footage received. Queued for analysis." },
  PROCESSING: { title: "Analysing the game", detail: "Preparing the footage." },
  PLAYER_DETECTION: { title: "Finding players", detail: "Spotting everyone on the pitch." },
  PLAYER_TRACKING: { title: "Following the play", detail: "Tracking each player through the game." },
  EVENT_DETECTION: { title: "Finding your best moments", detail: "Goals, assists, skills, tackles and more." },
  GENERATING_KLIPS: { title: "Creating your KLIPs", detail: "Cutting every moment into a shareable clip." },
  READY: { title: "Your KLIPs are ready", detail: "Open your game to watch and share." },
  FAILED: { title: "Something went wrong", detail: "We couldn't process this game. Our team has been notified." },
};

/**
 * The product's trust rule: what a player is allowed to see.
 * Demo labels are always visible (seeded product demo). Everything else waits for the match
 * to be published, or for AUTO mode. AI calls need a human "correct" unless AUTO mode
 * lets confident, unreviewed calls through.
 */
export function eventVisibleToPlayers(event: MatchEvent, match: Match): boolean {
  if (event.metadata.demo === true) return true;
  const mode = match.publishMode ?? "REVIEWED";
  const released = !!match.publishedAt || mode === "AUTO";
  if (!released) return false;
  if (event.source === "MANUAL") return true;
  const review = event.metadata.review as string | undefined;
  if (review === "correct") return true;
  if (review) return false; // wrong / wrong_player / wrong_type
  return mode === "AUTO" && event.confidence >= (match.autoThreshold ?? 0.6);
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}
