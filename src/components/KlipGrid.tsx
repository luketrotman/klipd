import Link from "next/link";
import { CATEGORY_LABEL, CATEGORY_OF, EVENT_LABEL, formatClock } from "@/lib/domain/types";
import type { KlipCardData } from "@/lib/db/queries";

/** Thumbnail grid for profile/match lists. Tapping opens the KLIP page. */
export default function KlipGrid({ cards, hrefFor, cols = 2 }: { cards: KlipCardData[]; hrefFor?: (c: KlipCardData) => string; cols?: 2 | 3 }) {
  if (cards.length === 0) return <p className="px-4 py-8 text-center text-sm text-muted">Nothing here yet.</p>;
  return (
    <div className={`grid gap-2 px-4 ${cols === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
      {cards.map((c) => {
        const cat = CATEGORY_OF[c.event.type];
        return (
          <Link key={c.klip.id} href={hrefFor ? hrefFor(c) : `/klips/${c.klip.id}`} className="relative aspect-[4/5] rounded-2xl overflow-hidden bg-surface group">
            {c.video.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={c.video.thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70 group-hover:opacity-90 transition" />
            ) : null}
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
            <span className="absolute top-2 left-2 text-lg" aria-hidden>{CATEGORY_LABEL[cat].emoji}</span>
            <span className="absolute top-2 right-2 text-[10px] font-bold text-white/80 tabular-nums">{formatClock(c.event.timestamp)}</span>
            <div className="absolute bottom-0 inset-x-0 p-2.5">
              <div className="display text-lg leading-none">{EVENT_LABEL[c.event.type]}</div>
              <div className="text-[11px] text-white/70 truncate mt-1">{c.primary?.label} · {c.match.title}</div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
