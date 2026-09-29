/**
 * ==========================  MOCK AI OUTPUT  ==========================
 * Nothing in this file looks at pixels. It produces deterministic, plausible
 * placeholder output so the product experience can be built and tested before
 * the computer vision pipeline exists. Every record it creates is tagged
 * engine "MOCK" and source "MOCK_AI", and the UI labels it as such.
 * =======================================================================
 */
import type { EventType, Team, Video, PlayerProfile } from "../domain/types";
import type {
  AiEngine,
  ClipGenerationService,
  DetectedEvent,
  DetectedPlayer,
  EventDetectionService,
  GeneratedClip,
  IdentitySuggestion,
  PlayerDetectionService,
  PlayerIdentificationService,
  PlayerTrackingService,
  TrackedPlayerResult,
} from "./services";

/** Small seeded PRNG so the same video always yields the same mock output. */
function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const label = (i: number) => `Player ${String(i + 1).padStart(2, "0")}`;

class MockPlayerDetection implements PlayerDetectionService {
  constructor(private playersPerTeam: number) {}
  async detectPlayers(video: Video): Promise<DetectedPlayer[]> {
    const r = rng(video.externalId + ":detect");
    const n = this.playersPerTeam * 2;
    return Array.from({ length: n }, (_, i) => ({
      label: label(i),
      team: (i < this.playersPerTeam ? "HOME" : "AWAY") as Team,
      shirtColour: i < this.playersPerTeam ? "blue" : "orange",
      shirtNumber: null,
      confidence: 0.82 + r() * 0.15,
    }));
  }
}

class MockPlayerTracking implements PlayerTrackingService {
  async trackPlayers(video: Video, detected: DetectedPlayer[]): Promise<TrackedPlayerResult[]> {
    const r = rng(video.externalId + ":track");
    return detected.map((d) => ({ ...d, coverageSeconds: Math.round(video.durationSeconds * (0.7 + r() * 0.28)) }));
  }
}

class MockPlayerIdentification implements PlayerIdentificationService {
  /** The mock can only use team membership. It suggests weak links that a human must confirm. */
  async identify(
    tracked: TrackedPlayerResult[],
    roster: Array<{ profile: PlayerProfile; team: Team; shirtNumber?: number }>,
  ): Promise<IdentitySuggestion[]> {
    const out: IdentitySuggestion[] = [];
    for (const team of ["HOME", "AWAY"] as Team[]) {
      const t = tracked.filter((x) => x.team === team);
      const rp = roster.filter((x) => x.team === team);
      t.forEach((tp, i) => {
        if (rp[i]) out.push({ trackedLabel: tp.label, playerId: rp[i].profile.id, method: "ROSTER", confidence: 0.2 });
      });
    }
    return out;
  }
}

const EVENT_MIX: Array<[EventType, number]> = [
  ["GOAL", 0.24],
  ["SHOT", 0.2],
  ["SAVE", 0.08],
  ["TACKLE", 0.1],
  ["INTERCEPTION", 0.06],
  ["DRIBBLE", 0.08],
  ["SKILL", 0.06],
  ["NUTMEG", 0.04],
  ["KEY_PASS", 0.06],
  ["BLOCK", 0.04],
  ["FUNNY_MOMENT", 0.02],
  ["CELEBRATION", 0.02],
];

class MockEventDetection implements EventDetectionService {
  async detectEvents(video: Video, tracked: TrackedPlayerResult[]): Promise<DetectedEvent[]> {
    const r = rng(video.externalId + ":events");
    const count = Math.round(video.durationSeconds / 75); // roughly one moment every 75s
    const events: DetectedEvent[] = [];
    let t = 60 + r() * 60;
    for (let i = 0; i < count && t < video.durationSeconds - 20; i++) {
      let pick = r();
      let type: EventType = "OTHER";
      for (const [et, w] of EVENT_MIX) {
        if (pick < w) {
          type = et;
          break;
        }
        pick -= w;
      }
      const primary = tracked[Math.floor(r() * tracked.length)];
      const others = tracked.filter((x) => x !== primary && x.team === primary.team);
      const secondary = type === "GOAL" && r() > 0.4 ? others[Math.floor(r() * others.length)] : null;
      events.push({
        type,
        timestamp: Math.round(t),
        startTime: Math.max(0, Math.round(t) - 8),
        endTime: Math.round(t) + 7,
        confidence: Math.round((0.55 + r() * 0.4) * 100) / 100,
        team: primary.team,
        trackedLabels: secondary ? [primary.label, secondary.label] : [primary.label],
      });
      t += 45 + r() * 70;
    }
    return events;
  }
}

class MockClipGeneration implements ClipGenerationService {
  async generateClips(events: DetectedEvent[]): Promise<GeneratedClip[]> {
    return events.map((e, i) => ({ eventIndex: i, startTime: e.startTime, endTime: e.endTime, title: null }));
  }
}

export function createMockEngine(playersPerTeam = 5): AiEngine {
  return {
    name: "MOCK",
    playerDetection: new MockPlayerDetection(playersPerTeam),
    playerTracking: new MockPlayerTracking(),
    playerIdentification: new MockPlayerIdentification(),
    eventDetection: new MockEventDetection(),
    clipGeneration: new MockClipGeneration(),
  };
}
