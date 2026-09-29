import { getViewer } from "@/lib/auth/session";
import { listMatches } from "@/lib/db/queries";
import { BottomNav, Page, TopBar } from "@/components/AppShell";
import { MatchRow } from "@/components/MatchRow";
import Link from "next/link";

export default async function Matches({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const viewer = await getViewer();
  const { all } = await searchParams;
  const mine = viewer?.profile && !all;
  const matches = listMatches(mine ? { playerId: viewer.profile!.id } : {});
  return (
    <>
      <TopBar />
      <Page>
        <div className="px-4 pt-5 flex items-end justify-between">
          <h1 className="display text-5xl">{mine ? "Your matches" : "Matches"}</h1>
          {viewer?.profile ? (
            <Link href={mine ? "/matches?all=1" : "/matches"} className="text-xs font-semibold text-muted">{mine ? "All games" : "My games"} →</Link>
          ) : null}
        </div>
        <div className="px-4 mt-5 flex flex-col gap-2">
          {matches.map((m) => (
            <MatchRow key={m.match.id} summary={m} />
          ))}
          {matches.length === 0 ? <p className="text-sm text-muted py-8 text-center">No matches yet.</p> : null}
        </div>
      </Page>
      <BottomNav active="matches" />
    </>
  );
}
