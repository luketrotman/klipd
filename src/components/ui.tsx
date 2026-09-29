import Link from "next/link";
import { CATEGORY_LABEL, CATEGORY_OF, EVENT_LABEL, formatClock, type EventType, type KlipCategory } from "@/lib/domain/types";

export function Avatar({ name, size = 40, className = "" }: { name: string; size?: number; className?: string }) {
  const initials = name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const hue = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  return (
    <span
      className={`inline-grid place-items-center rounded-full font-display font-bold shrink-0 ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.4, background: `hsl(${hue} 40% 22%)`, color: `hsl(${hue} 80% 85%)` }}
      aria-hidden
    >
      {initials}
    </span>
  );
}

export function EventBadge({ type, className = "" }: { type: EventType; className?: string }) {
  const cat = CATEGORY_OF[type];
  const tone: Record<KlipCategory, string> = {
    GOALS: "bg-accent text-accent-ink",
    ASSISTS: "bg-blue text-white",
    SKILLS: "bg-orange text-white",
    SHOTS: "bg-white/15 text-ink",
    DEFENSIVE: "bg-white/15 text-ink",
    OTHER: "bg-white/10 text-muted",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${tone[cat]} ${className}`}>
      <span aria-hidden>{CATEGORY_LABEL[cat].emoji}</span>
      {EVENT_LABEL[type]}
    </span>
  );
}

export function SourceTag({ source, demo = false }: { source: "MANUAL" | "MOCK_AI" | "AI"; demo?: boolean }) {
  if (demo) return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-orange/25 text-orange">DEMO LABEL</span>;
  if (source === "AI") return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-blue/30 text-blue">AI</span>;
  if (source === "MOCK_AI") return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-orange/25 text-orange">MOCK AI</span>;
  return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold bg-white/10 text-muted">LABELLED</span>;
}

export function Clock({ seconds, className = "" }: { seconds: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatClock(seconds)}</span>;
}

export function SectionTitle({ children, action, href }: { children: React.ReactNode; action?: string; href?: string }) {
  return (
    <div className="flex items-end justify-between px-4 mb-3">
      <h2 className="display text-2xl">{children}</h2>
      {action && href ? (
        <Link href={href} className="text-xs font-semibold text-muted hover:text-ink">
          {action} →
        </Link>
      ) : null}
    </div>
  );
}

export function StatRow({ stats }: { stats: Array<{ label: string; value: number | string }> }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {stats.map((s) => (
        <div key={s.label} className="rounded-2xl bg-surface px-2 py-3 text-center">
          <div className="display text-3xl text-ink">{s.value}</div>
          <div className="text-[11px] uppercase tracking-wider text-muted mt-1">{s.label}</div>
        </div>
      ))}
    </div>
  );
}

export function formatKickoff(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "Europe/London" });
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
  const time = d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London" }).toUpperCase().replace(" ", "");
  return { day, date, time };
}

export function Button({ href, children, variant = "primary", className = "", ...rest }: { href?: string; children: React.ReactNode; variant?: "primary" | "ghost" | "outline"; className?: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base = "inline-flex items-center justify-center gap-2 rounded-full px-5 h-12 font-semibold text-sm transition active:scale-[0.98] disabled:opacity-50";
  const v = {
    primary: "bg-accent text-accent-ink hover:brightness-95",
    ghost: "bg-white/10 text-ink hover:bg-white/15",
    outline: "border border-line text-ink hover:bg-white/5",
  }[variant];
  if (href) {
    return (
      <Link href={href} className={`${base} ${v} ${className}`}>
        {children}
      </Link>
    );
  }
  return (
    <button className={`${base} ${v} ${className}`} {...rest}>
      {children}
    </button>
  );
}
