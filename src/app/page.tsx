import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { listKlipsForPlayer } from "@/lib/db/queries";
import { Button } from "@/components/ui";
import KlipGrid from "@/components/KlipGrid";

export default async function Landing() {
  const viewer = await getViewer();
  if (viewer?.profile) redirect("/home");
  const sample = listKlipsForPlayer("player_luke", { limit: 4 });
  return (
    <main className="mx-auto w-full max-w-md flex-1 flex flex-col">
      <header className="px-4 h-14 flex items-center justify-between">
        <span className="display text-2xl tracking-wider">KLIPD</span>
        <Link href="/login" className="text-sm font-semibold text-accent">Sign in</Link>
      </header>
      <section className="px-4 pt-10 pb-8">
        <h1 className="display text-[64px] leading-[0.88]">
          Your game.
          <br />
          <span className="text-accent">Your moments.</span>
        </h1>
        <p className="mt-5 text-base text-ink/80 max-w-xs">KLIPD automatically turns your 5 a side games into personal football highlights.</p>
        <div className="mt-7 flex flex-col gap-3">
          <Button href="/login">Find my KLIPs</Button>
          <Button href="/matches/match_tue5s" variant="ghost">View latest game</Button>
        </div>
      </section>
      <section className="pb-10">
        <div className="px-4 mb-3 flex items-end justify-between">
          <h2 className="display text-2xl">Every touch. Found for you.</h2>
        </div>
        <KlipGrid cards={sample} />
        <ol className="px-4 mt-8 grid grid-cols-5 gap-1 text-center text-[10px] uppercase tracking-wider text-muted">
          {["Play", "Get filmed", "KLIPD finds your moments", "Watch", "Share"].map((s, i) => (
            <li key={s} className="flex flex-col items-center gap-2">
              <span className="w-8 h-8 rounded-full bg-surface grid place-items-center display text-lg text-ink">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </section>
      <footer className="mt-auto px-4 py-6 text-[11px] text-muted">
        Built for 5 a side, 6 a side and 7 a side. Organiser or venue? <Link href="/admin" className="text-ink underline">Open the admin</Link>.
      </footer>
    </main>
  );
}
