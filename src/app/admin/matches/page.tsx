import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { listMatches } from "@/lib/db/queries";
import { getDb } from "@/lib/db/store";
import AdminShell from "@/components/AdminShell";
import { formatKickoff } from "@/components/ui";

export default async function AdminMatches() {
  await requireAdmin();
  const db = getDb();
  const matches = listMatches();
  return (
    <AdminShell title="Matches" back="/admin">
      <div className="flex items-center justify-between mb-4">
        <h1 className="display text-4xl">Matches</h1>
        <Link href="/admin/matches/new" className="h-10 inline-flex items-center rounded-full bg-accent text-accent-ink px-4 text-sm font-semibold">New match</Link>
      </div>
      <div className="overflow-x-auto rounded-2xl bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted">
            <tr>
              <th className="px-4 py-3">Match</th>
              <th className="px-4 py-3">Kick off</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Video</th>
              <th className="px-4 py-3 text-right">Events</th>
              <th className="px-4 py-3 text-right">KLIPs</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => {
              const k = formatKickoff(m.match.kickoffAt);
              const events = db.events.filter((e) => e.matchId === m.match.id);
              const manual = events.filter((e) => e.source === "MANUAL").length;
              return (
                <tr key={m.match.id} className="border-t border-line/50">
                  <td className="px-4 py-3">
                    <div className="font-semibold">{m.match.title}</div>
                    <div className="text-xs text-muted">{m.venue.name}{m.pitch ? ` · ${m.pitch.name}` : ""} · {m.match.format}</div>
                  </td>
                  <td className="px-4 py-3 text-muted whitespace-nowrap">{k.day.slice(0, 3)} {k.date} {k.time}</td>
                  <td className="px-4 py-3"><span className={`rounded px-2 py-0.5 text-xs font-bold ${m.match.status === "READY" ? "bg-accent/20 text-accent" : m.match.status === "FAILED" ? "bg-orange/20 text-orange" : "bg-white/10"}`}>{m.match.status}</span></td>
                  <td className="px-4 py-3 text-muted text-xs">{m.video ? `${m.video.provider} ${m.video.externalId}` : "—"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{events.length} <span className="text-muted text-xs">({manual} manual)</span></td>
                  <td className="px-4 py-3 text-right tabular-nums">{m.klipCount}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap"><Link href={`/admin/label/${m.match.id}`} className="text-accent font-semibold mr-4">Train</Link><Link href={`/admin/matches/${m.match.id}`} className="text-muted font-semibold hover:text-ink">Editor →</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
