import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requestMagicLink, signInAs } from "@/app/actions/auth";
import { demoLoginEnabled, getViewer } from "@/lib/auth/session";
import { getDb } from "@/lib/db/store";
import { Avatar } from "@/components/ui";

const ERRORS: Record<string, string> = {
  email: "Enter a valid email address.",
  rate: "Too many requests. Wait a few minutes and try again.",
  send: "We could not send the email. Try again shortly.",
  expired: "That link has expired. Request a new one.",
  used: "That link has already been used. Request a new one.",
  invalid: "That link is not valid. Request a new one.",
  unknown: "Unknown account.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string; sent?: string }> }) {
  const viewer = await getViewer();
  if (viewer) redirect(viewer.profile ? "/home" : "/onboarding");
  const { error, sent } = await searchParams;
  const devLink = sent ? (await cookies()).get("klipd_devlink")?.value : undefined;
  const demo = demoLoginEnabled();
  const db = getDb();
  const demoUsers = demo
    ? db.users.map((u) => ({ user: u, profile: db.playerProfiles.find((p) => p.userId === u.id) })).filter((x) => x.profile)
    : [];

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-8 pb-12">
      <Link href="/" className="display text-2xl tracking-wider">KLIPD</Link>
      <h1 className="display text-5xl mt-10">Find my KLIPs</h1>

      {sent ? (
        <div className="mt-6 rounded-card bg-surface p-5">
          <div className="display text-2xl">Check your email</div>
          <p className="text-sm text-muted mt-1">We sent a sign-in link to <b className="text-ink">{sent}</b>. It works once and expires in 15 minutes.</p>
          {devLink ? (
            <div className="mt-4 rounded-xl bg-bg p-3 text-xs">
              <div className="text-orange font-bold mb-1">Development mode: no email provider is set</div>
              <a href={devLink} className="text-accent break-all underline">{devLink}</a>
            </div>
          ) : null}
          <Link href="/login" className="mt-4 inline-block text-xs text-muted underline">Use a different email</Link>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted mt-2">Use the email you book games with. If you have played a filmed game, your moments are already waiting.</p>
          <form action={requestMagicLink} className="mt-6 flex flex-col gap-3">
            <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" className="h-12 rounded-full bg-surface px-5 text-ink placeholder:text-muted outline-none focus:ring-2 ring-accent" />
            {error && ERRORS[error] ? <p className="text-xs text-orange">{ERRORS[error]}</p> : null}
            <button className="h-12 rounded-full bg-accent text-accent-ink font-semibold">Email me a sign-in link</button>
          </form>
          <p className="mt-3 text-[11px] text-muted">No password. We email you a one-time link.</p>
        </>
      )}

      {demoUsers.length ? (
        <div className="mt-10">
          <div className="text-xs uppercase tracking-wider text-muted mb-3">Demo players (development only)</div>
          <div className="flex flex-col gap-2">
            {demoUsers.map(({ user, profile }) => (
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
      ) : null}
    </main>
  );
}
