import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getViewer } from "@/lib/auth/session";
import { getKlipCard } from "@/lib/db/queries";
import KlipPage from "@/components/KlipPage";
import { klipTitle } from "@/lib/domain/present";
import { recordView } from "@/app/actions/klips";

/** Public share link: /klip/{id}. Works without login. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const card = getKlipCard(id);
  if (!card) return {};
  return {
    title: klipTitle(card),
    description: `${card.match.title} · ${card.venue.name} · KLIPD · Your game. Your moments.`,
    openGraph: { title: klipTitle(card), images: card.video.thumbnailUrl ? [card.video.thumbnailUrl] : [], type: "video.other" },
  };
}

export default async function PublicKlip({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  const card = getKlipCard(id, viewer?.user.id);
  if (!card) notFound();
  await recordView(id);
  return (
    <main className="mx-auto w-full max-w-md flex-1 pb-12">
      <header className="px-4 h-14 flex items-center justify-between">
        <Link href="/" className="display text-2xl tracking-wider">KLIPD</Link>
        <span className="text-[11px] text-muted">Your game. Your moments.</span>
      </header>
      <KlipPage card={card} publicView />
    </main>
  );
}
