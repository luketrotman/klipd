"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type Player from "@vimeo/player";
import { deleteLabel, identifyTracked, reviewAiEvent, saveQuickLabel, type ReviewVerdict } from "@/app/actions/label";
import { EVENT_LABEL, formatClock, type EventType, type Match, type Video } from "@/lib/domain/types";

/* ------------------------------------------------------------------ types */

export interface LabelRoster { id: string; name: string; team: "HOME" | "AWAY" }
export interface LabelEvent { id: string; type: EventType; timestamp: number; startTime: number; endTime: number; confidence: number; source: string; primaryLabel: string; primaryTrackedId: string | null; review: string | null }

interface Box { trackId: number; label: string | null; trackedPlayerId: string | null; team: number | null; x1: number; y1: number; x2: number; y2: number; linkedName: string | null; linkedPlayerId: string | null }
interface Detections { t: number; width: number; height: number; players: Box[]; ball: number[] | null; available: boolean }

interface Props {
  match: Match;
  video: Video;
  roster: LabelRoster[];
  events: LabelEvent[];
  initialStats: { quick: number; reviewed: number; ai: number };
}

/* Quick types in the order a labeller reaches for them. Keys 1–8. */
const QUICK_TYPES: Array<{ type: EventType; key: string; emoji: string }> = [
  { type: "GOAL", key: "1", emoji: "⚽" },
  { type: "SHOT", key: "2", emoji: "🥅" },
  { type: "SAVE", key: "3", emoji: "🧤" },
  { type: "ASSIST", key: "4", emoji: "🎯" },
  { type: "TACKLE", key: "5", emoji: "🛡" },
  { type: "SKILL", key: "6", emoji: "🔥" },
  { type: "NUTMEG", key: "7", emoji: "🩳" },
  { type: "FUNNY_MOMENT", key: "8", emoji: "😂" },
];

const TEAM_COLOUR = ["#3b82f6", "#f97316"];

/* ------------------------------------------------------------------ component */

