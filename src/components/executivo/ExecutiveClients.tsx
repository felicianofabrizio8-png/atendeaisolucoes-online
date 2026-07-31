// Tabela "Clientes que precisam de atenção".
// Deriva de insights de forgotten_client + lossReasons (sem tocar em dados).
// Mobile-first: no celular as linhas viram cards (sem rolagem horizontal).
import { UserX } from "lucide-react";
import type { ExecutiveDashboardBundle } from "@/lib/executive-ai/types";
import {
  ResponsiveDataView,
  type ResponsiveColumn,
} from "@/components/layout/ResponsiveDataView";

function formatBRL(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n);
}

type ClientRow = {
  key: string;
  client: string;
  clientItalic: boolean;
  reason: string;
  time: string;
  risk: "Alto" | "Médio" | "Baixo";
  action: string;
};

const riskClass: Record<ClientRow["risk"], string> = {
  Alto: "bg-rose-500/10 text-rose-500",
  Médio: "bg-amber-500/10 text-amber-500",
  Baixo: "bg-muted text-muted-foreground",
};

const columns: ReadonlyArray<ResponsiveColumn<ClientRow>> = [
  {
    id: "client",
    header: "Cliente / Segmento",
    role: "primary",
    cell: (r) => <span className={r.clientItalic ? "italic" : undefined}>{r.client}</span>,
  },
  { id: "reason", header: "Motivo", role: "secondary", cell: (r) => r.reason },
  { id: "time", header: "Tempo", cell: (r) => r.time },
  {
    id: "risk",
    header: "Risco",
    role: "badge",
    cell: (r) => (
      <span
        className={`inline-flex text-[10px] px-1.5 py-0.5 rounded ${riskClass[r.risk]}`}
      >
        {r.risk}
      </span>
    ),
  },
  { id: "action", header: "Ação recomendada", cell: (r) => r.action },
];

export function ExecutiveClients({ bundle }: { bundle: ExecutiveDashboardBundle }) {
  const forgotten = bundle.insights.filter((i) => i.category === "forgotten_client");
  const lossRows = bundle.metrics.lossReasons.slice(0, 5);

  const rows: ClientRow[] = [
    ...forgotten.map((i) => ({
      key: i.id,
      client: i.title,
      clientItalic: false,
      reason: i.description,
      time: "—",
      risk: (i.level === "critical" ? "Alto" : i.level === "warn" ? "Médio" : "Baixo") as
        ClientRow["risk"],
      action: i.recommendation ?? "—",
    })),
    ...lossRows.map((r) => ({
      key: `loss-${r.reason}`,
      client: `${r.count} perda${r.count === 1 ? "" : "s"} recentes`,
      clientItalic: true,
      reason: r.reason || "Motivo não informado",
      time: "período atual",
      risk: "Médio" as const,
      action: `Revisar objeções · valor perdido ${formatBRL(r.value)}`,
    })),
  ];

  return (
    <section
      aria-labelledby="exec-clients-title"
      className="rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex items-center gap-2 mb-2">
        <UserX className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <h2 id="exec-clients-title" className="text-base font-semibold text-foreground">
          Clientes que precisam de atenção
        </h2>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">
        Lista sanitizada: sem nomes ou telefones. Depende de uma extensão futura read-only do
        endpoint para exibir clientes individuais.
      </p>

      <ResponsiveDataView
        label="Clientes que precisam de atenção"
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.key}
        emptyState={
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            Nenhum cliente crítico identificado no período — ou o endpoint ainda não expõe essa
            lista.
          </div>
        }
      />
    </section>
  );
}
