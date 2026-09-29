import Link from "next/link";
import { categoryCounts, getPlayerStats, listKlipsForPlayer, listMatches } from "@/lib/db/queries";
import type { PlayerProfile, KlipCategory } from "@/lib/domain/types";
import { Avatar, StatRow } from "./ui";
import KlipGrid from "./KlipGrid";
import { MatchRow } from "./MatchRow";

export type ProfileTab = "latest" | "goals" | "assists" | "skills" | "top" | "matches";

export default function PlayerProfileView({ profile, tab, viewerUserId, basePath, isMe, actions }: { profile: PlayerProfile; tab: ProfileTab; viewerUserId: string | null; basePath: string; isMe: boolean; actions?: React.ReactNode }) {
  const stats = getPlayerStats(profile.id);
  const all = listKlipsForPlayer(profile.id, { viewerUserId });
  const counts = categoryCounts(all);
  const byCat = (c: KlipCategory) => all.filter((x) => x.category === c);
  const top = [...all].sort((a, b) => b.likeCount * 3 + b.shareCount * 5 + b.viewCount - (a.likeCount * 3 + a.shareCount * 5 + a.viewCount)).slice(0, 9);
  const tabs: Array<[ProfileTab, string]> = [["latest", "Latest"], ["goals", "Goals"], ["assists", "Assists"], ["skills", "Skills"], ["top", "Top KLIPs"], ["matches", "Matches"]];

  return (
    <>
      <section className="px-4 pt-5">
        <div className="flex items-center gap-4">
          <Avatar name={profile.displayName} size={64} />
          <div className="min-w-0">
            <h1 className="display text-4xl leading-none truncate">{profile.displayName}</h1>
            <p className="text-xs text-muted mt-1">@{profile.handle}{profile.position ? ` · ${profile.position}` : ""}{isMe ? " · you" : ""}</p>
          </div>
        </div>
        <div className="mt-5">
          <StatRow stats={[{ label: "Games", value: stats.games }, { label: "Goals", value: stats.goals }, { label: "Assists", value: stats.assists }, { label: "KLIPs", value: stats.klips }]} />
        </div>
        {counts.length > 0 ? (
          <ul className="mt-3 flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 text-xs text-muted">
            {counts.map((c) => (
              <li key={c.category} className="shrink-0 whitespace-nowrap">{c.count} {c.category.toLowerCase()}</li>
            ))}
          </ul>
        ) : null}
        {actions ? <div className="mt-4">{actions}</div> : null}
      </section>

      <nav className="sticky top-14 z-20 bg-bg/90 backdrop-blur mt-5 px-4 flex gap-5 border-b border-line/60 overflow-x-auto no-scrollbar">
        {tabs.map(([key, label]) => (
          <Link key={key} href={`${basePath}?tab=${key}`} className={`display text-xl py-2 border-b-2 whitespace-nowrap ${tab === key ? "border-accent text-ink" : "border-transparent text-muted"}`}>
            {label}
          </Link>
        ))}
      </nav>

      <section className="mt-4">
        {tab === "latest" ? <KlipGrid cards={all} cols={3} /> : null}
        {tab === "goals" ? <KlipGrid cards={byCat("GOALS")} /> : null}
        {tab === "assists" ? <KlipGrid cards={byCat("ASSISTS")} /> : null}
        {tab === "skills" ? <KlipGrid cards={byCat("SKILLS")} /> : null}
        {tab === "top" ? <KlipGrid cards={top} /> : null}
        {tab === "matches" ? (
          <div className="px-4 flex flex-col gap-2">
            {listMatches({ playerId: profile.id }).map((m) => (
              <MatchRow key={m.match.id} summary={m} />
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}
