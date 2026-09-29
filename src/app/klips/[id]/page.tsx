import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getViewer } from "@/lib/auth/session";
import { getKlipCard } from "@/lib/db/queries";
import { BottomNav, Page, TopBar } from "@/components/AppShell";
import KlipPage from "@/components/KlipPage";
import { klipTitle } from "@/lib/domain/present";
import { recordView } from "@/app/actions/klips";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const card = getKlipCard(id);
  return card ? { title: klipTitle(card), openGraph: { images: card.video.thumbnailUrl ? [card.video.thumbnailUrl] : [] } } : {};
}

export default async function InAppKlip({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  const card = getKlipCard(id, viewer?.user.id);
  if (!card) notFound();
  await recordView(id);
  return (
    <>
      <TopBar back={`/matches/${card.match.id}`} />
      <Page>
        <div className="pt-2">
          <KlipPage card={card} publicView={!viewer} />
        </div>
      </Page>
      <BottomNav active="none" />
    </>
  );
}
