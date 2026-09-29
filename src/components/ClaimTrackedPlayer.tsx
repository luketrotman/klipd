"use client";

import { useState, useTransition } from "react";
import { claimTrackedPlayer } from "@/app/actions/identity";
import type { TrackedEntry } from "@/lib/db/queries";

/** "That's me" chooser: links an unidentified tracked player to the signed-in profile. */
export default function ClaimTrackedPlayer({ tracked, signedIn, alreadyLinked }: { tracked: TrackedEntry[]; signedIn: boolean; alreadyLinked: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const unlinked = tracked.filter((t) => !t.linkedProfile);
  if (unlinked.length === 0 || alreadyLinked) return null;
  return (
    <div className="rounded-card bg-surface p-4">
      <div className="display text-2xl">Which one is you?</div>
      <p className="text-xs text-muted mt-1">We tracked {tracked.length} players in this game but haven&apos;t matched them all to accounts yet. Pick yourself to attach those moments to your profile. If the tracker split you into more than one, claim each one.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {unlinked.map((t) => (
          <button
            key={t.tracked.id}
            disabled={pending || !signedIn}
            onClick={() =>
              start(async () => {
                const r = await claimTrackedPlayer(t.tracked.id);
                setMsg(r.ok ? "Linked. Your moments are on your profile." : r.reason ?? "Could not link");
              })
            }
            className="rounded-full border border-line px-3 py-2 text-sm font-semibold hover:border-accent hover:text-accent disabled:opacity-50"
          >
            <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{ background: t.tracked.shirtColour ?? "#888" }} />
            {t.tracked.label} · that&apos;s me
          </button>
        ))}
      </div>
      {!signedIn ? <p className="mt-2 text-xs text-muted">Sign in to claim your moments.</p> : null}
      {msg ? <p className="mt-2 text-xs text-accent">{msg}</p> : null}
    </div>
  );
}
