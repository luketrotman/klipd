import Link from "next/link";
import type { MatchSummary } from "@/lib/db/queries";
import { formatKickoff } from "./ui";
import { STATUS_COPY } from "@/lib/domain/types";

export function MatchRow({ summary }: { summary: MatchSummary }) {
  const { match, venue, pitch, video } = summary;
  const k = formatKickoff(match.kickoffAt);
  const finished = match.status === "READY";
  const ready = finished && summary.released;
  return (
    <Link href={`/matches/${match.id}`} className="flex gap-3 rounded-2xl bg-surface p-2.5 hover:bg-surface-2">
      <div className="relative w-28 aspect-video rounded-xl overflow-hidden bg-black shrink-0">
        {video?.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={video.thumbnailUrl} alt="" className="absolute inset-0 w-full h-full object-cover opacity-80" />
        ) : null}
        {!ready ? <span className="absolute inset-x-1 bottom-1 text-[9px] font-bold uppercase text-center bg-black/70 rounded px-1 py-0.5 text-accent">{finished ? "Checking your KLIPs" : STATUS_COPY[match.status].title}</span> : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="display text-xl truncate">{match.title}</div>
        <div className="text-xs text-muted truncate">{venue.name}{pitch ? ` · ${pitch.name}` : ""}</div>
        <div className="text-xs text-muted">{k.day} {k.date} · {k.time}</div>
        <div className="mt-1 flex items-center gap-2 text-xs">
          {match.score ? (
            <span className="font-semibold"><span style={{ color: match.homeTeam.colour }}>{match.homeTeam.name}</span> {match.score.home} – {match.score.away} <span style={{ color: match.awayTeam.colour }}>{match.awayTeam.name}</span></span>
          ) : null}
          {ready ? <span className="text-muted">· {summary.klipCount} KLIPs</span> : null}
        </div>
      </div>
    </Link>
  );
}
