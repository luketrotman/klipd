import Link from "next/link";

export default function AdminShell({ children, title, back }: { children: React.ReactNode; title: string; back?: string }) {
  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-30 bg-bg/90 backdrop-blur border-b border-line/60">
        <div className="mx-auto max-w-5xl px-4 h-14 flex items-center gap-4">
          {back ? <Link href={back} className="text-muted hover:text-ink">←</Link> : null}
          <Link href="/admin" className="display text-2xl tracking-wider">KLIPD <span className="text-muted">ADMIN</span></Link>
          <span className="text-sm text-muted truncate">{title}</span>
          <nav className="ml-auto flex gap-4 text-xs font-semibold text-muted">
            <Link href="/admin/matches" className="hover:text-ink">Matches</Link>
            <Link href="/home" className="hover:text-ink">App →</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 flex-1">{children}</main>
    </div>
  );
}
