"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type Player from "@vimeo/player";
import { createKlipForEvent, deleteEvent, deleteKlip, saveEvent, setMatchScore, startProcessing, type EventInput } from "@/app/actions/admin";
import { linkTrackedPlayer, unlinkTrackedPlayer } from "@/app/actions/identity";
import { CATEGORY_OF, EVENT_LABEL, EVENT_TYPES, MATCH_STATUSES, formatClock, type EventType, type Match, type Team, type Video, type MatchEvent, type Klip, type ProcessingJob } from "@/lib/domain/types";
import type { ResolvedEventPlayer, TrackedEntry } from "@/lib/db/queries";
import { EventBadge, SourceTag } from "@/components/ui";

export interface EditorRosterEntry {
  id: string;
  name: string;
  team: Team;
}
export interface EditorEvent {
  event: MatchEvent;
  players: ResolvedEventPlayer[];
  klip: Klip | null;
}

interface Props {
  cvAvailable: boolean;
  /** Annotated frames from the local CV run, named <video>_<n>_<TYPE>_<sec>s.jpg */
  debugFrames: string[];
  match: Match;
  video: Video | null;
  roster: EditorRosterEntry[];
  tracked: TrackedEntry[];
  events: EditorEvent[];
  jobs: ProcessingJob[];
}

const CAT_COLOUR: Record<string, string> = { GOALS: "#c8ff3d", ASSISTS: "#3b82f6", SKILLS: "#f97316", SHOTS: "#e5e7eb", DEFENSIVE: "#a78bfa", OTHER: "#6b7280" };

const emptyForm = (matchId: string): EventInput => ({
  matchId,
  type: "GOAL",
  timestamp: 0,
  startTime: 0,
  endTime: 15,
  team: null,
  title: null,
  primaryPlayerId: null,
  primaryTrackedId: null,
  assistPlayerId: null,
  createKlip: true,
});

