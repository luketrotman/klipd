import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { categoryCounts, getPlayerStats, listKlipsForPlayer, listMatches, listNotifications } from "@/lib/db/queries";
import { CATEGORY_LABEL } from "@/lib/domain/types";
import { BottomNav, Page, TopBar } from "@/components/AppShell";
import { Button, SectionTitle, StatRow, formatKickoff } from "@/components/ui";
import KlipGrid from "@/components/KlipGrid";
import ProcessingStatus from "@/components/ProcessingStatus";
import { MatchRow } from "@/components/MatchRow";
import { markNotificationsRead } from "@/app/actions/klips";

export default async function Home() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.profile) redirect("/onboarding");
  const me = viewer.profile;

  const matches = listMatches({ playerId: me.id });
  const latest = matches[0] ?? null;
  const latestReady = matches.find((m) => m.match.status === "READY") ?? null;
  const latestKlips = latestReady ? listKlipsForPlayer(me.id, { matchId: latestReady.match.id, viewerUserId: viewer.user.id }) : [];
  const counts = categoryCounts(latestKlips);
  const recent = listKlipsForPlayer(me.id, { limit: 6, viewerUserId: viewer.user.id });
  const stats = getPlayerStats(me.id);
  const unread = listNotifications(viewer.user.id).filter((n) => !n.read);
  const k = latestReady ? formatKickoff(latestReady.match.kickoffAt) : null;

  return (
    <>
      <TopBar />
      <Page>
        {unread.length > 0 ? (
          <form action={markNotificationsRead} className="px-4 pt-3">
            <button className="w-full text-left rounded-2xl bg-accent/10 border border-accent/30 px-4 py-3 flex items-center gap-3">
              <span className="w-2 h-2 rounded-full bg-accent pulse-soft" />
              <span className="text-sm"><span className="font-semibold">{unread[0].title}</span> <span className="text-muted">· {unread[0].body}</span></span>
            </button>
          </form>
        ) : null}

        {latest && latest.match.status !== "READY" ? (
          <section className="px-4 pt-4">
            <Link href={`/matches/${latest.match.id}`} className="block">
              <ProcessingStatus status={latest.match.status} compact />
            </Link>
          </section>
        ) : null}

        {latestReady && k ? (
          <section className="px-4 pt-5">
            <div className="text-xs uppercase tracking-wider text-accent font-bold">Your game is ready</div>
            <h1 className="display text-5xl mt-1">{latestReady.match.title}</h1>
            <p className="text-sm text-muted mt-1">{latestReady.venue.name} · {k.day} {k.time}</p>
            <p className="display text-3xl mt-5">We found {latestKlips.length} KLIPs</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {counts.map((c) => (
                <li key={c.category} className="rounded-full bg-surface px-3 py-1.5 text-sm">
                  <span aria-hidden>{CATEGORY_LABEL[c.category].emoji}</span> {c.count} {c.count === 1 ? CATEGORY_LABEL[c.category].singular : CATEGORY_LABEL[c.category].plural}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex gap-3">
              <Button href={`/matches/${latestReady.match.id}?player=${me.id}`} className="flex-1">Watch my KLIPs</Button>
              <Button href={`/matches/${latestReady.match.id}`} variant="ghost">Match</Button>
            </div>
          </section>
        ) : (
          <section className="px-4 pt-6">
            <h1 className="display text-5xl">No games yet</h1>
            <p className="text-sm text-muted mt-2">Play a filmed game and your moments will appear here automatically.</p>
          </section>
        )}

        <section className="mt-8">
          <SectionTitle action="See all" href="/profile">Your latest KLIPs</SectionTitle>
          <KlipGrid cards={recent} cols={3} />
        </section>

        <section className="mt-8 px-4">
          <h2 className="display text-2xl mb-3">Your stats</h2>
          <StatRow stats={[{ label: "Games", value: stats.games }, { label: "Goals", value: stats.goals }, { label: "Assists", value: stats.assists }, { label: "KLIPs", value: stats.klips }]} />
        </section>

        <section className="mt-8">
          <SectionTitle action="All matches" href="/matches">Recent matches</SectionTitle>
          <div className="px-4 flex flex-col gap-2">
            {matches.slice(0, 4).map((m) => (
              <MatchRow key={m.match.id} summary={m} />
            ))}
          </div>
        </section>
      </Page>
      <BottomNav active="home" />
    </>
  );
}
