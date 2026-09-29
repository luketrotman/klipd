/**
 * Booking / organiser integration seams.
 *
 * Long term, a platform such as Footy Addicts creates the match, KLIPD receives
 * the match data and roster, a venue camera is assigned, and players are already
 * known before kick off. The MVP uses the Manual provider (admin creates the
 * match). The Footy Addicts provider is a typed stub documenting the mapping.
 */
import type { BookingProviderKey, MatchFormat, Team } from "../domain/types";

export interface ExternalMatch {
  externalRef: string;
  title: string;
  venueExternalRef: string;
  pitchName: string | null;
  kickoffAt: string;
  durationMinutes: number;
  format: MatchFormat;
}

export interface ExternalRosterPlayer {
  externalRef: string;
  displayName: string;
  email: string | null;
  team: Team | null;
}

export interface BookingProvider {
  readonly key: BookingProviderKey;
  /** Matches booked at a venue in a window; used to pre-create KLIPD matches and assign cameras. */
  listBookedMatches(venueExternalRef: string, from: string, to: string): Promise<ExternalMatch[]>;
}

export interface MatchProvider {
  readonly key: BookingProviderKey;
  getMatch(externalRef: string): Promise<ExternalMatch | null>;
}

export interface PlayerRosterProvider {
  readonly key: BookingProviderKey;
  getRoster(externalRef: string): Promise<ExternalRosterPlayer[]>;
}

export class ManualProvider implements BookingProvider, MatchProvider, PlayerRosterProvider {
  readonly key = "manual" as const;
  async listBookedMatches(): Promise<ExternalMatch[]> {
    return [];
  }
  async getMatch(): Promise<ExternalMatch | null> {
    return null;
  }
  async getRoster(): Promise<ExternalRosterPlayer[]> {
    return [];
  }
}

/**
 * Footy Addicts stub. There is no public API integration yet; this documents
 * the shape KLIPD expects. Replace the bodies with real HTTP calls when access
 * is agreed, keeping the return types.
 */
export class FootyAddictsProvider implements BookingProvider, MatchProvider, PlayerRosterProvider {
  readonly key = "footy_addicts" as const;
  constructor(private readonly apiKey: string | undefined = process.env.FOOTY_ADDICTS_API_KEY) {}
  private notConfigured(): never {
    throw new Error("Footy Addicts integration is not configured (FOOTY_ADDICTS_API_KEY missing).");
  }
  async listBookedMatches(): Promise<ExternalMatch[]> {
    return this.apiKey ? this.notConfigured() : this.notConfigured();
  }
  async getMatch(): Promise<ExternalMatch | null> {
    return this.notConfigured();
  }
  async getRoster(): Promise<ExternalRosterPlayer[]> {
    return this.notConfigured();
  }
}

export function getBookingProvider(key: BookingProviderKey): BookingProvider & MatchProvider & PlayerRosterProvider {
  return key === "footy_addicts" ? new FootyAddictsProvider() : new ManualProvider();
}
