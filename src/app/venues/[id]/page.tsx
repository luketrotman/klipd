import { notFound } from "next/navigation";
import { getVenueDetail } from "@/lib/db/queries";
import { BottomNav, Page, TopBar } from "@/components/AppShell";
import { MatchRow } from "@/components/MatchRow";

export default async function VenuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = getVenueDetail(id);
  if (!v) notFound();
  return (
    <>
      <TopBar back="/matches" />
      <Page>
        <section className="px-4 pt-5">
          <div className="text-xs uppercase tracking-wider text-muted">Venue</div>
          <h1 className="display text-5xl mt-1">{v.venue.name}</h1>
          <p className="text-sm text-muted mt-1">{v.venue.address}, {v.venue.city}</p>
          <p className="text-sm mt-3"><span className="display text-2xl">{v.matches.length}</span> <span className="text-muted">games filmed</span> <span className="display text-2xl ml-3">{v.klipCount}</span> <span className="text-muted">KLIPs created</span></p>
        </section>
        <section className="px-4 mt-6">
          <h2 className="display text-2xl mb-2">Pitches</h2>
          <ul className="grid grid-cols-2 gap-2">
            {v.pitches.map(({ pitch, cameras }) => (
              <li key={pitch.id} className="rounded-2xl bg-surface p-3">
                <div className="display text-xl">{pitch.name}</div>
                <div className="text-xs text-muted">{pitch.format.replace("v", " a ")} side{pitch.surface ? ` · ${pitch.surface}` : ""}</div>
                {cameras.map((c) => (
                  <div key={c.id} className="mt-2 flex items-center gap-1.5 text-[11px]">
                    <span className={`w-1.5 h-1.5 rounded-full ${c.status === "ONLINE" ? "bg-accent" : "bg-orange"}`} />
                    {c.label} · {c.status.toLowerCase()}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </section>
        <section className="px-4 mt-6">
          <h2 className="display text-2xl mb-2">Games here</h2>
          <div className="flex flex-col gap-2">
            {v.matches.map((m) => (
              <MatchRow key={m.match.id} summary={m} />
            ))}
          </div>
        </section>
      </Page>
      <BottomNav active="none" />
    </>
  );
}
