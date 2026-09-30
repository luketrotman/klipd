"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { publishMatch, setPublishMode, unpublishMatch } from "@/app/actions/label";

interface Summary { ai: number; reviewed: number; approved: number; manual: number; visibleToPlayers: number; publishedAt: string | null; publishMode: "REVIEWED" | "AUTO" }

export default function PublishPanel({ matchId, summary, players }: { matchId: string; summary: Summary; players: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const published = !!summary.publishedAt;
  const pct = summary.ai ? Math.round((summary.reviewed / summary.ai) * 100) : 0;

  return (
    <section className="rounded-2xl bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="display text-2xl">Publish to players</h2>
        <span className={`rounded px-2 py-0.5 text-[11px] font-bold ${published ? "bg-accent/20 text-accent" : "bg-orange/25 text-orange"}`}>{published ? "PUBLISHED" : "NOT PUBLISHED"}</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-bg p-2"><div className="display text-2xl">{summary.reviewed}/{summary.ai}</div><div className="text-[10px] uppercase tracking-wider text-muted">AI reviewed</div></div>
        <div className="rounded-xl bg-bg p-2"><div className="display text-2xl">{summary.approved + summary.manual}</div><div className="text-[10px] uppercase tracking-wider text-muted">Verified moments</div></div>
        <div className="rounded-xl bg-bg p-2"><div className="display text-2xl">{summary.visibleToPlayers}</div><div className="text-[10px] uppercase tracking-wider text-muted">Players see</div></div>
      </div>
      <div className="mt-3 h-1.5 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
      <p className="mt-2 text-[11px] text-muted">
        {summary.publishMode === "REVIEWED"
          ? "Reviewed mode: players only see moments you approved (or tagged yourself). Unreviewed AI calls stay hidden."
          : "Auto mode: confident AI calls that nobody has reviewed also go out. Rejected ones never do."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {published ? (
          <button disabled={pending} onClick={() => start(async () => { await unpublishMatch(matchId); setMsg("Unpublished. Players see the checking screen again."); router.refresh(); })} className="h-10 rounded-full border border-line px-4 text-sm font-semibold">Unpublish</button>
        ) : (
          <button disabled={pending} onClick={() => start(async () => { const n = await publishMatch(matchId); setMsg(`Published. ${n} of ${players} players notified.`); router.refresh(); })} className="h-10 rounded-full bg-accent px-5 text-sm font-bold text-accent-ink disabled:opacity-50">Publish and notify players</button>
        )}
        <button disabled={pending} onClick={() => start(async () => { await setPublishMode(matchId, summary.publishMode === "REVIEWED" ? "AUTO" : "REVIEWED"); router.refresh(); })} className="h-10 rounded-full border border-line px-4 text-xs font-semibold text-muted">{summary.publishMode === "REVIEWED" ? "Switch to Auto mode" : "Switch to Reviewed mode"}</button>
      </div>
      {msg ? <p className="mt-2 text-xs text-accent">{msg}</p> : null}
    </section>
  );
}
