import type { StatSnapshot } from "@/lib/atendimento/stats";

export function StatCarousel({ stats, activeKey, onSelect }: { stats: StatSnapshot[]; activeKey: string | null; onSelect: (key: string | null) => void }) {
  if (stats.length === 0) return null;
  const active = stats.find((stat) => stat.key === activeKey) ?? stats[0];
  return <button type="button" onClick={() => onSelect(activeKey === active.key ? null : active.key)} className="w-full rounded-3xl bg-secondary/70 p-4 text-left transition hover:bg-secondary"><span className="text-xs font-semibold text-muted-foreground">{active.label}</span><span className="mt-1 block text-3xl font-extrabold tabular-nums">{active.count}</span><span className="text-xs text-muted-foreground">{active.caption}</span></button>;
}
