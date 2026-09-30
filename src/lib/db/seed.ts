/**
 * Seed data for the KLIPD MVP.
 *
 * Three real Vimeo recordings of small sided games are treated as KLIPD matches.
 * Events on matches 1 and 2 are MANUAL labels (the kind an admin creates in the
 * event editor). Match 3 is mid-pipeline to exercise the processing UI.
 *
 * Timestamps are seconds into each video.
 */
import type {
  Database,
  EventType,
  Klip,
  MatchEvent,
  EventPlayer,
  Team,
  TrackedPlayer,
  PlayerLink,
} from "../domain/types";

const T0 = "2026-09-01T09:00:00.000Z";

type MomentSpec = {
  id: string;
  type: EventType;
  t: number; // moment timestamp (seconds)
  lead?: number; // seconds before moment (default 8)
  tail?: number; // seconds after moment (default 7)
  player: string; // profile id of PRIMARY
  assist?: string; // profile id credited with ASSIST role (for goals)
  team: Team;
  title?: string;
};

function buildMoments(matchId: string, videoId: string, specs: MomentSpec[], createdAt: string) {
  const events: MatchEvent[] = [];
  const eventPlayers: EventPlayer[] = [];
  const klips: Klip[] = [];
  for (const s of specs) {
    const lead = s.lead ?? 8;
    const tail = s.tail ?? 7;
    const eventId = `evt_${matchId.replace("match_", "")}_${s.id}`;
    events.push({
      id: eventId,
      matchId,
      videoId,
      type: s.type,
      timestamp: s.t,
      startTime: Math.max(0, s.t - lead),
      endTime: s.t + tail,
      confidence: 1,
      team: s.team,
      source: "MANUAL",
      metadata: { demo: true, ...(s.title ? { title: s.title } : {}) }, // demo: hand-written, not verified against footage
      createdAt,
    });
    eventPlayers.push({ id: `${eventId}_p1`, eventId, playerId: s.player, trackedPlayerId: null, role: "PRIMARY" });
    if (s.assist) {
      eventPlayers.push({ id: `${eventId}_p2`, eventId, playerId: s.assist, trackedPlayerId: null, role: "ASSIST" });
    }
    klips.push({
      id: `klip_${matchId.replace("match_", "")}_${s.id}`,
      matchId,
      eventId,
      videoId,
      startTime: Math.max(0, s.t - lead),
      endTime: s.t + tail,
      title: s.title ?? null,
      status: "VIRTUAL",
      clipUrl: null,
      thumbnailUrl: null,
      createdAt,
    });
  }
  return { events, eventPlayers, klips };
}

/** "demo": the three test matches, demo players and moments. "empty": reference data only (venues, pitches, cameras, providers). */
export type SeedMode = "demo" | "empty";
export function defaultSeedMode(): SeedMode {
  if (process.env.SEED_MODE === "demo" || process.env.SEED_MODE === "empty") return process.env.SEED_MODE;
  return process.env.NODE_ENV === "production" ? "empty" : "demo";
}

export function buildSeed(mode: SeedMode = defaultSeedMode()): Database {
  const full = buildDemoSeed();
  if (mode === "demo") return full;
  return {
    ...full,
    users: [], playerProfiles: [], matches: [], matchPlayers: [], videos: [], processingJobs: [], trackedPlayers: [], playerLinks: [],
    events: [], eventPlayers: [], klips: [], klipViews: [], klipLikes: [], klipShares: [], notifications: [],
  };
}

