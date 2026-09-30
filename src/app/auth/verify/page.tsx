import { consumeLink } from "@/app/actions/auth";

export default async function Verify({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-16 pb-12">
      <span className="display text-2xl tracking-wider">KLIPD</span>
      <h1 className="display text-5xl mt-10">One tap to sign in</h1>
      <p className="text-sm text-muted mt-2">This link works once and expires 15 minutes after it was sent.</p>
      {token ? (
        <form action={consumeLink} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <button className="h-12 w-full rounded-full bg-accent text-accent-ink font-semibold">Sign in to KLIPD</button>
        </form>
      ) : (
        <p className="mt-6 text-orange text-sm">This link is missing its token. Request a new one from the sign-in page.</p>
      )}
    </main>
  );
}
