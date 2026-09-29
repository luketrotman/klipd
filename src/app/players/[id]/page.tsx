import { notFound } from "next/navigation";
import { getViewer } from "@/lib/auth/session";
import { getProfile } from "@/lib/db/queries";
import { BottomNav, Page, TopBar } from "@/components/AppShell";
import PlayerProfileView, { type ProfileTab } from "@/components/PlayerProfileView";

export default async function PlayerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  const viewer = await getViewer();
  const profile = getProfile(id);
  if (!profile) notFound();
  const isMe = viewer?.profile?.id === profile.id;
  return (
    <>
      <TopBar back="/matches" />
      <Page>
        <PlayerProfileView profile={profile} tab={(tab as ProfileTab) ?? "latest"} viewerUserId={viewer?.user.id ?? null} basePath={`/players/${profile.id}`} isMe={isMe} />
      </Page>
      <BottomNav active={isMe ? "profile" : "none"} />
    </>
  );
}
