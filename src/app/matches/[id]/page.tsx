import Link from "next/link";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { categoryCounts, getMatchDetail, listKlipsForPlayer } from "@/lib/db/queries";
import { CATEGORY_LABEL } from "@/lib/domain/types";
import { BottomNav, Page, TopBar } from "@/components/AppShell";
import { Avatar, formatKickoff } from "@/components/ui";
import KlipFeed from "@/components/KlipFeed";
import KlipGrid from "@/components/KlipGrid";
import ProcessingStatus from "@/components/ProcessingStatus";
import CheckingCard from "@/components/CheckingCard";
import ClaimTrackedPlayer from "@/components/ClaimTrackedPlayer";

type Tab = "highlights" | "players" | "goals" | "all";

export default async function MatchPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; player?: string; klip?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const viewer = await getViewer();
  const detail = getMatchDetail(id, viewer?.user.id);
  if (!detail) notFound();
  const { match, venue, pitch, klips, roster, tracked } = detail;
  const k = formatKickoff(match.kickoffAt);
  const tab = (sp.tab as Tab) ?? "highlights";
  const me = viewer?.profile ?? null;
  const ready = match.status === "READY" && detail.released;

  /* ---------- Player-filtered view: the post match experience ---------- */
  if (sp.player) {
    const entry = roster.find((r) => r.profile.id === sp.player);
    const playerName = entry?.profile.displayName ?? "Player";
    const isMe = me?.id === sp.player;
    const cards = listKlipsForPlayer(sp.player, { matchId: match.id, viewerUserId: viewer?.user.id });
    const counts = categoryCounts(cards);
    return (
      <>
        <TopBar back={`/matches/${match.id}`} title={isMe ? "Your game" : playerName} />
        <Page fill>
          <div className="px-4 pt-4 pb-3 shrink-0">
            <div className="text-xs uppercase tracking-wider text-accent font-bold">{isMe ? "Your game is ready" : `${playerName}'s game`}</div>
            <div className="display text-4xl mt-1">{match.title} <span className="text-muted">· {venue.name.replace("Powerleague ", "")}</span></div>
            <div className="text-xs text-muted mt-1">{k.day} {k.time}</div>
            <div className="display text-2xl mt-3">{isMe ? "We found" : "Found"} {cards.length} KLIPs</div>
            <ul className="mt-2 flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4">
              {counts.map((c) => (
                <li key={c.category} className="shrink-0 rounded-full bg-surface px-3 py-1.5 text-xs whitespace-nowrap">
                  <span aria-hidden>{CATEGORY_LABEL[c.category].emoji}</span> {c.count} {c.count === 1 ? CATEGORY_LABEL[c.category].singular : CATEGORY_LABEL[c.category].plural}
                </li>
              ))}
            </ul>
          </div>
          <KlipFeed cards={cards} startId={sp.klip} />
        </Page>
      </>
    );
  }

  const highlights = klips.filter((c) => (["GOALS", "ASSISTS", "SKILLS"].includes(c.category) || c.event.type === "SAVE") && (c.event.source !== "AI" || c.event.confidence >= 0.5));
  const goals = klips.filter((c) => c.event.type === "GOAL");
  const tabs: Array<[Tab, string]> = [["highlights", "Highlights"], ["players", "Players"], ["goals", "Goals"], ["all", "All KLIPs"]];
  const myLinked = tracked.some((t) => t.linkedProfile?.id === me?.id);
  const onRoster = !!me && roster.some((r) => r.profile.id === me.id);

  return (
    <>
      <TopBar back="/matches" />
      <Page>
        <section className="px-4 pt-4">
          <div className="text-xs uppercase tracking-wider text-muted">{detail.organiserName ?? "Match"} · {venue.name}{pitch ? ` · ${pitch.name}` : ""}</div>
          <h1 className="display text-5xl mt-1">{match.title}</h1>
          <div className="text-sm text-muted mt-1">{k.day} {k.date} · {k.time} · {match.format.replace("v", " a ")} side</div>
          <div className="mt-4 flex items-center gap-3">
            <span className="display text-2xl" style={{ color: match.homeTeam.colour }}>{match.homeTeam.name}</span>
            <span className="display text-4xl tabular-nums">{match.score ? `${match.score.home} – ${match.score.away}` : "vs"}</span>
            <span className="display text-2xl" style={{ color: match.awayTeam.colour }}>{match.awayTeam.name}</span>
          </div>
          {onRoster && ready ? (
            <Link href={`/matches/${match.id}?player=${me!.id}`} className="mt-4 inline-flex h-11 items-center rounded-full bg-accent text-accent-ink px-5 text-sm font-semibold">Watch my KLIPs →</Link>
          ) : null}
        </section>

        {match.status !== "READY" ? (
          <section className="px-4 mt-5">
            <ProcessingStatus status={match.status} engine={detail.jobs[0]?.engine ?? null} />
          </section>
        ) : !detail.released ? (
          <section className="px-4 mt-5">
            <CheckingCard />
          </section>
        ) : null}

        {ready && tracked.length > 0 && onRoster ? (
          <section className="px-4 mt-5">
            <ClaimTrackedPlayer tracked={tracked} signedIn={!!me} alreadyLinked={myLinked} />
          </section>
        ) : null}

        <nav className="sticky top-14 z-20 bg-bg/90 backdrop-blur mt-5 px-4 flex gap-5 border-b border-line/60 overflow-x-auto no-scrollbar">
          {tabs.map(([key, label]) => (
            <Link key={key} href={`/matches/${match.id}?tab=${key}`} className={`display text-xl py-2 border-b-2 whitespace-nowrap ${tab === key ? "border-accent text-ink" : "border-transparent text-muted"}`}>
              {label}
              {key === "all" ? <span className="ml-1 text-sm text-muted">{klips.length}</span> : null}
            </Link>
          ))}
        </nav>

        {tab === "highlights" ? (
          ready ? <div className="flex flex-col h-[calc(100dvh-10.5rem)]"><KlipFeed cards={highlights.length ? highlights : klips} /></div> : <p className="px-4 py-10 text-sm text-muted text-center">Highlights appear once the game is processed.</p>
        ) : null}

        {tab === "players" ? (
          <section className="px-4 mt-4">
            {(["HOME", "AWAY"] as const).map((team) => (
              <div key={team} className="mb-6">
                <div className="display text-xl mb-2" style={{ color: team === "HOME" ? match.homeTeam.colour : match.awayTeam.colour }}>{team === "HOME" ? match.homeTeam.name : match.awayTeam.name}</div>
                <ul className="flex flex-col gap-1.5">
                  {roster.filter((r) => r.matchPlayer.team === team).map((r) => (
                    <li key={r.profile.id}>
                      <Link href={`/matches/${match.id}?player=${r.profile.id}`} className="flex items-center gap-3 rounded-2xl bg-surface px-3 py-2.5 hover:bg-surface-2">
                        <Avatar name={r.profile.displayName} size={36} />
                        <span className="flex-1 min-w-0">
                          <span className="block font-semibold truncate">{r.profile.displayName}{me?.id === r.profile.id ? " (you)" : ""}</span>
                          <span className="block text-xs text-muted">{r.goals > 0 ? `⚽ ${r.goals} · ` : ""}{r.klipCount} KLIPs</span>
                        </span>
                        <span className="text-muted">›</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {tracked.length > 0 ? (
              <div className="mb-6">
                <div className="display text-xl mb-2 text-muted">Tracked on the pitch</div>
                <ul className="grid grid-cols-2 gap-1.5 text-xs">
                  {tracked.map((t) => (
                    <li key={t.tracked.id} className="rounded-xl bg-surface px-3 py-2 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full" style={{ background: t.tracked.shirtColour ?? "#888" }} />
                      <span className="font-semibold">{t.tracked.label}</span>
                      <span className="text-muted truncate">{t.linkedProfile ? `= ${t.linkedProfile.displayName}` : "unidentified"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

        {tab === "goals" ? (
          <section className="mt-4">
            <KlipGrid cards={goals} hrefFor={(c) => `/klips/${c.klip.id}`} />
          </section>
        ) : null}

        {tab === "all" ? (
          <section className="mt-4">
            <KlipGrid cards={klips} cols={3} />
          </section>
        ) : null}
      </Page>
      <BottomNav active="matches" />
    </>
  );
}
