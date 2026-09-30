"use client";

import { useEffect, useState } from "react";

type State = "loading" | "unsupported" | "ios-install" | "not-configured" | "off" | "on" | "denied";

function urlBase64ToUint8Array(b64: string) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export default function PushPrompt() {
  const [state, setState] = useState<State>("loading");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const ua = navigator.userAgent;
      const isIos = /iPad|iPhone|iPod/.test(ua);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (isIos && !standalone) return setState("ios-install");
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      const k = await fetch("/api/push/key").then((r) => r.json()).catch(() => ({ configured: false }));
      if (!k.configured) return setState("not-configured");
      if (Notification.permission === "denied") return setState("denied");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setState(sub && Notification.permission === "granted" ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);

  const enable = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
      const { key } = await fetch("/api/push/key").then((r) => r.json());
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
      const res = await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub.toJSON()) });
      if (!res.ok) throw new Error("Could not save subscription");
      setState("on");
      setMsg("Notifications are on.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not turn on notifications");
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    const r = await fetch("/api/push/test", { method: "POST" }).then((x) => x.json()).catch(() => ({ delivered: 0 }));
    setMsg(r.delivered ? "Test sent. It should arrive in a few seconds." : "No device accepted the test notification.");
    setBusy(false);
  };

  if (state === "loading" || state === "unsupported" || state === "not-configured") return null;

  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      {state === "ios-install" ? (
        <>
          <div className="display text-xl">Get notified on iPhone</div>
          <p className="text-xs text-muted mt-1">Tap the Share button in Safari, choose <b className="text-ink">Add to Home Screen</b>, then open KLIPD from your home screen and turn on notifications.</p>
        </>
      ) : state === "denied" ? (
        <>
          <div className="display text-xl">Notifications are blocked</div>
          <p className="text-xs text-muted mt-1">Allow notifications for KLIPD in your browser or phone settings to hear when your KLIPs are ready.</p>
        </>
      ) : state === "on" ? (
        <div className="flex items-center justify-between gap-3">
          <div><div className="display text-xl">Notifications on</div><p className="text-xs text-muted mt-0.5">You will hear the moment your KLIPs are ready.</p></div>
          <button disabled={busy} onClick={test} className="shrink-0 rounded-full border border-line px-3 py-2 text-xs font-semibold">Send test</button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div><div className="display text-xl">Know when your KLIPs are ready</div><p className="text-xs text-muted mt-0.5">One notification after each game, nothing else.</p></div>
          <button disabled={busy} onClick={enable} className="shrink-0 rounded-full bg-accent text-accent-ink px-4 py-2 text-sm font-bold">Turn on</button>
        </div>
      )}
      {msg ? <p className="mt-2 text-xs text-accent">{msg}</p> : null}
    </div>
  );
}
