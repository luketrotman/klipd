import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { getMatchDetail, getReviewSummary, listAllEventsForMatch } from "@/lib/db/queries";
import PublishPanel from "@/components/admin/PublishPanel";
import AdminShell from "@/components/AdminShell";
import EventEditor from "@/components/admin/EventEditor";
import { localCvAvailable } from "@/lib/ai/local";
import { clipRenderStatus } from "@/lib/video/clips";
import fs from "node:fs";
import path from "node:path";
import { formatKickoff } from "@/components/ui";
import Link from "next/link";

export default async function AdminMatch({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const detail = getMatchDetail(id, null, "admin");
  if (!detail) notFound();
  const events = listAllEventsForMatch(id);
  const debugDir = path.join(process.cwd(), "ai", "debug");
  const debugFrames = detail.video && fs.existsSync(debugDir) ? fs.readdirSync(debugDir).filter((f) => f.startsWith(`${detail.video!.externalId}_`)) : [];
  const k = formatKickoff(detail.match.kickoffAt);
  return (
    <AdminShell title={detail.match.title} back="/admin/matches">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h1 className="display text-4xl">{detail.match.title}</h1>
          <p className="text-sm text-muted">{detail.organiserName} · {detail.venue.name}{detail.pitch ? ` · ${detail.pitch.name}` : ""} · {k.day} {k.date} {k.time} · {detail.match.format}</p>
        </div>
        <div className="flex gap-3">
          <Link href={`/admin/label/${detail.match.id}`} className="h-10 inline-flex items-center rounded-full bg-accent text-accent-ink px-4 text-sm font-semibold">Train: quick label</Link>
          <Link href={`/matches/${detail.match.id}`} className="h-10 inline-flex items-center text-sm font-semibold text-muted hover:text-ink">View in app →</Link>
        </div>
      </div>
      <div className="mb-6"><PublishPanel matchId={id} summary={getReviewSummary(id)} players={detail.roster.length} /></div>
      <EventEditor
        cvAvailable={localCvAvailable()}
        clips={clipRenderStatus(id)}
        debugFrames={debugFrames}
        match={detail.match}
        video={detail.video}
        roster={detail.roster.map((r) => ({ id: r.profile.id, name: r.profile.displayName, team: r.matchPlayer.team }))}
        tracked={detail.tracked}
        events={events}
        jobs={detail.jobs}
      />
    </AdminShell>
  );
}
