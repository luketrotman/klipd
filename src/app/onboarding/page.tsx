import { redirect } from "next/navigation";
import { completeOnboarding } from "@/app/actions/auth";
import { getViewer } from "@/lib/auth/session";
import { listProfiles } from "@/lib/db/queries";

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (viewer.profile) redirect("/home");
  const { error } = await searchParams;
  const unclaimed = listProfiles().filter((p) => !p.userId);

  return (
    <main className="mx-auto w-full max-w-md flex-1 px-4 pt-8 pb-12">
      <span className="display text-2xl tracking-wider">KLIPD</span>
      <h1 className="display text-5xl mt-10">Set up your football profile</h1>
      <p className="text-sm text-muted mt-2">Every game you play through KLIPD gets added to your archive.</p>
      <form action={completeOnboarding} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wider text-muted">Name</span>
          <input name="displayName" required placeholder="Your name" className="h-12 rounded-full bg-surface px-5 outline-none focus:ring-2 ring-accent" />
          {error === "name" ? <span className="text-xs text-orange">Name is required.</span> : null}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs uppercase tracking-wider text-muted">Where do you play?</span>
          <select name="position" className="h-12 rounded-full bg-surface px-5 outline-none focus:ring-2 ring-accent">
            {["Forward", "Midfield", "Defence", "Goalkeeper", "Anywhere"].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        {unclaimed.length > 0 ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wider text-muted">Already on a team sheet?</span>
            <select name="claimProfileId" className="h-12 rounded-full bg-surface px-5 outline-none focus:ring-2 ring-accent">
              <option value="">No, start fresh</option>
              {unclaimed.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </select>
            <span className="text-[11px] text-muted">Organisers add players to games before kick off. Claim your entry and your past moments come with it.</span>
          </label>
        ) : null}
        <button className="h-12 rounded-full bg-accent text-accent-ink font-semibold mt-2">Find my KLIPs</button>
      </form>
    </main>
  );
}
