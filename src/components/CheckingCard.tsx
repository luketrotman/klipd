export default function CheckingCard({ title = "Checking your KLIPs" }: { title?: string }) {
  return (
    <div className="rounded-card bg-surface p-4">
      <div className="flex items-center gap-3">
        <span className="w-2.5 h-2.5 rounded-full bg-accent pulse-soft" />
        <div className="min-w-0">
          <div className="display text-2xl leading-none">{title}</div>
          <div className="text-xs text-muted mt-1">A person is checking every moment before it reaches you, so what you see is right. You will get a notification when your game is ready.</div>
        </div>
      </div>
    </div>
  );
}
