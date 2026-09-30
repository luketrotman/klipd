"use client";

import { useEffect, useRef, useState } from "react";
import type Player from "@vimeo/player";

/**
 * Plays a KLIP.
 *  - With a rendered MP4 (`clipUrl`): a native <video>. Starts instantly and works everywhere.
 *  - Without one: the section [start, end] of the full match on Vimeo. This is only a fallback. Jumping
 *    into a 40 minute stream takes several seconds, so it says so instead of spinning silently.
 */
export interface KlipPlayerProps {
  externalId: string;
  /** Rendered MP4 (preferred over the Vimeo virtual clip when present). */
  clipUrl?: string | null;
  startTime: number;
  endTime: number;
  poster?: string | null;
  active: boolean;
  muted?: boolean;
  loop?: boolean;
  controls?: boolean;
  onEnded?: () => void;
  className?: string;
}

export default function KlipPlayer(props: KlipPlayerProps) {
  if (props.clipUrl) return <FileKlipPlayer {...props} clipUrl={props.clipUrl} />;
  return <VimeoKlipPlayer {...props} />;
}

function PlayGlyph() {
  return (
    <span className="w-14 h-14 rounded-full bg-white/15 backdrop-blur grid place-items-center">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
    </span>
  );
}

function Spinner() {
  return <span className="w-10 h-10 rounded-full border-2 border-white/30 border-t-accent animate-spin" />;
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-white/15">
      <div className="h-full bg-accent transition-[width] duration-200 ease-linear" style={{ width: `${value * 100}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ rendered file */

function FileKlipPlayer({ clipUrl, poster, active, muted = true, loop = true, onEnded, className = "" }: KlipPlayerProps & { clipUrl: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState(0);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) {
      v.currentTime = 0;
      v.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
    } else {
      v.pause();
    }
  }, [active, clipUrl]);

  const tapToPlay = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = muted;
    v.play().then(() => setBlocked(false)).catch(() => setBlocked(true));
  };

  return (
    <div className={`relative bg-black overflow-hidden ${className}`}>
      <div className="relative w-full aspect-video">
        <video
          ref={ref}
          src={clipUrl}
          poster={poster ?? undefined}
          muted={muted}
          loop={loop}
          playsInline
          preload={active ? "auto" : "metadata"}
          className="absolute inset-0 w-full h-full object-cover"
          onCanPlay={() => setLoading(false)}
          onWaiting={() => setLoading(true)}
          onPlaying={() => { setLoading(false); setBlocked(false); }}
          onError={() => setFailed(true)}
          onTimeUpdate={(e) => { const el = e.currentTarget; if (el.duration) setProgress(el.currentTime / el.duration); }}
          onEnded={() => onEnded?.()}
          onClick={(e) => { const el = e.currentTarget; if (el.paused) el.play().catch(() => setBlocked(true)); else el.pause(); }}
        />
        {!active && !failed ? <div className="absolute inset-0 grid place-items-center pointer-events-none"><PlayGlyph /></div> : null}
        {active && !failed && loading && !blocked ? <div className="absolute inset-0 grid place-items-center pointer-events-none"><Spinner /></div> : null}
        {active && !failed && blocked ? (
          <button onClick={tapToPlay} className="absolute inset-0 grid place-items-center" aria-label="Play this KLIP"><PlayGlyph /></button>
        ) : null}
        {failed ? (
          <div className="absolute inset-0 grid place-items-center bg-black/70 px-6 text-center text-sm text-white/80">
            This KLIP could not be loaded. Check your connection and try again.
          </div>
        ) : null}
      </div>
      {active ? <ProgressBar value={progress} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ Vimeo fallback */

function VimeoKlipPlayer({ externalId, startTime, endTime, poster, active, muted = true, loop = true, controls = false, onEnded, className = "" }: KlipPlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;

  useEffect(() => {
    if (!active || !hostRef.current) return;
    let disposed = false;
    let player: Player | null = null;
    setReady(false); setBlocked(false); setProblem(null); setSlow(false); setStalled(false);
    const slowTimer = setTimeout(() => setSlow(true), 2500);
    const stallTimer = setTimeout(() => setStalled(true), 25000);
    (async () => {
      const { default: Vimeo } = await import("@vimeo/player");
      if (disposed || !hostRef.current) return;
      player = new Vimeo(hostRef.current, {
        id: Number(externalId),
        controls,
        autopause: false,
        muted,
        playsinline: true,
        dnt: true,
        title: false,
        byline: false,
        portrait: false,
        responsive: false,
        width: 1280,
      });
      playerRef.current = player;
      player.on("error", (e: { message?: string; name?: string }) => setProblem(e?.name === "PrivacyError" ? "This video cannot be embedded here." : e?.message || "The video player reported an error."));
      player.on("timeupdate", (d: { seconds: number }) => {
        setProgress(Math.min(1, Math.max(0, (d.seconds - startTime) / (endTime - startTime))));
        if (d.seconds >= endTime) {
          if (loop) {
            player?.setCurrentTime(startTime);
          } else {
            player?.pause();
            endedRef.current?.();
          }
        }
      });
      try {
        await player.ready();
        // Jumping into a long stream can take several seconds; only then does playback start.
        await player.setCurrentTime(startTime);
        if (disposed) return;
        setReady(true);
        await player.play();
      } catch (e) {
        // A refused autoplay is not an error: offer a tap to play.
        if (!disposed && (e as { name?: string })?.name === "NotAllowedError") setBlocked(true);
      }
    })();
    return () => {
      disposed = true;
      clearTimeout(slowTimer);
      clearTimeout(stallTimer);
      setReady(false);
      player?.destroy().catch(() => {});
      playerRef.current = null;
    };
  }, [active, externalId, startTime, endTime, muted, loop, controls, attempt]);

  return (
    <div className={`relative bg-black overflow-hidden ${className}`}>
      <div className="relative w-full aspect-video vimeo-frame">
        {active ? <div ref={hostRef} className="absolute inset-0" /> : null}
        {(!active || !ready) && poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" />
        ) : null}
        {!active ? <div className="absolute inset-0 grid place-items-center"><PlayGlyph /></div> : null}
        {active && !ready && !problem ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <Spinner />
            {slow ? <p className="text-xs text-white/85 max-w-[15rem]">Loading from the full match video. This clip is still being prepared, so it can take about ten seconds.</p> : null}
            {stalled ? <button onClick={() => setAttempt((n) => n + 1)} className="rounded-full bg-white/15 px-4 py-2 text-xs font-semibold">Still loading. Tap to try again</button> : null}
          </div>
        ) : null}
        {active && problem ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
            <p className="text-sm text-white/85">{problem}</p>
            <button onClick={() => setAttempt((n) => n + 1)} className="rounded-full bg-white/15 px-4 py-2 text-xs font-semibold">Try again</button>
          </div>
        ) : null}
        {active && ready && blocked ? (
          <button onClick={() => { setBlocked(false); playerRef.current?.play().catch(() => setBlocked(true)); }} className="absolute inset-0 grid place-items-center" aria-label="Play this KLIP"><PlayGlyph /></button>
        ) : null}
      </div>
      {active ? <ProgressBar value={progress} /> : null}
    </div>
  );
}
