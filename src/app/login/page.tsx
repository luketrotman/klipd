import Link from "next/link";
import { redirect } from "next/navigation";
import { signInAs, signInWithEmail } from "@/app/actions/auth";
import { getViewer } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { Avatar } from "@/components/ui";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const viewer = await getViewer();
  if (viewer) redirect(viewer.profile ? "/home" : "/onboarding");
  const { error } = await searchParams;
  const db = getDb();
  const demo = db.users
    .map((u) => ({ user: u, profile: db.playerProfiles.find((p) => p.userId === u.id) }))
    .filter((x) => x.profile);

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-8 pb-12">
      <Link href="/" className="display text-2xl tracking-wider">KLIPD</Link>
      <h1 className="display text-5xl mt-10">Find my KLIPs</h1>
      <p className="text-sm text-muted mt-2">Use the email you book games with. If you&apos;ve played a filmed game, your moments are already waiting.</p>
      <form action={signInWithEmail} className="mt-6 flex flex-col gap-3">
        <input name="email" type="email" required placeholder="you@example.com" className="h-12 rounded-full bg-surface px-5 text-ink placeholder:text-muted outline-none focus:ring-2 ring-accent" />
        {error === "email" ? <p className="text-xs text-orange">Enter a valid email.</p> : null}
        <button className="h-12 rounded-full bg-accent text-accent-ink font-semibold">Continue</button>
      </form>
      <p className="mt-3 text-[11px] text-muted">Development sign-in: no password or magic link is sent. Supabase Auth replaces this before launch.</p>

      <div className="mt-10">
        <div className="text-xs uppercase tracking-wider text-muted mb-3">Demo players</div>
        <div className="flex flex-col gap-2">
          {demo.map(({ user, profile }) => (
            <form key={user.id} action={signInAs.bind(null, user.id)}>
              <button className="w-full flex items-center gap-3 rounded-2xl bg-surface px-4 py-3 text-left hover:bg-surface-2">
                <Avatar name={profile!.displayName} size={36} />
                <span>
                  <span className="block font-semibold">{profile!.displayName}</span>
                  <span className="block text-xs text-muted">@{profile!.handle}{user.isAdmin ? " · admin" : ""}</span>
                </span>
              </button>
            </form>
          ))}
        </div>
      </div>
    </main>
  );
}
