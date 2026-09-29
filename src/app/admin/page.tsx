import Link from "next/link";
import { requireAdmin } from "@/lib/auth/admin";
import { getDb } from "@/lib/db/store";
import { resetSeedData } from "@/app/actions/admin";
import AdminShell from "@/components/AdminShell";
import { MATCH_STATUSES } from "@/lib/domain/types";

export default async function AdminHome() {
  await requireAdmin();
  const db = getDb();
  const byStatus = MATCH_STATUSES.map((s) => [s, db.matches.filter((m) => m.status === s).length] as const).filter(([, n]) => n > 0);
  const bySource = ["MANUAL", "MOCK_AI", "AI"].map((s) => [s, db.events.filter((e) => e.source === s).length] as const);
  const cards = [
    { label: "Matches", value: db.matches.length, href: "/admin/matches" },
    { label: "Events", value: db.events.length },
    { label: "KLIPs", value: db.klips.length },
    { label: "Players", value: db.playerProfiles.length },
    { label: "Venues", value: db.venues.length },
    { label: "Cameras", value: db.cameras.length },
  ];
  return (
    <AdminShell title="Overview">
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
        {cards.map((c) => (
          <Link key={c.label} href={c.href ?? "/admin"} className="rounded-2xl bg-surface p-4">
            <div className="display text-3xl">{c.value}</div>
            <div className="text-xs text-muted uppercase tracking-wider">{c.label}</div>
          </Link>
        ))}
      </div>
      <div className="mt-6 grid md:grid-cols-2 gap-4">
        <section className="rounded-2xl bg-surface p-4">
          <h2 className="display text-xl mb-2">Matches by status</h2>
          <ul className="text-sm">
            {byStatus.map(([s, n]) => (
              <li key={s} className="flex justify-between py-1 border-b border-line/50"><span>{s}</span><span className="tabular-nums">{n}</span></li>
            ))}
          </ul>
        </section>
        <section className="rounded-2xl bg-surface p-4">
          <h2 className="display text-xl mb-2">Events by source</h2>
          <ul className="text-sm">
            {bySource.map(([s, n]) => (
              <li key={s} className="flex justify-between py-1 border-b border-line/50"><span>{s}</span><span className="tabular-nums">{n}</span></li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-orange">MOCK_AI events are placeholder output from the mock engine. They are not detections.</p>
        </section>
      </div>
      <section className="mt-6 rounded-2xl bg-surface p-4">
        <h2 className="display text-xl mb-2">Cameras</h2>
        <ul className="grid md:grid-cols-2 gap-2 text-sm">
          {db.cameras.map((c) => {
            const pitch = db.pitches.find((p) => p.id === c.pitchId)!;
            const venue = db.venues.find((v) => v.id === pitch.venueId)!;
            return (
              <li key={c.id} className="flex items-center gap-2 rounded-xl bg-bg px-3 py-2">
                <span className={`w-2 h-2 rounded-full ${c.status === "ONLINE" ? "bg-accent" : "bg-orange"}`} />
                <span className="font-semibold">{venue.name} · {pitch.name}</span>
                <span className="text-muted ml-auto text-xs">{c.kind} · {c.status}</span>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="mt-6 flex items-center gap-3">
        <Link href="/admin/matches/new" className="h-11 inline-flex items-center rounded-full bg-accent text-accent-ink px-5 text-sm font-semibold">New match</Link>
        <form action={resetSeedData}>
          <button className="h-11 rounded-full border border-line px-5 text-sm font-semibold text-muted hover:text-ink">Reset to seed data</button>
        </form>
        <span className="text-xs text-muted">Reset discards every manual label and mock run and restores data/db.json from the seed.</span>
      </section>
    </AdminShell>
  );
}
