// Skeleton loading para o Dashboard Executivo.
export function ExecutiveSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="h-20 rounded-xl bg-muted/40" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-muted/40" />
        ))}
      </div>
      <div className="h-64 rounded-xl bg-muted/40" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="h-64 rounded-xl bg-muted/40" />
        <div className="h-64 rounded-xl bg-muted/40" />
      </div>
    </div>
  );
}
