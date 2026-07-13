// Saúde do sistema — usa apenas fontes confiáveis do snapshot.
// Sem fonte confiável de status ⇒ "Não monitorado". Não inventa "Online".
import {
  Activity,
  Instagram,
  MessageSquare,
  Facebook,
  Sparkles,
  Database,
  Cloud,
} from "lucide-react";
import type { DataQualityReport } from "@/lib/executive-ai/types";
import { cn } from "@/lib/utils";

type Status = "online" | "warning" | "unmonitored";

interface Row {
  key: string;
  label: string;
  icon: typeof Activity;
  status: Status;
  note: string;
}

const statusMeta: Record<Status, { color: string; dot: string; label: string }> = {
  online: { color: "text-emerald-500", dot: "bg-emerald-500", label: "Ativo" },
  warning: { color: "text-amber-500", dot: "bg-amber-500", label: "Atenção" },
  unmonitored: {
    color: "text-muted-foreground",
    dot: "bg-muted-foreground",
    label: "Não monitorado",
  },
};

function derive(dq: DataQualityReport): Row[] {
  const rowCount = (t: string) => dq.tableRowCounts[t] ?? 0;
  const dbStatus: Status = dq.tablesEmpty.length > 8 ? "warning" : "online";
  const edgeStatus: Status = "online"; // O próprio snapshot 200 comprova.
  return [
    {
      key: "wa",
      label: "WhatsApp",
      icon: MessageSquare,
      status: "unmonitored",
      note: `${rowCount("messages")} msgs no período — sem healthcheck dedicado`,
    },
    {
      key: "ig",
      label: "Instagram",
      icon: Instagram,
      status: "unmonitored",
      note: "Sem healthcheck dedicado neste endpoint",
    },
    {
      key: "fb",
      label: "Facebook",
      icon: Facebook,
      status: "unmonitored",
      note: "Sem healthcheck dedicado neste endpoint",
    },
    {
      key: "ai",
      label: "OpenAI / IA",
      icon: Sparkles,
      status: "unmonitored",
      note: `${rowCount("ai_flow_events")} eventos IA — status não coletado`,
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
      status: edgeStatus,
      note: "Snapshot respondeu 200",
    },
  ];
}

export function ExecutiveSystemHealth({ dataQuality }: { dataQuality: DataQualityReport }) {
  const rows = derive(dataQuality);
  return (
    <section
      aria-labelledby="exec-health-title"
      className="rounded-2xl border border-border bg-card p-5"
    >
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 id="exec-health-title" className="text-base font-semibold text-foreground">
          Saúde do sistema
        </h2>
      </div>
      <p className="text-[11px] text-muted-foreground mb-3">
        Este endpoint não coleta healthchecks de WhatsApp/Instagram/Facebook/OpenAI. Consulte a
        página
        <span className="mx-1 font-medium">Saúde do sistema</span> para status ao vivo.
      </p>
      <ul className="grid grid-cols-2 md:grid-cols-3 gap-3 list-none p-0">
        {rows.map((r) => {
          const meta = statusMeta[r.status];
          const Icon = r.icon;
          return (
            <li
              key={r.key}
              className="flex items-center gap-3 rounded-xl border border-border bg-background/50 p-3"
            >
              <div className="h-9 w-9 rounded-lg bg-muted flex items-center justify-center">
                <Icon className="h-4 w-4 text-foreground" aria-hidden="true" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{r.label}</span>
                  <span
                    className={cn("inline-flex items-center gap-1 text-[10px]", meta.color)}
                    role="status"
                    aria-label={`${r.label}: ${meta.label}`}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} aria-hidden="true" />
                    {meta.label}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate" title={r.note}>
                  {r.note}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {dataQuality.warnings.length > 0 && (
        <div className="mt-3 text-[11px] text-muted-foreground">
          <span className="font-medium">Avisos:</span> {dataQuality.warnings.join(" · ")}
        </div>
      )}
    </section>
  );
}
