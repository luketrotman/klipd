import Link from "next/link";
import { getViewer } from "@/lib/auth/session";
import { Avatar } from "./ui";

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export async function TopBar({ title, back }: { title?: string; back?: string }) {
  const viewer = await getViewer();
  return (
    <header className="sticky top-0 z-30 bg-bg/85 backdrop-blur border-b border-line/60">
      <div className="mx-auto max-w-md px-4 h-14 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {back ? (
            <Link href={back} aria-label="Back" className="-ml-2 p-2 text-muted hover:text-ink">
              <NavIcon d="M15 18l-6-6 6-6" />
            </Link>
          ) : null}
          <Link href={viewer ? "/home" : "/"} className="display text-2xl tracking-wider">
            {title ?? "KLIPD"}
          </Link>
        </div>
        {viewer?.profile ? (
          <Link href="/profile" aria-label="Profile">
            <Avatar name={viewer.profile.displayName} size={32} />
          </Link>
        ) : (
          <Link href="/login" className="text-sm font-semibold text-accent">
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}

export function BottomNav({ active }: { active: "home" | "matches" | "profile" | "none" }) {
  const items = [
    { key: "home", href: "/home", label: "Home", d: "M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" },
    { key: "matches", href: "/matches", label: "Matches", d: "M4 6h16v12H4zM4 12h16M12 6v12M9 12a3 3 0 0 0 6 0" },
    { key: "profile", href: "/profile", label: "Profile", d: "M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" },
  ] as const;
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 bg-bg/90 backdrop-blur border-t border-line/60 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto max-w-md grid grid-cols-3 h-16">
        {items.map((it) => (
          <Link key={it.key} href={it.href} className={`flex flex-col items-center justify-center gap-1 text-[11px] font-semibold ${active === it.key ? "text-accent" : "text-muted"}`}>
            <NavIcon d={it.d} />
            {it.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** Page body. `fill` pins the page to the viewport below the top bar (for full-screen feeds). */
export function Page({ children, className = "", fill = false }: { children: React.ReactNode; className?: string; fill?: boolean }) {
  const layout = fill ? "flex-none h-[calc(100dvh-3.5rem)] flex flex-col overflow-hidden" : "flex-1 pb-24";
  return <main className={`mx-auto w-full max-w-md ${layout} ${className}`}>{children}</main>;
}
