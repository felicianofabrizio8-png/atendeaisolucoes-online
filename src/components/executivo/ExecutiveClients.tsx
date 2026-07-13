// Tabela "Clientes que precisam de atenção".
// Deriva de insights de forgotten_client + lossReasons (sem tocar em dados).
import { UserX } from "lucide-react";
import type { ExecutiveDashboardBundle } from "@/lib/executive-ai/types";

function formatBRL(n: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(n);
}

export function ExecutiveClients({ bundle }: { bundle: ExecutiveDashboardBundle }) {
  const forgotten = bundle.insights.filter((i) => i.category === "forgotten_client");
  const lossRows = bundle.metrics.lossReasons.slice(0, 5);
  const hasAny = forgotten.length > 0 || lossRows.length > 0;

  return (
    <section aria-labelledby="exec-clients-title" className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center gap-2 mb-2">
        <UserX className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 id="exec-clients-title" className="text-base font-semibold text-foreground">
          Clientes que precisam de atenção
        </h2>
      </div>
      <p className="text-[11px] text-muted-foreground mb-4">
        Lista sanitizada: sem nomes ou telefones. Depende de uma extensão futura read-only do endpoint para exibir clientes individuais.
      </p>

      {!hasAny ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Nenhum cliente crítico identificado no período — ou o endpoint ainda não expõe essa lista.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground border-b border-border">
                <th className="text-left font-medium py-2 px-2">Cliente / Segmento</th>
                <th className="text-left font-medium py-2 px-2">Motivo</th>
                <th className="text-left font-medium py-2 px-2">Tempo</th>
                <th className="text-left font-medium py-2 px-2">Risco</th>
                <th className="text-left font-medium py-2 px-2">Ação recomendada</th>
              </tr>
            </thead>
            <tbody>
              {forgotten.map((i) => (
                <tr key={i.id} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 px-2 text-foreground">{i.title}</td>
                  <td className="py-2 px-2 text-muted-foreground">{i.description}</td>
                  <td className="py-2 px-2 text-muted-foreground">—</td>
                  <td className="py-2 px-2">
                    <span className="inline-flex text-[10px] px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500">
                      {i.level === "critical" ? "Alto" : i.level === "warn" ? "Médio" : "Baixo"}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-foreground">{i.recommendation ?? "—"}</td>
                </tr>
              ))}
              {lossRows.map((r) => (
                <tr key={`loss-${r.reason}`} className="border-b border-border/50 hover:bg-muted/30">
                  <td className="py-2 px-2 text-muted-foreground italic">
                    {r.count} perda{r.count === 1 ? "" : "s"} recentes
                  </td>
                  <td className="py-2 px-2 text-foreground">{r.reason || "Motivo não informado"}</td>
                  <td className="py-2 px-2 text-muted-foreground">período atual</td>
                  <td className="py-2 px-2">
                    <span className="inline-flex text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500">
                      Médio
                    </span>
                  </td>
                  <td className="py-2 px-2 text-muted-foreground">
                    Revisar objeções · valor perdido {formatBRL(r.value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
