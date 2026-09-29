export default function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <img src="/logo.svg" alt="" width={36} height={36} className="h-9 w-9" />
      <span className="font-display text-2xl font-semibold tracking-tight text-ink">Blisscco</span>
    </span>
  );
}
