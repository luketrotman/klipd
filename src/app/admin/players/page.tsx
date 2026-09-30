import { requireAdmin } from "@/lib/auth/admin";
import { getDb } from "@/lib/db/store";
import { addPlayers } from "@/app/actions/admin";
import AdminShell from "@/components/AdminShell";

export default async function AdminPlayers({ searchParams }: { searchParams: Promise<{ added?: string }> }) {
  await requireAdmin();
  const { added } = await searchParams;
  const db = getDb();
  const rows = [...db.playerProfiles].sort((a, b) => a.displayName.localeCompare(b.displayName));
  return (
    <AdminShell title="Players" back="/admin">
      <h1 className="display text-4xl mb-1">Players</h1>
      <p className="text-sm text-muted mb-6">Add booked players by email. When they sign in with that email they are linked to this profile automatically and their moments appear.</p>
      {added ? <p className="mb-4 text-sm text-accent">Added or matched {added} players.</p> : null}
      <form action={addPlayers} className="mb-8 max-w-2xl">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wider text-muted">Paste players, one per line: Name, email
          <textarea name="roster" rows={5} required placeholder={"Luke Trotman, luke@example.com\nJames Okafor, james@example.com"} className="rounded-xl bg-surface px-4 py-3 text-sm normal-case tracking-normal text-ink outline-none focus:ring-2 ring-accent" />
        </label>
        <button className="mt-3 h-11 rounded-full bg-accent text-accent-ink px-6 text-sm font-semibold">Add players</button>
      </form>
      <div className="overflow-x-auto rounded-2xl bg-surface">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted"><tr><th className="px-4 py-3">Player</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">Account</th><th className="px-4 py-3 text-right">Games</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t border-line/50">
                <td className="px-4 py-2 font-semibold">{p.displayName}</td>
                <td className="px-4 py-2 text-muted">{p.email ?? db.users.find((u) => u.id === p.userId)?.email ?? "-"}</td>
                <td className="px-4 py-2">{p.userId ? <span className="text-accent text-xs font-bold">SIGNED UP</span> : <span className="text-muted text-xs">waiting</span>}</td>
                <td className="px-4 py-2 text-right tabular-nums">{db.matchPlayers.filter((m) => m.playerId === p.id).length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