export default function QuickLabeller({ match, video, roster, events, initialStats }: Props) {
  const router = useRouter();
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [ready, setReady] = useState(false);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [mode, setMode] = useState<"tag" | "review">("tag");
  const [pending, start] = useTransition();

  // tagging state
  const [tagT, setTagT] = useState<number | null>(null);
  const [det, setDet] = useState<Detections | null>(null);
  const [pick, setPick] = useState<Box | null>(null);
  const [type, setType] = useState<EventType | null>(null);
  const [askWho, setAskWho] = useState<Box | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [stats, setStats] = useState(initialStats);
  const [labels, setLabels] = useState<Array<{ id: string; t: number; type: EventType; who: string }>>(
    events.filter((e) => e.source === "MANUAL").map((e) => ({ id: e.id, t: e.timestamp, type: e.type, who: e.primaryLabel })),
  );

  // review state
  const aiEvents = useMemo(() => events.filter((e) => e.source === "AI").sort((a, b) => a.timestamp - b.timestamp), [events]);
  const [reviewIdx, setReviewIdx] = useState(() => Math.max(0, aiEvents.findIndex((e) => !e.review)));
  const [reviewed, setReviewed] = useState<Record<string, string>>(() => Object.fromEntries(aiEvents.filter((e) => e.review).map((e) => [e.id, e.review!])));
  const [correcting, setCorrecting] = useState(false);
  const reviewStopRef = useRef<number | null>(null);

  const flash = (m: string) => {
    setToast(m);
    setTimeout(() => setToast(null), 1400);
  };

  /* ---------- player ---------- */
  useEffect(() => {
    if (!hostRef.current) return;
    let p: Player | null = null;
    let disposed = false;
    (async () => {
      const { default: Vimeo } = await import("@vimeo/player");
      if (disposed || !hostRef.current) return;
      p = new Vimeo(hostRef.current, { id: Number(video.externalId), controls: false, autopause: false, dnt: true, title: false, byline: false, portrait: false, responsive: true, keyboard: false, muted: true });
      playerRef.current = p;
      p.on("timeupdate", (d: { seconds: number }) => {
        setCurrent(d.seconds);
        if (reviewStopRef.current !== null && d.seconds >= reviewStopRef.current) {
          reviewStopRef.current = null;
          p?.pause().catch(() => {});
        }
      });
      p.on("play", () => setPlaying(true));
      p.on("pause", () => setPlaying(false));
      await p.ready();
      setReady(true);
    })();
    return () => {
      disposed = true;
      p?.destroy().catch(() => {});
    };
  }, [video.externalId]);

  const seek = useCallback((t: number) => playerRef.current?.setCurrentTime(Math.max(0, t)).catch(() => {}), []);
  const play = useCallback(() => playerRef.current?.play().catch(() => {}), []);
  const pause = useCallback(() => playerRef.current?.pause().catch(() => {}), []);
  const setSpeed = async (r: number) => {
    setRate(r);
    try {
      await playerRef.current?.setPlaybackRate(r);
    } catch {
      flash("This video does not allow speed changes");
      setRate(1);
    }
  };

  const fetchDet = useCallback(async (t: number) => {
    const r = await fetch(`/api/detections/${video.id}?t=${t.toFixed(2)}`);
    const d = (await r.json()) as Detections;
    setDet(d);
    return d;
  }, [video.id]);

  /* ---------- tag flow ---------- */
  const tapMoment = useCallback(async () => {
    if (tagT !== null) return;
    const t = current;
    pause();
    setTagT(t);
    setPick(null);
    setType(null);
    await fetchDet(t);
  }, [current, tagT, pause, fetchDet]);

  const cancelTag = useCallback(() => {
    setTagT(null);
    setPick(null);
    setType(null);
    setAskWho(null);
    setDet(null);
    play();
  }, [play]);

  const commitTag = useCallback((box: Box | null, ty: EventType | null) => {
    if (tagT === null || !box || !ty) return;
    const t = tagT;
    start(async () => {
      try {
        const id = await saveQuickLabel({ matchId: match.id, timestamp: t, type: ty, trackedPlayerId: box.trackedPlayerId, playerId: box.linkedPlayerId, trackId: box.trackId });
        setLabels((l) => [...l, { id, t, type: ty, who: box.linkedName ?? box.label ?? `track ${box.trackId}` }]);
        setStats((s) => ({ ...s, quick: s.quick + 1 }));
        flash(`Saved ${EVENT_LABEL[ty]} · ${box.linkedName ?? box.label ?? "player"}`);
        if (box.trackedPlayerId && !box.linkedName) {
          setAskWho(box); // "who is this?" once per identity
          setTagT(null); setPick(null); setType(null);
        } else {
          setTagT(null); setPick(null); setType(null); setDet(null);
          setTimeout(play, 600);
        }
      } catch (e) {
        flash(e instanceof Error ? e.message : "Could not save");
      }
    });
  }, [tagT, match.id, play]);

  const choosePlayer = (box: Box) => {
    setPick(box);
    if (type) commitTag(box, type);
  };
  const chooseType = (ty: EventType) => {
    setType(ty);
    if (pick) commitTag(pick, ty);
  };

  const answerWho = (playerId: string | null) => {
    const box = askWho;
    setAskWho(null);
    setDet(null);
    if (box?.trackedPlayerId && playerId) {
      start(async () => {
        await identifyTracked(box.trackedPlayerId!, playerId);
        flash(`${box.label} is now ${roster.find((r) => r.id === playerId)?.name}`);
        router.refresh();
      });
    }
    setTimeout(play, 300);
  };

  const undo = () => {
    const last = labels[labels.length - 1];
    if (!last) return;
    start(async () => {
      await deleteLabel(last.id);
      setLabels((l) => l.slice(0, -1));
      setStats((s) => ({ ...s, quick: Math.max(0, s.quick - 1) }));
      flash("Undone");
    });
  };

  /* ---------- review flow ---------- */
  const reviewEvent = aiEvents[reviewIdx] ?? null;
  const showReview = useCallback(async (idx: number) => {
    const e = aiEvents[idx];
    if (!e) return;
    setCorrecting(false);
    setDet(null);
    reviewStopRef.current = e.timestamp + 1.5;
    await seek(Math.max(0, e.timestamp - 4));
    await play();
    fetchDet(e.timestamp);
  }, [aiEvents, seek, play, fetchDet]);

  useEffect(() => {
    if (mode === "review" && ready) showReview(reviewIdx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, reviewIdx, ready]);

  const verdict = (v: ReviewVerdict, correction: { trackedPlayerId?: string | null; playerId?: string | null } = {}) => {
    if (!reviewEvent) return;
    const e = reviewEvent;
    start(async () => {
      await reviewAiEvent(e.id, v, correction);
      setReviewed((r) => ({ ...r, [e.id]: v }));
      setStats((s) => ({ ...s, reviewed: s.reviewed + (reviewed[e.id] ? 0 : 1) }));
      setReviewIdx((i) => Math.min(aiEvents.length - 1, i + 1));
    });
  };

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if ((ev.target as HTMLElement)?.tagName === "INPUT") return;
      if (mode === "tag") {
        if (ev.code === "Space") { ev.preventDefault(); if (tagT === null) tapMoment(); return; }
        if (ev.key === "Escape") { cancelTag(); return; }
        if (tagT !== null) {
          const q = QUICK_TYPES.find((x) => x.key === ev.key);
          if (q) chooseType(q.type);
        }
      } else {
        if (ev.key === "y" || ev.key === "Enter") verdict("correct");
        if (ev.key === "n") verdict("wrong");
        if (ev.key === "p") setCorrecting(true);
        if (ev.key === "r") showReview(reviewIdx);
      }
      if (ev.key === "ArrowLeft") seek(current - (ev.shiftKey ? 10 : 2));
      if (ev.key === "ArrowRight") seek(current + (ev.shiftKey ? 10 : 2));
      if (ev.key === "z" && (ev.metaKey || ev.ctrlKey)) undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, tagT, current, pick, type, reviewIdx, labels]);

  /* ---------- render ---------- */
  const duration = video.durationSeconds || 1;
  const overlayBoxes = det && (tagT !== null || mode === "review" || correcting) ? det.players : [];
  const w = det?.width ?? 1920, h = det?.height ?? 1080;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;

  return (
    <div className="flex flex-col gap-3">
      {/* mode + stats */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-full bg-surface p-1 text-sm font-semibold">
          <button onClick={() => { setMode("tag"); setDet(null); pause(); }} className={`rounded-full px-4 py-1.5 ${mode === "tag" ? "bg-accent text-accent-ink" : "text-muted"}`}>Tag moments</button>
          <button onClick={() => { cancelTag(); setMode("review"); }} className={`rounded-full px-4 py-1.5 ${mode === "review" ? "bg-accent text-accent-ink" : "text-muted"}`}>Review AI calls <span className="opacity-70">{Object.keys(reviewed).length}/{aiEvents.length}</span></button>
        </div>
        <div className="text-xs text-muted">{stats.quick} tagged · {stats.reviewed}/{stats.ai} AI calls reviewed</div>
        <div className="ml-auto flex items-center gap-1 text-xs">
          {[1, 1.5, 2].map((r) => <button key={r} onClick={() => setSpeed(r)} className={`rounded-full px-2.5 py-1 ${rate === r ? "bg-white/15 text-ink" : "text-muted"}`}>{r}×</button>)}
        </div>
      </div>

      {/* video + overlay */}
      <div className="relative rounded-2xl overflow-hidden bg-black select-none">
        <div ref={hostRef} />
        {!ready ? <div className="absolute inset-0 grid place-items-center text-muted text-sm">Loading video…</div> : null}
        {/* boxes */}
        <div className="absolute inset-0" style={{ pointerEvents: overlayBoxes.length ? "auto" : "none" }}>
          {overlayBoxes.map((b) => {
            const selected = pick?.trackId === b.trackId || (mode === "review" && reviewEvent && b.label === reviewEvent.primaryLabel && !correcting);
            const colour = b.team === 0 ? TEAM_COLOUR[0] : b.team === 1 ? TEAM_COLOUR[1] : "#9ca3af";
            return (
              <button
                key={b.trackId}
                onClick={() => (mode === "review" && correcting ? verdict("wrong_player", { trackedPlayerId: b.trackedPlayerId, playerId: b.linkedPlayerId }) : mode === "tag" ? choosePlayer(b) : undefined)}
                className="absolute rounded-md transition"
                style={{ left: pct(b.x1, w), top: pct(b.y1, h), width: pct(b.x2 - b.x1, w), height: pct(b.y2 - b.y1, h), border: `${selected ? 4 : 2}px solid ${selected ? "#c8ff3d" : colour}`, background: selected ? "rgba(200,255,61,0.18)" : "rgba(0,0,0,0.05)" }}
                aria-label={b.linkedName ?? b.label ?? "player"}
              >
                <span className="absolute -top-5 left-0 whitespace-nowrap rounded px-1 text-[11px] font-bold" style={{ background: selected ? "#c8ff3d" : colour, color: selected ? "#0a0f00" : "white" }}>{b.linkedName ?? b.label ?? `#${b.trackId}`}</span>
              </button>
            );
          })}
          {det?.ball && overlayBoxes.length ? (
            <span className="absolute rounded-full border-2 border-red-500" style={{ left: pct(det.ball[0] - 6, w), top: pct(det.ball[1] - 6, h), width: pct(det.ball[2] - det.ball[0] + 12, w), height: pct(det.ball[3] - det.ball[1] + 12, h) }} />
          ) : null}
        </div>
        {/* big tap target while playing in tag mode */}
        {mode === "tag" && tagT === null && ready ? (
          <button onClick={() => (playing ? tapMoment() : play())} className="absolute inset-x-0 bottom-0 h-1/3 flex items-end justify-center pb-4 bg-gradient-to-t from-black/60 to-transparent">
            <span className="rounded-full bg-accent text-accent-ink px-8 py-3 text-base font-bold shadow-lg">{playing ? "TAP when something happens" : "Play"}</span>
          </button>
        ) : null}
        {toast ? <span className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-ink text-bg px-3 py-1.5 text-xs font-semibold">{toast}</span> : null}
        {det && !det.available ? <span className="absolute top-3 right-3 rounded bg-orange/80 px-2 py-1 text-[11px] font-bold">No detections for this video yet. Run the REAL pipeline first.</span> : null}
      </div>

      {/* timeline */}
      <div className="relative h-6 rounded-lg bg-surface cursor-pointer" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); seek(((e.clientX - r.left) / r.width) * duration); }}>
        {aiEvents.map((e) => <span key={e.id} className="absolute top-1 h-1.5 w-0.5 rounded" style={{ left: pct(e.timestamp, duration), background: reviewed[e.id] === "correct" ? "#c8ff3d" : reviewed[e.id] ? "#f97316" : "#4b5563" }} title={`AI ${e.type} ${formatClock(e.timestamp)}`} />)}
        {labels.map((l) => <span key={l.id} className="absolute bottom-1 h-2 w-1 rounded bg-accent" style={{ left: pct(l.t, duration) }} title={`${l.type} ${formatClock(l.t)}`} />)}
        <span className="absolute top-0 bottom-0 w-0.5 bg-white" style={{ left: pct(current, duration) }} />
      </div>
      <div className="flex items-center gap-3 text-sm">
        <button onClick={() => (playing ? pause() : play())} className="h-9 rounded-full bg-surface px-4 font-semibold">{playing ? "Pause" : "Play"}</button>
        <span className="display text-2xl tabular-nums">{formatClock(current)}</span>
        <span className="text-muted text-xs">/ {formatClock(duration)}</span>
        <span className="ml-auto text-[11px] text-muted hidden md:inline">Space = tap · 1–8 = type · click player · Esc = cancel · ← → seek · ⌘Z undo</span>
      </div>

      {/* ---------- TAG panel ---------- */}
      {mode === "tag" && tagT !== null ? (
        <section className="rounded-2xl bg-surface p-4">
          <div className="flex items-center justify-between">
            <div className="display text-2xl">Moment at {formatClock(tagT)}</div>
            <button onClick={cancelTag} className="text-xs text-muted">Nothing here (Esc)</button>
          </div>
          <p className="text-xs text-muted mt-1">{pick ? <>Player: <b className="text-ink">{pick.linkedName ?? pick.label ?? `#${pick.trackId}`}</b>. Now pick what happened.</> : "Tap the player on the video, then what happened. Either order."}</p>
          <div className="mt-3 grid grid-cols-4 md:grid-cols-8 gap-2">
            {QUICK_TYPES.map((q) => (
              <button key={q.type} onClick={() => chooseType(q.type)} className={`rounded-xl px-2 py-3 text-sm font-semibold ${type === q.type ? "bg-accent text-accent-ink" : "bg-bg hover:bg-white/10"}`}>
                <span className="block text-xl" aria-hidden>{q.emoji}</span>
                {EVENT_LABEL[q.type]}
                <span className="block text-[10px] text-muted">{q.key}</span>
              </button>
            ))}
          </div>
          {det && det.players.length === 0 && det.available ? <p className="mt-2 text-xs text-orange">No tracked players at this frame. Step back a little with ← and tap again.</p> : null}
          {pending ? <p className="mt-2 text-xs text-muted">Saving…</p> : null}
        </section>
      ) : null}

      {/* ---------- WHO panel ---------- */}
      {askWho ? (
        <section className="rounded-2xl bg-accent/10 border border-accent/40 p-4">
          <div className="display text-2xl">Who is {askWho.label}?</div>
          <p className="text-xs text-muted mt-1">One tap links this tracked identity to a real player for the whole game. Skip if unsure.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {roster.map((r) => <button key={r.id} onClick={() => answerWho(r.id)} className="rounded-full border px-3 py-1.5 text-sm font-semibold hover:bg-white/10" style={{ borderColor: r.team === "HOME" ? TEAM_COLOUR[0] : TEAM_COLOUR[1] }}>{r.name}</button>)}
            <button onClick={() => answerWho(null)} className="rounded-full px-3 py-1.5 text-sm text-muted">Skip</button>
          </div>
        </section>
      ) : null}

      {/* ---------- REVIEW panel ---------- */}
      {mode === "review" ? (
        <section className="rounded-2xl bg-surface p-4">
          {reviewEvent ? (
            <>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted">AI call {reviewIdx + 1} of {aiEvents.length}</div>
                  <div className="display text-3xl">{EVENT_LABEL[reviewEvent.type]} · {reviewEvent.primaryLabel} <span className="text-muted text-xl">{Math.round(reviewEvent.confidence * 100)}%</span></div>
                  <div className="text-xs text-muted">at {formatClock(reviewEvent.timestamp)}{reviewed[reviewEvent.id] ? ` · already marked ${reviewed[reviewEvent.id]}` : ""}</div>
                </div>
                <div className="flex gap-1 text-xs">
                  <button onClick={() => setReviewIdx((i) => Math.max(0, i - 1))} className="rounded-full bg-bg px-3 py-1.5">‹</button>
                  <button onClick={() => showReview(reviewIdx)} className="rounded-full bg-bg px-3 py-1.5">Replay (r)</button>
                  <button onClick={() => setReviewIdx((i) => Math.min(aiEvents.length - 1, i + 1))} className="rounded-full bg-bg px-3 py-1.5">›</button>
                </div>
              </div>
              {correcting ? (
                <p className="mt-3 text-sm text-accent">Tap the correct player on the video.</p>
              ) : (
                <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2">
                  <button disabled={pending} onClick={() => verdict("correct")} className="h-12 rounded-xl bg-accent text-accent-ink font-bold">✓ Correct (y)</button>
                  <button disabled={pending} onClick={() => verdict("wrong")} className="h-12 rounded-xl bg-orange/20 text-orange font-bold">✗ Wrong (n)</button>
                  <button disabled={pending} onClick={() => { setCorrecting(true); pause(); fetchDet(reviewEvent.timestamp); }} className="h-12 rounded-xl bg-bg font-semibold">Wrong player (p)</button>
                  <button disabled={pending} onClick={() => setReviewIdx((i) => Math.min(aiEvents.length - 1, i + 1))} className="h-12 rounded-xl bg-bg font-semibold text-muted">Skip</button>
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted">No AI events to review. Run the REAL pipeline on this match first.</p>
          )}
        </section>
      ) : null}

      {/* recent labels */}
      {labels.length ? (
        <section className="text-xs text-muted">
          <div className="flex items-center justify-between mb-1"><span>Your labels ({labels.length})</span><button onClick={undo} className="text-orange">Undo last</button></div>
          <div className="flex flex-wrap gap-1.5">
            {labels.slice(-24).map((l) => <button key={l.id} onClick={() => seek(l.t - 3)} className="rounded-full bg-surface px-2.5 py-1 hover:text-ink">{formatClock(l.t)} {EVENT_LABEL[l.type]} · {l.who}</button>)}
          </div>
        </section>
      ) : null}
    </div>
  );
}