function buildDemoSeed(): Database {
  const users = [
    { id: "user_luke", email: "luke@klipd.app", createdAt: T0, isAdmin: true },
    { id: "user_james", email: "james@klipd.app", createdAt: T0 },
    { id: "user_tom", email: "tom@klipd.app", createdAt: T0 },
    { id: "user_ben", email: "ben@klipd.app", createdAt: T0 },
  ];

  const names: Array<[string, string, string, string?]> = [
    ["luke", "Luke Trotman", "luketrotman", "Forward"],
    ["james", "James Okafor", "jokafor", "Midfield"],
    ["tom", "Tom Reilly", "treilly", "Defence"],
    ["adam", "Adam Kaur", "adamk", "Midfield"],
    ["sam", "Sam Whitfield", "samwhit", "Goalkeeper"],
    ["ben", "Ben Osei", "benosei", "Forward"],
    ["alex", "Alex Nowak", "anowak", "Midfield"],
    ["dan", "Dan Murphy", "danmurphy", "Defence"],
    ["chris", "Chris Adeyemi", "cadeyemi", "Forward"],
    ["joe", "Joe Lindqvist", "joelind", "Goalkeeper"],
    ["ollie", "Ollie Grant", "olliegrant", "Midfield"],
    ["marcus", "Marcus Hale", "mhale", "Defence"],
  ];
  const userFor: Record<string, string> = { luke: "user_luke", james: "user_james", tom: "user_tom", ben: "user_ben" };
  const playerProfiles = names.map(([key, displayName, handle, position]) => ({
    id: `player_${key}`,
    userId: userFor[key] ?? null,
    displayName,
    handle,
    position,
    createdAt: T0,
  }));

  const venues = [
    {
      id: "venue_battersea",
      name: "Powerleague Battersea",
      slug: "powerleague-battersea",
      address: "Battersea Park, Queenstown Rd",
      city: "London",
    },
  ];
  const pitches = [1, 2, 3, 4].map((n) => ({
    id: `pitch_battersea_${n}`,
    venueId: "venue_battersea",
    name: `Pitch ${n}`,
    format: (n === 2 ? "6v6" : "5v5") as "5v5" | "6v6",
    surface: "3G",
  }));
  const cameras = pitches.map((p, i) => ({
    id: `cam_battersea_${i + 1}`,
    pitchId: p.id,
    label: `${p.name} camera`,
    kind: "FIXED" as const,
    status: (i === 3 ? "OFFLINE" : "ONLINE") as "ONLINE" | "OFFLINE",
  }));

  const organisers = [{ id: "org_footy_addicts", name: "Footy Addicts", slug: "footy-addicts" }];
  const bookingProviders = [
    { id: "bp_manual", key: "manual" as const, name: "Manual" },
    { id: "bp_footy_addicts", key: "footy_addicts" as const, name: "Footy Addicts" },
  ];

  /* ---------------- Match 1: Tuesday 5s (READY) ---------------- */
  const m1 = "match_tue5s";
  const v1 = "video_tue5s";
  const m1Home = ["luke", "james", "tom", "adam", "sam"];
  const m1Away = ["ben", "alex", "dan", "chris", "joe"];

  const m1Luke: MomentSpec[] = [
    { id: "g1", type: "GOAL", t: 1122, player: "player_luke", assist: "player_james", team: "HOME", title: "Far post finish" },
    { id: "g2", type: "GOAL", t: 1865, player: "player_luke", assist: "player_adam", team: "HOME", title: "First time strike" },
    { id: "a1", type: "ASSIST", t: 557, player: "player_luke", team: "HOME", title: "Cut back for James" },
    { id: "s1", type: "SKILL", t: 273, player: "player_luke", team: "HOME", title: "Drag back and turn" },
    { id: "s2", type: "NUTMEG", t: 890, player: "player_luke", team: "HOME", title: "Nutmeg on the wing" },
    { id: "s3", type: "DRIBBLE", t: 1572, player: "player_luke", team: "HOME", title: "Beats two in the corner" },
    { id: "sh1", type: "SHOT", t: 168, player: "player_luke", team: "HOME" },
    { id: "sh2", type: "SHOT", t: 740, player: "player_luke", team: "HOME" },
    { id: "sh3", type: "SHOT", t: 1351, player: "player_luke", team: "HOME", title: "Off the bar" },
    { id: "sh4", type: "SHOT", t: 2144, player: "player_luke", team: "HOME" },
    { id: "d1", type: "TACKLE", t: 425, player: "player_luke", team: "HOME" },
    { id: "d2", type: "INTERCEPTION", t: 1720, player: "player_luke", team: "HOME" },
    { id: "o1", type: "KEY_PASS", t: 970, player: "player_luke", team: "HOME" },
    { id: "o2", type: "CELEBRATION", t: 1874, lead: 3, tail: 8, player: "player_luke", team: "HOME", title: "Knee slide" },
  ];

  // Remaining goals so the labelled goals match the 12-9 scoreline.
  const m1Goals: Array<[string, number, string | undefined, Team]> = [
    ["james", 130, "adam", "HOME"],
    ["ben", 240, "alex", "AWAY"],
    ["james", 566, "luke", "HOME"], // Luke's assist
    ["tom", 640, undefined, "HOME"],
    ["alex", 705, "ben", "AWAY"],
    ["dan", 812, undefined, "AWAY"],
    ["tom", 1010, "james", "HOME"],
    ["ben", 1180, undefined, "AWAY"],
    ["adam", 1265, undefined, "HOME"],
    ["chris", 1400, "dan", "AWAY"],
    ["james", 1480, undefined, "HOME"],
    ["alex", 1610, undefined, "AWAY"],
    ["tom", 1690, "sam", "HOME"],
    ["ben", 1790, "chris", "AWAY"],
    ["adam", 1950, undefined, "HOME"],
    ["dan", 2040, "alex", "AWAY"],
    ["james", 2210, undefined, "HOME"],
    ["joe", 2260, undefined, "AWAY"],
    ["sam", 2320, undefined, "HOME"],
  ];
  const m1Others: MomentSpec[] = m1Goals.map(([p, t, a, team], i) => ({
    id: `og${i + 1}`,
    type: "GOAL",
    t,
    player: `player_${p}`,
    assist: a ? `player_${a}` : undefined,
    team,
  }));
  m1Others.push(
    { id: "ox1", type: "SAVE", t: 380, player: "player_sam", team: "HOME", title: "Point blank save" },
    { id: "ox2", type: "SAVE", t: 1530, player: "player_joe", team: "AWAY" },
    { id: "ox3", type: "NUTMEG", t: 1300, player: "player_ben", team: "AWAY" },
    { id: "ox4", type: "FUNNY_MOMENT", t: 2005, player: "player_dan", team: "AWAY", title: "Air shot" },
    { id: "ox5", type: "BLOCK", t: 1105, player: "player_tom", team: "HOME" },
  );
  const m1Built = buildMoments(m1, v1, [...m1Luke, ...m1Others], "2026-09-15T21:20:00.000Z");

  /* ---------------- Match 2: Thursday 5s (READY, mock pipeline ran) ---------------- */
  const m2 = "match_thu5s";
  const v2 = "video_thu5s";
  const m2Home = ["luke", "james", "tom", "sam", "joe"];
  const m2Away = ["ben", "alex", "dan", "chris", "adam"];
  const m2Specs: MomentSpec[] = [
    { id: "g1", type: "GOAL", t: 1488, player: "player_luke", assist: "player_tom", team: "HOME", title: "Toe poke" },
    { id: "a1", type: "ASSIST", t: 318, player: "player_luke", team: "HOME" },
    { id: "a2", type: "ASSIST", t: 1930, player: "player_luke", team: "HOME" },
    { id: "s1", type: "NUTMEG", t: 655, player: "player_luke", team: "HOME" },
    { id: "sh1", type: "SHOT", t: 210, player: "player_luke", team: "HOME" },
    { id: "sh2", type: "SHOT", t: 1100, player: "player_luke", team: "HOME" },
    { id: "d1", type: "BLOCK", t: 2210, player: "player_luke", team: "HOME" },
    { id: "d2", type: "TACKLE", t: 840, player: "player_luke", team: "HOME" },
    { id: "o1", type: "FUNNY_MOMENT", t: 1775, player: "player_luke", team: "HOME", title: "Slips on the turn" },
    { id: "og1", type: "GOAL", t: 326, player: "player_james", assist: "player_luke", team: "HOME" },
    { id: "og2", type: "GOAL", t: 520, player: "player_ben", team: "AWAY" },
    { id: "og3", type: "GOAL", t: 760, player: "player_alex", assist: "player_dan", team: "AWAY" },
    { id: "og4", type: "GOAL", t: 990, player: "player_tom", team: "HOME" },
    { id: "og5", type: "GOAL", t: 1240, player: "player_chris", team: "AWAY" },
    { id: "og6", type: "GOAL", t: 1660, player: "player_adam", assist: "player_ben", team: "AWAY" },
    { id: "og7", type: "GOAL", t: 1938, player: "player_james", assist: "player_luke", team: "HOME" },
    { id: "og8", type: "GOAL", t: 2120, player: "player_ben", team: "AWAY" },
    { id: "og9", type: "GOAL", t: 2380, player: "player_dan", team: "AWAY" },
    { id: "ox1", type: "SAVE", t: 1410, player: "player_joe", team: "HOME" },
    { id: "ox2", type: "SKILL", t: 600, player: "player_chris", team: "AWAY", title: "Rainbow flick" },
  ];
  const m2Built = buildMoments(m2, v2, m2Specs, "2026-09-17T21:15:00.000Z");

  // Match 2 was processed by the MOCK pipeline: tracked players exist and Luke self-claimed "Player 03".
  const m2Tracked: TrackedPlayer[] = Array.from({ length: 10 }, (_, i) => ({
    id: `trk_thu5s_${String(i + 1).padStart(2, "0")}`,
    matchId: m2,
    label: `Player ${String(i + 1).padStart(2, "0")}`,
    team: (i < 5 ? "HOME" : "AWAY") as Team,
    shirtColour: i < 5 ? "blue" : "orange",
    shirtNumber: null,
    confidence: 0.9,
    engine: "MOCK",
  }));
  const m2Links: PlayerLink[] = [
    { id: "link_thu5s_03", trackedPlayerId: "trk_thu5s_03", playerId: "player_luke", method: "SELF_CLAIM", confidence: 1, createdAt: "2026-09-17T21:30:00.000Z" },
    { id: "link_thu5s_01", trackedPlayerId: "trk_thu5s_01", playerId: "player_james", method: "SELF_CLAIM", confidence: 1, createdAt: "2026-09-17T21:32:00.000Z" },
  ];

  /* ---------------- Match 3: Sunday 6s (mid pipeline) ---------------- */
  const m3 = "match_sun6s";
  const v3 = "video_sun6s";
  const m3Home = ["luke", "james", "adam", "ollie", "joe", "tom"];
  const m3Away = ["ben", "alex", "dan", "chris", "marcus", "sam"];

  const matches = [
    {
      id: m1,
      title: "Tuesday 5s",
      venueId: "venue_battersea",
      pitchId: "pitch_battersea_3",
      organiserId: "org_footy_addicts",
      bookingProviderId: "bp_footy_addicts",
      externalBookingRef: "fa_84213",
      kickoffAt: "2026-09-15T19:00:00.000Z", // 8:00 PM BST
      durationMinutes: 40,
      format: "5v5" as const,
      status: "READY" as const,
      homeTeam: { name: "Blue", colour: "#3b82f6" },
      awayTeam: { name: "Orange", colour: "#f97316" },
      score: { home: 12, away: 9 },
      videoId: v1,
      createdAt: "2026-09-14T10:00:00.000Z",
      publishedAt: "2026-09-15T21:20:00.000Z",
    },
    {
      id: m2,
      title: "Thursday 5s",
      venueId: "venue_battersea",
      pitchId: "pitch_battersea_1",
      organiserId: "org_footy_addicts",
      bookingProviderId: "bp_footy_addicts",
      externalBookingRef: "fa_84377",
      kickoffAt: "2026-09-17T19:00:00.000Z",
      durationMinutes: 40,
      format: "5v5" as const,
      status: "READY" as const,
      homeTeam: { name: "Blue", colour: "#3b82f6" },
      awayTeam: { name: "Orange", colour: "#f97316" },
      score: { home: 8, away: 10 },
      videoId: v2,
      createdAt: "2026-09-16T10:00:00.000Z",
      publishedAt: "2026-09-17T21:15:00.000Z",
    },
    {
      id: m3,
      title: "Sunday 6s",
      venueId: "venue_battersea",
      pitchId: "pitch_battersea_2",
      organiserId: "org_footy_addicts",
      bookingProviderId: "bp_footy_addicts",
      externalBookingRef: "fa_84590",
      kickoffAt: "2026-09-21T17:30:00.000Z",
      durationMinutes: 40,
      format: "6v6" as const,
      status: "GENERATING_KLIPS" as const,
      homeTeam: { name: "Blue", colour: "#3b82f6" },
      awayTeam: { name: "Orange", colour: "#f97316" },
      score: null,
      videoId: v3,
      createdAt: "2026-09-20T10:00:00.000Z",
    },
  ];

  const roster = (matchId: string, home: string[], away: string[]) => [
    ...home.map((p, i) => ({ id: `mp_${matchId}_${p}`, matchId, playerId: `player_${p}`, team: "HOME" as Team, shirtNumber: i + 1, source: "BOOKING" as const })),
    ...away.map((p, i) => ({ id: `mp_${matchId}_${p}`, matchId, playerId: `player_${p}`, team: "AWAY" as Team, shirtNumber: i + 1, source: "BOOKING" as const })),
  ];

  const videos = [
    {
      id: v1, matchId: m1, provider: "vimeo" as const, externalId: "938101072",
      sourceUrl: "https://vimeo.com/938101072", durationSeconds: 2356,
      thumbnailUrl: "https://i.vimeocdn.com/video/1839232466-ba5bfd8e61d60faf7cbff726ee81878e4848c40d1bcc762704eef08fc1a4530a-d_1280x720",
      width: 1920, height: 1080, cameraId: "cam_battersea_3", status: "AVAILABLE" as const,
    },
    {
      id: v2, matchId: m2, provider: "vimeo" as const, externalId: "932352844",
      sourceUrl: "https://vimeo.com/932352844", durationSeconds: 2494,
      thumbnailUrl: "https://i.vimeocdn.com/video/1830267498-b1598fe8e712bfa879f3ab1e050763f26a643e45f9c9f5dbaa9c04502f5cb6e0-d_1280x720",
      width: 1920, height: 1080, cameraId: "cam_battersea_1", status: "AVAILABLE" as const,
    },
    {
      id: v3, matchId: m3, provider: "vimeo" as const, externalId: "912465212",
      sourceUrl: "https://vimeo.com/912465212", durationSeconds: 2555,
      thumbnailUrl: "https://i.vimeocdn.com/video/1797737838-a28a7a1dd0a2aad62c593310736f280e43357429f241cbd3eded3d5c8c30d0d9-d_1280x720",
      width: 1920, height: 1080, cameraId: "cam_battersea_2", status: "AVAILABLE" as const,
    },
  ];

  const m3Jobs = (["UPLOADED", "PROCESSING", "PLAYER_DETECTION", "PLAYER_TRACKING", "EVENT_DETECTION", "GENERATING_KLIPS"] as const).map((stage, i) => ({
    id: `job_sun6s_${i}`,
    matchId: m3,
    stage,
    engine: "MOCK" as const,
    startedAt: new Date(Date.parse("2026-09-21T18:12:00.000Z") + i * 60_000).toISOString(),
    completedAt: stage === "GENERATING_KLIPS" ? null : new Date(Date.parse("2026-09-21T18:12:00.000Z") + (i + 1) * 60_000).toISOString(),
    log: [`${stage} started (MOCK engine)`],
  }));

  const notifications = [
    {
      id: "notif_1", userId: "user_luke", type: "KLIPS_READY" as const,
      title: "Your KLIPs are ready", body: "Thursday 5s · Powerleague Battersea · 9 moments found",
      matchId: m2, read: false, createdAt: "2026-09-17T21:16:00.000Z",
    },
    {
      id: "notif_2", userId: "user_luke", type: "MATCH_PROCESSING" as const,
      title: "Your match has finished", body: "Sunday 6s · Analysing the game",
      matchId: m3, read: true, createdAt: "2026-09-21T18:12:00.000Z",
    },
  ];

  const likes = [
    { id: "like_1", klipId: "klip_tue5s_g1", userId: "user_james", createdAt: "2026-09-15T22:00:00.000Z" },
    { id: "like_2", klipId: "klip_tue5s_g1", userId: "user_tom", createdAt: "2026-09-15T22:05:00.000Z" },
    { id: "like_3", klipId: "klip_tue5s_s2", userId: "user_ben", createdAt: "2026-09-15T22:10:00.000Z" },
  ];
  const shares = [
    { id: "share_1", klipId: "klip_tue5s_g1", userId: "user_luke", channel: "NATIVE" as const, createdAt: "2026-09-15T22:01:00.000Z" },
    { id: "share_2", klipId: "klip_tue5s_s2", userId: "user_luke", channel: "COPY_LINK" as const, createdAt: "2026-09-15T22:02:00.000Z" },
  ];
  const views = Array.from({ length: 23 }, (_, i) => ({
    id: `view_${i}`,
    klipId: i % 3 === 0 ? "klip_tue5s_g1" : i % 3 === 1 ? "klip_tue5s_s2" : "klip_thu5s_g1",
    userId: null,
    createdAt: "2026-09-16T08:00:00.000Z",
  }));

  return {
    users,
    playerProfiles,
    venues,
    pitches,
    cameras,
    organisers,
    bookingProviders,
    matches,
    matchPlayers: [...roster(m1, m1Home, m1Away), ...roster(m2, m2Home, m2Away), ...roster(m3, m3Home, m3Away)],
    videos,
    processingJobs: m3Jobs,
    trackedPlayers: m2Tracked,
    playerLinks: m2Links,
    events: [...m1Built.events, ...m2Built.events],
    eventPlayers: [...m1Built.eventPlayers, ...m2Built.eventPlayers],
    klips: [...m1Built.klips, ...m2Built.klips],
    klipViews: views,
    klipLikes: likes,
    klipShares: shares,
    notifications,
  };
}
