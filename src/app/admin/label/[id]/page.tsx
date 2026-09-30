import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { getMatchDetail, getReviewSummary, listAllEventsForMatch } from "@/lib/db/queries";
import PublishPanel from "@/components/admin/PublishPanel";
import { labelStats } from "@/app/actions/label";
import AdminShell from "@/components/AdminShell";
import QuickLabeller, { type LabelEvent, type LabelRoster } from "@/components/admin/QuickLabeller";

export default async function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const detail = getMatchDetail(id, null, "admin");
  if (!detail || !detail.video) notFound();
  const events: LabelEvent[] = listAllEventsForMatch(id).map(({ event, players }) => {
    const primary = players.find((p) => p.role === "PRIMARY");
    return {
      id: event.id, type: event.type, timestamp: event.timestamp, startTime: event.startTime, endTime: event.endTime,
      confidence: event.confidence, source: event.metadata.demo ? "DEMO" : event.source,
      primaryLabel: primary?.label ?? "?", primaryTrackedId: primary?.tracked?.id ?? null, review: (event.metadata.review as string | undefined) ?? null,
    };
  });
  const roster: LabelRoster[] = detail.roster.map((r) => ({ id: r.profile.id, name: r.profile.displayName, team: r.matchPlayer.team }));
  const stats = await labelStats(id);
  return (
    <AdminShell title={`Label · ${detail.match.title}`} back={`/admin/matches/${id}`}>
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="display text-4xl">Train on {detail.match.title}</h1>
          <p className="text-sm text-muted">Watch at speed. Tap when something happens, tap the player, tap what it was. Review mode checks every AI call in a few seconds each. Everything you save is ground truth for training and evaluation.</p>
        </div>
        <Link href={`/admin/matches/${id}`} className="text-sm font-semibold text-muted hover:text-ink">Full editor →</Link>
      </div>
      <div className="mb-4"><PublishPanel matchId={id} summary={getReviewSummary(id)} players={detail.roster.length} /></div>
      <QuickLabeller match={detail.match} video={detail.video} roster={roster} events={events} initialStats={stats} />
    </AdminShell>
  );
}
