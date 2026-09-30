"use client";

import { useEffect, useRef, useState } from "react";
import type Player from "@vimeo/player";

/**
 * Plays a VIRTUAL klip: a section [start, end] of a source video.
 * Currently Vimeo-only on the client; the server decides the source via VideoProvider.
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

function FileKlipPlayer({ clipUrl, poster, active, muted = true, loop = true, onEnded, className = "" }: KlipPlayerProps & { clipUrl: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (active) {
      v.currentTime = 0;
      v.play().catch(() => {});
    } else {
      v.pause();
    }
  }, [active, clipUrl]);
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
          onTimeUpdate={(e) => { const el = e.currentTarget; if (el.duration) setProgress(el.currentTime / el.duration); }}
          onEnded={() => onEnded?.()}
          onClick={(e) => { const el = e.currentTarget; if (el.paused) el.play().catch(() => {}); else el.pause(); }}
        />
        {!active ? (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <span className="w-14 h-14 rounded-full bg-white/15 backdrop-blur grid place-items-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </div>
        ) : null}
      </div>
      {active ? (
        <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-white/15">
          <div className="h-full bg-accent transition-[width] duration-200 ease-linear" style={{ width: `${progress * 100}%` }} />
        </div>
      ) : null}
    </div>
  );
}

function VimeoKlipPlayer({ externalId, startTime, endTime, poster, active, muted = true, loop = true, controls = false, onEnded, className = "" }: KlipPlayerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState(0);
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;

  useEffect(() => {
    if (!active || !hostRef.current) return;
    let disposed = false;
    let player: Player | null = null;
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
        await player.setCurrentTime(startTime);
        if (!disposed) setReady(true);
        await player.play();
      } catch {
        /* autoplay may be blocked; the poster and play button remain */
      }
    })();
    return () => {
      disposed = true;
      setReady(false);
      player?.destroy().catch(() => {});
      playerRef.current = null;
    };
  }, [active, externalId, startTime, endTime, muted, loop, controls]);

  return (
    <div className={`relative bg-black overflow-hidden ${className}`}>
      <div className="relative w-full aspect-video vimeo-frame">
        {active ? <div ref={hostRef} className="absolute inset-0" /> : null}
        {(!active || !ready) && poster ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={poster} alt="" className="absolute inset-0 w-full h-full object-cover opacity-70" />
        ) : null}
        {!active ? (
          <div className="absolute inset-0 grid place-items-center">
            <span className="w-14 h-14 rounded-full bg-white/15 backdrop-blur grid place-items-center">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </div>
        ) : null}
        {active && !ready ? (
          <div className="absolute inset-0 grid place-items-center">
            <span className="w-10 h-10 rounded-full border-2 border-white/30 border-t-accent animate-spin" />
          </div>
        ) : null}
      </div>
      {active ? (
        <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-white/15">
          <div className="h-full bg-accent transition-[width] duration-200 ease-linear" style={{ width: `${progress * 100}%` }} />
        </div>
      ) : null}
    </div>
  );
}
