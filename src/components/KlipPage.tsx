import Link from "next/link";
import type { KlipCardData } from "@/lib/db/queries";
import KlipCard from "./KlipCard";
import { klipTitle } from "@/lib/domain/present";
import { formatKickoff } from "./ui";

/** Single KLIP view, shared by the in-app page and the public share page. */
export default function KlipPage({ card, publicView }: { card: KlipCardData; publicView: boolean }) {
  const k = formatKickoff(card.match.kickoffAt);
  return (
    <div className="relative">
      <div className="relative">
        <KlipCard card={card} active loop />
        <span className="absolute top-3 left-3 display text-lg tracking-wider text-white/85 drop-shadow pointer-events-none">KLIPD</span>
      </div>
      {publicView ? (
        <div className="px-4 mt-6 rounded-card bg-surface p-5">
          <div className="display text-3xl">Your game. Your moments.</div>
          <p className="text-sm text-muted mt-1">KLIPD automatically turns 5 a side games into personal football highlights. {card.primary?.label} played {card.match.title} at {card.venue.name} on {k.day} {k.date}.</p>
          <Link href="/login" className="mt-4 inline-flex h-11 items-center rounded-full bg-accent text-accent-ink px-5 text-sm font-semibold">Find my KLIPs</Link>
        </div>
      ) : null}
      <p className="sr-only">{klipTitle(card)}</p>
    </div>
  );
}
