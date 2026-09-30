"use client";

import Link from "next/link";
import KlipPlayer from "./KlipPlayer";
import KlipActions from "./KlipActions";
import { Avatar, EventBadge, formatKickoff } from "./ui";
import { formatClock } from "@/lib/domain/types";
import { klipTitle } from "@/lib/domain/present";
import type { KlipCardData } from "@/lib/db/queries";

export default function KlipCard({ card, active, full = false, loop = true, onEnded }: { card: KlipCardData; active: boolean; full?: boolean; loop?: boolean; onEnded?: () => void }) {
  const k = formatKickoff(card.match.kickoffAt);
  const title = (card.klip.title ?? card.event.metadata.title) as string | undefined;
  return (
    <article className={`flex flex-col ${full ? "h-full justify-center" : ""}`}>
      <div className={full ? "" : "rounded-card overflow-hidden"}>
        <KlipPlayer externalId={card.video.externalId} clipUrl={card.klip.clipUrl} startTime={card.klip.startTime} endTime={card.klip.endTime} poster={card.klip.thumbnailUrl ?? card.video.thumbnailUrl} active={active} loop={loop} onEnded={onEnded} />
      </div>
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center gap-2 mb-2">
          <EventBadge type={card.event.type} />
          <span className="text-xs text-muted tabular-nums">{formatClock(card.event.timestamp)}</span>
          {card.event.source === "MOCK_AI" ? <span className="text-[10px] font-bold text-orange">MOCK AI</span> : null}
          {card.event.source === "AI" ? <span className="text-[10px] font-bold text-blue">AI · {Math.round(card.event.confidence * 100)}%</span> : null}
          {card.event.metadata.demo === true ? <span className="text-[10px] font-bold text-orange">DEMO LABEL</span> : null}
        </div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {card.primary?.profile ? (
              <Link href={`/players/${card.primary.profile.id}`} className="flex items-center gap-2">
                <Avatar name={card.primary.profile.displayName} size={28} />
                <span className="display text-2xl truncate">{card.primary.profile.displayName}</span>
              </Link>
            ) : (
              <span className="display text-2xl text-muted">{card.primary?.label ?? "Unknown player"}</span>
            )}
            {title ? <p className="text-sm text-ink/90 mt-1">{title}</p> : null}
            <p className="text-xs text-muted mt-1">
              <Link href={`/matches/${card.match.id}`} className="hover:text-ink">{card.match.title}</Link> · <Link href={`/venues/${card.venue.id}`} className="hover:text-ink">{card.venue.name}</Link> · {k.day} {k.date}
            </p>
          </div>
        </div>
        <div className="mt-4">
          <KlipActions klipId={card.klip.id} shareTitle={klipTitle(card)} likeCount={card.likeCount} likedByMe={card.likedByMe} clipUrl={card.klip.clipUrl} />
        </div>
      </div>
    </article>
  );
}
