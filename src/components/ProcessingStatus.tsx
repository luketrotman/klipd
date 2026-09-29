"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { MATCH_STATUSES, STATUS_COPY, type MatchStatus } from "@/lib/domain/types";

const PIPELINE: MatchStatus[] = ["UPLOADED", "PROCESSING", "PLAYER_DETECTION", "PLAYER_TRACKING", "EVENT_DETECTION", "GENERATING_KLIPS", "READY"];

export default function ProcessingStatus({ status, engine, compact = false }: { status: MatchStatus; engine?: "MOCK" | "REAL" | null; compact?: boolean }) {
  const router = useRouter();
  const live = status !== "READY" && status !== "FAILED" && status !== "SCHEDULED";
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [live, router]);

  const idx = PIPELINE.indexOf(status);
  const copy = STATUS_COPY[status];
  const pct = status === "READY" ? 100 : status === "FAILED" ? 0 : Math.max(4, Math.round((idx / (PIPELINE.length - 1)) * 100));

  return (
    <div className="rounded-card bg-surface p-4">
      <div className="flex items-center gap-3">
        <span className={`w-2.5 h-2.5 rounded-full ${status === "FAILED" ? "bg-orange" : status === "READY" ? "bg-accent" : "bg-accent pulse-soft"}`} />
        <div className="min-w-0">
          <div className="display text-2xl leading-none">{copy.title}</div>
          <div className="text-xs text-muted mt-1">{copy.detail}</div>
        </div>
      </div>
      <div className="mt-4 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full bg-accent transition-all duration-700" style={{ width: `${pct}%` }} />
      </div>
      {!compact ? (
        <ol className="mt-4 grid grid-cols-1 gap-1.5 text-xs">
          {PIPELINE.map((s, i) => {
            const state = i < idx ? "done" : i === idx ? "now" : "todo";
            return (
              <li key={s} className={`flex items-center gap-2 ${state === "todo" ? "text-muted/60" : state === "now" ? "text-ink" : "text-muted"}`}>
                <span className={`w-4 h-4 rounded-full grid place-items-center text-[9px] font-bold ${state === "done" ? "bg-accent text-accent-ink" : state === "now" ? "border border-accent text-accent" : "border border-line"}`}>
                  {state === "done" ? "✓" : i + 1}
                </span>
                {STATUS_COPY[s].title}
              </li>
            );
          })}
        </ol>
      ) : null}
      {engine === "MOCK" && live ? <p className="mt-3 text-[11px] text-orange">Mock engine: placeholder output for testing the experience, not real detection.</p> : null}
      {status === "FAILED" ? <p className="mt-3 text-[11px] text-orange">Stage list: {MATCH_STATUSES.join(" → ")}</p> : null}
    </div>
  );
}