export default function EventEditor({ cvAvailable, debugFrames, match, video, roster, tracked, events, jobs }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const frameFor = (ev: EditorEvent) => debugFrames.find((f) => f.includes(`_${ev.event.type}_${Math.floor(ev.event.timestamp)}s`)) ?? null;
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(video?.durationSeconds ?? 0);
  const [form, setForm] = useState<EventInput>(() => emptyForm(match.id));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [score, setScore] = useState({ home: match.score?.home ?? 0, away: match.score?.away ?? 0 });
  const previewEndRef = useRef<number | null>(null);
  const live = !["READY", "FAILED", "SCHEDULED"].includes(match.status);

  useEffect(() => {
    if (!video || !hostRef.current) return;
    let p: Player | null = null;
    let disposed = false;
    (async () => {
      const { default: Vimeo } = await import("@vimeo/player");
      if (disposed || !hostRef.current) return;
      p = new Vimeo(hostRef.current, { id: Number(video.externalId), controls: true, autopause: false, dnt: true, title: false, byline: false, portrait: false, responsive: true });
      playerRef.current = p;
      p.on("timeupdate", (d: { seconds: number; duration: number }) => {
        setCurrent(d.seconds);
        if (d.duration) setDuration(d.duration);
        if (previewEndRef.current !== null && d.seconds >= previewEndRef.current) {
          previewEndRef.current = null;
          p?.pause().catch(() => {});
        }
      });
    })();
    return () => {
      disposed = true;
      p?.destroy().catch(() => {});
    };
  }, [video]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [live, router]);

  const seek = (t: number) => playerRef.current?.setCurrentTime(Math.max(0, t)).catch(() => {});
  const pause = () => playerRef.current?.pause().catch(() => {});

  const markMoment = () => {
    pause();
    const t = Math.round(current);
    setForm((f) => ({ ...f, timestamp: t, startTime: Math.max(0, t - 8), endTime: t + 7 }));
  };

  const primaryTeam = (f: EventInput): Team | null => {
    if (f.primaryPlayerId) return roster.find((r) => r.id === f.primaryPlayerId)?.team ?? null;
    if (f.primaryTrackedId) return tracked.find((t) => t.tracked.id === f.primaryTrackedId)?.tracked.team ?? null;
    return null;
  };

  const submit = () => {
    setError(null);
    start(async () => {
      try {
        await saveEvent({ ...form, team: primaryTeam(form) }, editingId ?? undefined);
        setForm(emptyForm(match.id));
        setEditingId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const edit = (ev: EditorEvent) => {
    const primary = ev.players.find((p) => p.role === "PRIMARY");
    const assist = ev.players.find((p) => p.role === "ASSIST");
    setEditingId(ev.event.id);
    setForm({
      matchId: match.id,
      type: ev.event.type,
      timestamp: ev.event.timestamp,
      startTime: ev.event.startTime,
      endTime: ev.event.endTime,
      team: ev.event.team,
      title: (ev.klip?.title ?? (ev.event.metadata.title as string | undefined)) ?? null,
      primaryPlayerId: primary?.tracked ? null : primary?.profile?.id ?? null,
      primaryTrackedId: primary?.tracked?.id ?? null,
      assistPlayerId: assist?.profile?.id ?? null,
      createKlip: true,
    });
    seek(ev.event.startTime);
  };

  const previewClip = async () => {
    previewEndRef.current = form.endTime;
    await seek(form.startTime);
    playerRef.current?.play().catch(() => {});
  };

  const sorted = useMemo(() => [...events].sort((a, b) => a.event.timestamp - b.event.timestamp), [events]);
  const stageIdx = MATCH_STATUSES.indexOf(match.status);
  const input = "h-10 rounded-xl bg-bg px-3 text-sm outline-none focus:ring-2 ring-accent w-full";
  const label = "flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted";

  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-6">
      {preview ? (
        <div className="fixed inset-0 z-50 bg-black/90 grid place-items-center p-4" onClick={() => setPreview(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/debug/${preview}`} alt={preview} className="max-w-full max-h-full rounded-xl" />
          <span className="absolute bottom-4 text-xs text-muted">{preview} · click to close</span>
        </div>
      ) : null}
      {/* -------- Left: video + timeline + events -------- */}
      <div className="min-w-0">
        {video ? (
          <div className="rounded-2xl overflow-hidden bg-black">
            <div ref={hostRef} />
          </div>
        ) : (
          <div className="rounded-2xl bg-surface p-8 text-center text-muted">No video attached to this match.</div>
        )}

        {video ? (
          <div className="mt-3">
            <div className="flex items-center gap-3 text-sm">
              <span className="display text-3xl tabular-nums">{formatClock(current)}</span>
              <span className="text-muted text-xs">/ {formatClock(duration)}</span>
              <div className="ml-auto flex gap-1.5">
                {[-10, -2, 2, 10].map((d) => (
                  <button key={d} onClick={() => seek(current + d)} className="h-8 rounded-full bg-surface px-3 text-xs font-semibold">{d > 0 ? `+${d}` : d}s</button>
                ))}
                <button onClick={markMoment} className="h-8 rounded-full bg-accent text-accent-ink px-4 text-xs font-bold">Mark moment</button>
              </div>
            </div>
            <div
              className="relative mt-3 h-8 rounded-lg bg-surface cursor-pointer"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                seek(((e.clientX - r.left) / r.width) * duration);
              }}
            >
              {duration > 0
                ? sorted.map((ev) => (
                    <span
                      key={ev.event.id}
                      title={`${EVENT_LABEL[ev.event.type]} · ${ev.players.find((p) => p.role === "PRIMARY")?.label ?? ""} · ${formatClock(ev.event.timestamp)}`}
                      className="absolute top-1 bottom-1 w-1 rounded"
                      style={{ left: `${(ev.event.timestamp / duration) * 100}%`, background: CAT_COLOUR[CATEGORY_OF[ev.event.type]] }}
                    />
                  ))
                : null}
              {duration > 0 ? <span className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: `${(current / duration) * 100}%` }} /> : null}
              {duration > 0 && form.endTime > form.startTime ? (
                <span className="absolute top-0 bottom-0 bg-accent/20 border-x border-accent pointer-events-none" style={{ left: `${(form.startTime / duration) * 100}%`, width: `${((form.endTime - form.startTime) / duration) * 100}%` }} />
              ) : null}
            </div>
          </div>
        ) : null}

        <section className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="display text-2xl">Events <span className="text-muted text-lg">{sorted.length}</span></h2>
            <span className="text-xs text-muted">{sorted.filter((e) => e.klip).length} KLIPs</span>
          </div>
          <div className="overflow-x-auto rounded-2xl bg-surface">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Players</th>
                  <th className="px-3 py-2">Clip</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((ev) => (
                  <tr key={ev.event.id} className={`border-t border-line/50 ${editingId === ev.event.id ? "bg-accent/10" : ""}`}>
                    <td className="px-3 py-2 tabular-nums"><button onClick={() => seek(ev.event.startTime)} className="hover:text-accent">{formatClock(ev.event.timestamp)}</button></td>
                    <td className="px-3 py-2 whitespace-nowrap"><EventBadge type={ev.event.type} />{ev.event.confidence < 1 ? <span className="ml-2 text-[10px] text-muted">{Math.round(ev.event.confidence * 100)}%</span> : null}</td>
                    <td className="px-3 py-2">
                      {ev.players.map((p, i) => (
                        <span key={i} className={p.role === "PRIMARY" ? "font-semibold" : "text-muted"}>{i > 0 ? " · " : ""}{p.label}{p.role === "ASSIST" ? " (assist)" : ""}{p.tracked && !p.profile ? " ⚠" : ""}</span>
                      ))}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted whitespace-nowrap">
                      {ev.klip ? (
                        <>
                          {formatClock(ev.klip.startTime)}–{formatClock(ev.klip.endTime)} <a href={`/klip/${ev.klip.id}`} target="_blank" className="text-accent ml-1">open</a>
                          <button onClick={() => start(async () => { await deleteKlip(ev.klip!.id); router.refresh(); })} className="ml-2 text-orange">remove</button>
                        </>
                      ) : (
                        <button onClick={() => start(async () => { await createKlipForEvent(ev.event.id); router.refresh(); })} className="text-accent">create KLIP</button>
                      )}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap"><SourceTag source={ev.event.source} demo={ev.event.metadata.demo === true} />{frameFor(ev) ? <button onClick={() => setPreview(frameFor(ev))} className="ml-2 text-[11px] text-accent">frame</button> : null}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button onClick={() => edit(ev)} className="text-xs font-semibold mr-3">Edit</button>
                      <button onClick={() => { if (confirm("Delete this event and its KLIP?")) start(async () => { await deleteEvent(ev.event.id); router.refresh(); }); }} className="text-xs font-semibold text-orange">Delete</button>
                    </td>
                  </tr>
                ))}
                {sorted.length === 0 ? <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">No events yet. Play the video, pause at a moment and press “Mark moment”.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/* -------- Right: form + score + pipeline + identity -------- */}
      <aside className="flex flex-col gap-4">
        <section className="rounded-2xl bg-surface p-4">
          <h2 className="display text-2xl mb-3">{editingId ? "Edit event" : "New event"}</h2>
          <div className="grid grid-cols-3 gap-2">
            <label className={label}>Moment<input type="number" className={input} value={form.timestamp} onChange={(e) => setForm({ ...form, timestamp: Number(e.target.value) })} /></label>
            <label className={label}>Start<input type="number" className={input} value={form.startTime} onChange={(e) => setForm({ ...form, startTime: Number(e.target.value) })} /></label>
            <label className={label}>End<input type="number" className={input} value={form.endTime} onChange={(e) => setForm({ ...form, endTime: Number(e.target.value) })} /></label>
          </div>
          <div className="mt-1 flex gap-2 text-[11px]">
            <button onClick={() => setForm({ ...form, startTime: Math.round(current) })} className="text-accent">set start = now</button>
            <button onClick={() => setForm({ ...form, endTime: Math.round(current) })} className="text-accent">set end = now</button>
            <button onClick={previewClip} className="ml-auto text-muted hover:text-ink">preview clip</button>
          </div>
          <div className="text-[11px] text-muted mt-1">{formatClock(form.startTime)} → {formatClock(form.endTime)} · {Math.max(0, form.endTime - form.startTime)}s</div>

          <label className={`${label} mt-3`}>Event
            <select className={input} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as EventType })}>
              {EVENT_TYPES.map((t) => <option key={t} value={t}>{EVENT_LABEL[t]}</option>)}
            </select>
          </label>
          <label className={`${label} mt-3`}>Player
            <select
              className={input}
              value={form.primaryPlayerId ? `p:${form.primaryPlayerId}` : form.primaryTrackedId ? `t:${form.primaryTrackedId}` : ""}
              onChange={(e) => {
                const v = e.target.value;
                setForm({ ...form, primaryPlayerId: v.startsWith("p:") ? v.slice(2) : null, primaryTrackedId: v.startsWith("t:") ? v.slice(2) : null });
              }}
            >
              <option value="">Select player…</option>
              <optgroup label={match.homeTeam.name}>{roster.filter((r) => r.team === "HOME").map((r) => <option key={r.id} value={`p:${r.id}`}>{r.name}</option>)}</optgroup>
              <optgroup label={match.awayTeam.name}>{roster.filter((r) => r.team === "AWAY").map((r) => <option key={r.id} value={`p:${r.id}`}>{r.name}</option>)}</optgroup>
              {tracked.length ? <optgroup label="Tracked players">{tracked.map((t) => <option key={t.tracked.id} value={`t:${t.tracked.id}`}>{t.tracked.label}{t.linkedProfile ? ` = ${t.linkedProfile.displayName}` : ""}</option>)}</optgroup> : null}
            </select>
          </label>
          {form.type === "GOAL" ? (
            <label className={`${label} mt-3`}>Assisted by
              <select className={input} value={form.assistPlayerId ?? ""} onChange={(e) => setForm({ ...form, assistPlayerId: e.target.value || null })}>
                <option value="">No assist</option>
                {roster.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
          ) : null}
          <label className={`${label} mt-3`}>Title (optional)<input className={`${input} normal-case tracking-normal text-ink`} placeholder="Far post finish" value={form.title ?? ""} onChange={(e) => setForm({ ...form, title: e.target.value || null })} /></label>
          {!editingId ? (
            <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.createKlip} onChange={(e) => setForm({ ...form, createKlip: e.target.checked })} className="accent-[#c8ff3d]" />Create KLIP</label>
          ) : null}
          {error ? <p className="mt-2 text-xs text-orange">{error}</p> : null}
          <div className="mt-4 flex gap-2">
            <button disabled={pending} onClick={submit} className="h-10 flex-1 rounded-full bg-accent text-accent-ink text-sm font-bold disabled:opacity-50">{editingId ? "Save changes" : "Save event"}</button>
            {editingId ? <button onClick={() => { setEditingId(null); setForm(emptyForm(match.id)); }} className="h-10 rounded-full border border-line px-4 text-sm">Cancel</button> : null}
          </div>
        </section>

        <section className="rounded-2xl bg-surface p-4">
          <h2 className="display text-2xl mb-2">Score</h2>
          <div className="flex items-center gap-2">
            <span className="text-sm" style={{ color: match.homeTeam.colour }}>{match.homeTeam.name}</span>
            <input type="number" className={`${input} w-16`} value={score.home} onChange={(e) => setScore({ ...score, home: Number(e.target.value) })} />
            <input type="number" className={`${input} w-16`} value={score.away} onChange={(e) => setScore({ ...score, away: Number(e.target.value) })} />
            <span className="text-sm" style={{ color: match.awayTeam.colour }}>{match.awayTeam.name}</span>
            <button onClick={() => start(async () => { await setMatchScore(match.id, score.home, score.away); router.refresh(); })} className="ml-auto h-9 rounded-full border border-line px-3 text-xs font-semibold">Save</button>
          </div>
        </section>

        <section className="rounded-2xl bg-surface p-4">
          <h2 className="display text-2xl mb-1">Processing</h2>
          <div className="text-sm">Status: <span className={`font-bold ${match.status === "READY" ? "text-accent" : live ? "text-orange" : ""}`}>{match.status}</span></div>
          <ol className="mt-2 flex flex-wrap gap-1 text-[10px]">
            {MATCH_STATUSES.filter((s) => s !== "SCHEDULED" && s !== "RECORDING" && s !== "FAILED").map((s, i) => (
              <li key={s} className={`rounded px-1.5 py-0.5 ${MATCH_STATUSES.indexOf(s) <= stageIdx ? "bg-accent/20 text-accent" : "bg-bg text-muted"}`}>{i + 1}. {s}</li>
            ))}
          </ol>
          {jobs.length ? (
            <ul className="mt-2 text-[11px] text-muted max-h-28 overflow-auto">
              {jobs.map((j) => <li key={j.id}>{j.stage} · {j.engine} · {j.completedAt ? "done" : "running"}{j.log.length > 1 ? ` · ${j.log.slice(-2).join(" · ")}` : ""}</li>)}
            </ul>
          ) : null}
          <button disabled={pending || !video || !cvAvailable} onClick={() => start(async () => { await startProcessing(match.id, "LOCAL_CV"); router.refresh(); })} className="mt-3 h-10 w-full rounded-full bg-accent text-accent-ink text-sm font-bold disabled:opacity-40">
            {live ? "Restart REAL pipeline (local CV)" : "Run REAL pipeline (local CV)"}
          </button>
          <button disabled={pending || !video || !cvAvailable} onClick={() => start(async () => { await startProcessing(match.id, "LOCAL_CV", { duration: 180 }); router.refresh(); })} className="mt-2 h-9 w-full rounded-full border border-line text-xs font-semibold disabled:opacity-40">
            Quick test: first 3 minutes only
          </button>
          <p className="mt-2 text-[11px] text-muted">Real detection: YOLO + ByteTrack on the footage, run on this machine (about half the match length). Events are rule-based with confidences; correct them here. Manual labels are kept; previous machine output is replaced.</p>
          <button disabled={pending || !video} onClick={() => start(async () => { await startProcessing(match.id, "MOCK"); router.refresh(); })} className="mt-3 h-9 w-full rounded-full border border-orange text-orange text-xs font-bold disabled:opacity-40">
            {live ? "Restart MOCK pipeline" : "Run MOCK pipeline (placeholder data, no analysis)"}
          </button>
        </section>

        <section className="rounded-2xl bg-surface p-4">
          <h2 className="display text-2xl mb-2">Tracked players</h2>
          {tracked.length === 0 ? <p className="text-xs text-muted">None yet. Run the pipeline to create tracked players, then link each one to a booked player.</p> : null}
          <ul className="flex flex-col gap-1.5">
            {tracked.map((t) => (
              <li key={t.tracked.id} className="flex items-center gap-2 text-sm">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: t.tracked.shirtColour ?? "#888" }} />
                <span className="font-semibold w-20 shrink-0">{t.tracked.label}</span>
                <select
                  className={`${input} h-8 text-xs`}
                  value={t.linkedProfile?.id ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    start(async () => {
                      if (v) await linkTrackedPlayer(t.tracked.id, v, "MANUAL");
                      else await unlinkTrackedPlayer(t.tracked.id);
                      router.refresh();
                    });
                  }}
                >
                  <option value="">Unidentified</option>
                  {roster.filter((r) => !t.tracked.team || r.team === t.tracked.team).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <span className="text-[10px] text-muted w-14 text-right">{t.linkMethod ?? `${t.eventCount} ev`}</span>
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
