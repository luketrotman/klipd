import Link from "next/link";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { signOut } from "@/app/actions/auth";
import { BottomNav, Page, TopBar } from "@/components/AppShell";
import PlayerProfileView, { type ProfileTab } from "@/components/PlayerProfileView";

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  if (!viewer.profile) redirect("/onboarding");
  const { tab } = await searchParams;
  return (
    <>
      <TopBar />
      <Page>
        <PlayerProfileView
          profile={viewer.profile}
          tab={(tab as ProfileTab) ?? "latest"}
          viewerUserId={viewer.user.id}
          basePath="/profile"
          isMe
          actions={
            <div className="flex gap-2 text-xs">
              {viewer.user.isAdmin ? <Link href="/admin" className="rounded-full border border-line px-3 py-2 font-semibold">Admin</Link> : null}
              <form action={signOut}><button className="rounded-full border border-line px-3 py-2 font-semibold text-muted">Sign out</button></form>
            </div>
          }
        />
      </Page>
      <BottomNav active="profile" />
    </>
  );
}
