// Saúde do sistema — derivada do dataQuality do snapshot.
// Não faz novas chamadas; apenas classifica com base em warnings e volumes.
import { Activity, Instagram, MessageSquare, Facebook, Sparkles, Database, Cloud } from "lucide-react";
import type { DataQualityReport } from "@/lib/executive-ai/types";
import { cn } from "@/lib/utils";

type Status = "online" | "warning" | "offline";

interface Row {
  key: string;
  label: string;
  icon: typeof Activity;
  status: Status;
  note: string;
}

const statusMeta: Record<Status, { color: string; dot: string; label: string }> = {
  online: { color: "text-emerald-500", dot: "bg-emerald-500", label: "Online" },
  warning: { color: "text-amber-500", dot: "bg-amber-500", label: "Atenção" },
  offline: { color: "text-rose-500", dot: "bg-rose-500", label: "Offline" },
};

function derive(dq: DataQualityReport): Row[] {
  const warnStr = dq.warnings.join(" ").toLowerCase();
  const rowCount = (t: string) => dq.tableRowCounts[t] ?? 0;
  const hasData = (tables: string[]) => tables.some((t) => rowCount(t) > 0);

  const waStatus: Status = warnStr.includes("whatsapp") ? "warning" : "online";
  const igStatus: Status = warnStr.includes("instagram") ? "warning" : "online";
  const fbStatus: Status = warnStr.includes("facebook") ? "warning" : "online";
  const aiStatus: Status = hasData(["ai_flow_events"]) ? "online" : "warning";
  const dbStatus: Status = dq.tablesEmpty.length > 8 ? "warning" : "online";
  const fnStatus: Status = "online";

  return [
    {
      key: "wa",
      label: "WhatsApp",
      icon: MessageSquare,
      status: waStatus,
      note: `${rowCount("messages")} mensagens no período`,
    },
    {
      key: "ig",
      label: "Instagram",
      icon: Instagram,
      status: igStatus,
      note: "Consumindo webhook Meta",
    },
    {
      key: "fb",
      label: "Facebook",
      icon: Facebook,
      status: fbStatus,
      note: "Consumindo webhook Meta",
    },
    {
      key: "ai",
      label: "OpenAI / IA",
      icon: Sparkles,
      status: aiStatus,
      note: `${rowCount("ai_flow_events")} eventos IA`,
    },
    {
      key: "db",
      label: "Supabase",
      icon: Database,
      status: dbStatus,
      note: `${dq.tablesQueried.length - dq.tablesEmpty.length}/${dq.tablesQueried.length} tabelas com dados`,
    },
    {
      key: "edge",
      label: "Edge Functions",
      icon: Cloud,
      status: fnStatus,
      note: "Snapshot respondeu OK",
    },
  ];
}

export function ExecutiveSystemHealth({ dataQuality }: { dataQuality: DataQualityReport }) {
  const rows = derive(dataQuality);
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4 text-primary" />
        <h2 className="text-base font-semibold text-foreground">Saúde do sistema</h2>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {rows.map((r) => {
          const meta = statusMeta[r.status];
          const Icon = r.icon;
          return (
            <div
              key={r.key}
              className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-3"
            >
              <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                <Icon className="h-4 w-4 text-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{r.label}</span>
                  <span className={cn("inline-flex items-center gap-1 text-[10px]", meta.color)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} />
                    {meta.label}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">{r.note}</div>
              </div>
            </div>
          );
        })}
      </div>
      {dataQuality.warnings.length > 0 && (
        <div className="mt-3 text-[11px] text-muted-foreground">
          <span className="font-medium">Avisos:</span> {dataQuality.warnings.join(" · ")}
        </div>
      )}
    </section>
  );
}
