export default function Skeleton() {
  return (
    <div className="mx-auto max-w-md space-y-3 p-6" aria-busy="true">
      <div className="h-6 w-2/3 animate-pulse rounded bg-ink/10" />
      <div className="h-24 animate-pulse rounded-2xl bg-ink/10" />
    </div>
  );
}
