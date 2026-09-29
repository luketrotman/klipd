import { requireAdmin } from "@/lib/auth/admin";
import { getDb } from "@/lib/db/store";
import { createMatch } from "@/app/actions/admin";
import AdminShell from "@/components/AdminShell";

export default async function NewMatch() {
  await requireAdmin();
  const db = getDb();
  const input = "h-11 rounded-xl bg-surface px-4 outline-none focus:ring-2 ring-accent w-full";
  return (
    <AdminShell title="New match" back="/admin/matches">
      <h1 className="display text-4xl mb-1">Create a match</h1>
      <p className="text-sm text-muted mb-6">Manual creation for the MVP. In production this record arrives from the booking provider (Footy Addicts) and the pitch camera is assigned automatically.</p>
      <form action={createMatch} className="grid md:grid-cols-2 gap-4 max-w-3xl">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">Title<input name="title" required placeholder="Tuesday 5s" className={`${input} normal-case tracking-normal text-ink`} /></label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">Kick off<input name="kickoffAt" type="datetime-local" required className={`${input} text-ink`} /></label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">Venue<select name="venueId" className={`${input} text-ink`}>{db.venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">Pitch<select name="pitchId" className={`${input} text-ink`}>{db.pitches.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.format})</option>)}</select></label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">Format<select name="format" className={`${input} text-ink`}><option>5v5</option><option>6v6</option><option>7v7</option></select></label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">Video URL (Vimeo)<input name="videoUrl" placeholder="https://vimeo.com/938101072" className={`${input} normal-case tracking-normal text-ink`} /></label>
        <fieldset className="md:col-span-2">
          <legend className="text-xs uppercase tracking-wider text-muted mb-2">Players (first half of the list → Blue, second half → Orange)</legend>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5">
            {db.playerProfiles.map((p) => (
              <label key={p.id} className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 text-sm"><input type="checkbox" name="playerIds" value={p.id} className="accent-[#c8ff3d]" />{p.displayName}</label>
            ))}
          </div>
        </fieldset>
        <div className="md:col-span-2">
          <button className="h-11 rounded-full bg-accent text-accent-ink px-6 text-sm font-semibold">Create match</button>
        </div>
      </form>
    </AdminShell>
  );
}
