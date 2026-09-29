/**
 * AI service contracts.
 *
 * The real product logic (matches, events, klips, identity links) lives in the
 * domain and query layers. These interfaces are the seam where computer vision
 * plugs in. The MVP ships MOCK implementations (src/lib/ai/mock.ts) whose output
 * is always tagged engine "MOCK" / source "MOCK_AI" and never presented as real
 * detection.
 */
import type { EventType, Team, Video, PlayerLinkMethod, PlayerProfile } from "../domain/types";

export interface DetectedPlayer {
  label: string;
  trackIds?: number[];
  team: Team | null;
  shirtColour: string | null;
  shirtNumber: number | null;
  confidence: number;
}

export interface TrackedPlayerResult extends DetectedPlayer {
  /** Seconds of the match the tracker kept a lock on this player. */
  coverageSeconds: number;
}

export interface IdentitySuggestion {
  trackedLabel: string;
  playerId: string;
  method: PlayerLinkMethod;
  confidence: number;
}

export interface DetectedEvent {
  type: EventType;
  timestamp: number;
  startTime: number;
  endTime: number;
  confidence: number;
  team: Team | null;
  trackedLabels: string[]; // PRIMARY first
  metadata?: Record<string, unknown>;
}

export interface GeneratedClip {
  eventIndex: number;
  startTime: number;
  endTime: number;
  title: string | null;
}

export interface PlayerDetectionService {
  detectPlayers(video: Video): Promise<DetectedPlayer[]>;
}
export interface PlayerTrackingService {
  trackPlayers(video: Video, detected: DetectedPlayer[]): Promise<TrackedPlayerResult[]>;
}
export interface PlayerIdentificationService {
  identify(tracked: TrackedPlayerResult[], roster: Array<{ profile: PlayerProfile; team: Team; shirtNumber?: number }>): Promise<IdentitySuggestion[]>;
}
export interface EventDetectionService {
  detectEvents(video: Video, tracked: TrackedPlayerResult[]): Promise<DetectedEvent[]>;
}
export interface ClipGenerationService {
  generateClips(events: DetectedEvent[]): Promise<GeneratedClip[]>;
}

export interface AiEngine {
  readonly name: "MOCK" | "REAL";
  playerDetection: PlayerDetectionService;
  playerTracking: PlayerTrackingService;
  playerIdentification: PlayerIdentificationService;
  eventDetection: EventDetectionService;
  clipGeneration: ClipGenerationService;
}
