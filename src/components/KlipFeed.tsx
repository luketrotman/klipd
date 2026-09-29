"use client";

import { useEffect, useRef, useState } from "react";
import KlipCard from "./KlipCard";
import type { KlipCardData } from "@/lib/db/queries";

/**
 * Vertical, swipeable highlight feed. One KLIP per screen; the visible one plays.
 */
export default function KlipFeed({ cards, startId }: { cards: KlipCardData[]; startId?: string }) {
  const [active, setActive] = useState(() => Math.max(0, cards.findIndex((c) => c.klip.id === startId)));
  const itemsRef = useRef<Array<HTMLDivElement | null>>([]);
  const feedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = itemsRef.current[active];
    if (el && startId) el.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            const idx = Number((e.target as HTMLElement).dataset.index);
            setActive(idx);
          }
        }
      },
      { root: feedRef.current, threshold: [0.6] },
    );
    itemsRef.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, [cards.length]);

  const next = () => {
    const el = itemsRef.current[active + 1];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (cards.length === 0) {
    return <div className="p-8 text-center text-muted">No KLIPs yet.</div>;
  }

  return (
    <div ref={feedRef} className="snap-feed overflow-y-auto flex-1 min-h-0">
      {cards.map((c, i) => (
        <div
          key={c.klip.id}
          data-index={i}
          ref={(el) => {
            itemsRef.current[i] = el;
          }}
          className="snap-item h-full flex flex-col justify-center"
        >
          <div className="relative">
            <span className="absolute right-4 -top-8 text-xs text-muted tabular-nums">
              {i + 1} / {cards.length}
            </span>
            <KlipCard card={c} active={i === active} loop={false} onEnded={next} full />
          </div>
        </div>
      ))}
    </div>
  );
}
