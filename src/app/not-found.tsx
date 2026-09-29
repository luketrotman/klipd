import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-md flex-1 grid place-items-center px-4 text-center">
      <div>
        <div className="display text-6xl">Lost the ball</div>
        <p className="text-muted mt-2">That page doesn&apos;t exist.</p>
        <Link href="/home" className="mt-6 inline-flex h-11 items-center rounded-full bg-accent text-accent-ink px-5 text-sm font-semibold">Back to KLIPD</Link>
      </div>
    </main>
  );
}
