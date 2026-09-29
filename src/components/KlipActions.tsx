"use client";

import { useState, useTransition } from "react";
import { recordShare, toggleLike } from "@/app/actions/klips";

interface Props {
  klipId: string;
  shareTitle: string;
  likeCount: number;
  likedByMe: boolean;
  clipUrl: string | null;
  compact?: boolean;
}

function Icon({ d, filled = false }: { d: string; filled?: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default function KlipActions({ klipId, shareTitle, likeCount, likedByMe, clipUrl, compact = false }: Props) {
  const [liked, setLiked] = useState(likedByMe);
  const [count, setCount] = useState(likeCount);
  const [toast, setToast] = useState<string | null>(null);
  const [, start] = useTransition();

  const shareUrl = () => `${window.location.origin}/klip/${klipId}`;
  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 1800);
  };

  const onLike = () => {
    setLiked(!liked);
    setCount((c) => c + (liked ? -1 : 1));
    start(async () => {
      const r = await toggleLike(klipId);
      if (!r.authed) {
        setLiked(false);
        setCount(likeCount);
        flash("Sign in to save KLIPs");
      }
    });
  };

  const onShare = async () => {
    const url = shareUrl();
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, text: `${shareTitle} · KLIPD`, url });
        recordShare(klipId, "NATIVE");
        return;
      } catch {
        return; // cancelled
      }
    }
    await navigator.clipboard.writeText(url);
    recordShare(klipId, "COPY_LINK");
    flash("Link copied");
  };

  const onCopy = async () => {
    await navigator.clipboard.writeText(shareUrl());
    recordShare(klipId, "COPY_LINK");
    flash("Link copied");
  };

  const onWhatsApp = () => {
    recordShare(klipId, "WHATSAPP");
    window.open(`https://wa.me/?text=${encodeURIComponent(`${shareTitle} ${shareUrl()}`)}`, "_blank", "noopener");
  };

  const btn = "flex flex-col items-center gap-1 text-[11px] text-muted active:scale-95 transition";

  return (
    <div className={`relative flex items-center ${compact ? "gap-4" : "gap-5"}`}>
      <button onClick={onLike} className={`${btn} ${liked ? "text-accent" : ""}`} aria-pressed={liked} aria-label="Favourite">
        <Icon filled={liked} d="M12 21s-7-4.6-9.3-8.6C.9 9 2.6 5 6.5 5c2 0 3.3 1 4.1 2.2C11.4 6 12.7 5 14.7 5c3.9 0 5.6 4 3.8 7.4C19 16.4 12 21 12 21z" />
        <span>{count > 0 ? count : "Save"}</span>
      </button>
      <button onClick={onShare} className={`${btn} text-ink`} aria-label="Share">
        <Icon d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7M16 6l-4-4-4 4M12 2v13" />
        <span>Share</span>
      </button>
      <button onClick={onWhatsApp} className={btn} aria-label="Send to WhatsApp">
        <Icon d="M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.6L3 21zM9 8.5c.2 2.5 2.4 5.2 5.5 6.1l1.2-1.4-2-1-1 .9c-1-.5-1.9-1.4-2.3-2.4l.9-1-.9-2-1.4.8z" />
        <span>Chat</span>
      </button>
      <button onClick={onCopy} className={btn} aria-label="Copy link">
        <Icon d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
        <span>Link</span>
      </button>
      {clipUrl ? (
        <a href={clipUrl} download className={btn} aria-label="Download" onClick={() => recordShare(klipId, "DOWNLOAD")}>
          <Icon d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          <span>Save</span>
        </a>
      ) : (
        <span className={`${btn} opacity-40`} title="Download is available once this KLIP has been rendered to a file">
          <Icon d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
          <span>Soon</span>
        </span>
      )}
      {toast ? (
        <span className="absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-ink text-bg text-xs font-semibold px-3 py-1.5">{toast}</span>
      ) : null}
    </div>
  );
}
