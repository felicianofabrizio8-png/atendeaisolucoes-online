import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getLeadById } from "@/data/leadRepo";
import { timeAgo } from "@/data/mock";
import { num, useInView } from "./charts/primitives";
import type { DashboardData } from "./useDashboardData";

const FATIAS = [
  { key: "ativo", label: "Em atendimento", color: "var(--viz-flow-0)" },
  { key: "concluido", label: "Concluídas", color: "var(--viz-flow-2)" },
  { key: "humano", label: "Aguardando humano", color: "var(--viz-3)" },
] as const;

export function AICommand({ data }: { data: DashboardData }) {
  const active = data.conversations.filter((item) => item.aiHandling).length;
  const completed = data.conversations.filter((item) => item.aiStatus === "pre_atendido_ia").length;
  const waitingHuman = data.conversations.filter(
    (item) => item.aiStatus === "aguardando_humano",
  ).length;
  const recent = [...data.conversations]
    .filter((item) => item.aiHandling || Boolean(item.aiStatus))
    .sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt))
    .slice(0, 4);

  const valores: Record<string, number> = {
    ativo: active,
    concluido: completed,
    humano: waitingHuman,
  };
  const total = active + completed + waitingHuman;

  return (
    <section
      aria-labelledby="ai-title"
      className="viz-fade-up col-span-12 overflow-hidden rounded-2xl border border-border bg-card/60"
      style={{ animationDelay: "300ms" }}
    >
      <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="ai-title" className="truncate text-sm font-semibold">
                Vendedora IA
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Como a carga da IA está distribuída agora
              </p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-status-won/25 bg-status-won/10 px-2.5 py-1 text-[11px] font-medium text-status-won">
              <span className="h-1.5 w-1.5 rounded-full bg-status-won motion-safe:animate-pulse" />
              Operando
            </span>
          </div>

          <CargaIA valores={valores} total={total} />

          <Button asChild className="mt-5">
            <Link to="/inbox">
              Acompanhar atendimentos <ArrowRight />
            </Link>
          </Button>
        </div>

        <div className="border-t border-border pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Últimas conversas
          </p>
          {recent.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Nenhuma conversa da IA registrada.
            </p>
          ) : (
            <ul className="space-y-1">
              {recent.map((item) => (
                <li key={item.id}>
                  <Link
                    to="/inbox/$conversationId"
                    params={{ conversationId: item.id }}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-accent/50"
                  >
                    <span className="truncate text-xs font-medium">
                      {getLeadById(item.leadId)?.name ?? "Contato"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {timeAgo(item.lastMessageAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Carga da IA como barra de proporção.
 *
 * Os três números já existiam, cada um num quadradinho com um ícone. Em
 * quadrados separados eles não se comparam: "12, 30, 4" exige somar de
 * cabeça para saber se a IA está dando conta. Na barra, a fatia dourada de
 * "aguardando humano" é a única que pede ação, e o tamanho dela contra o
 * resto é a resposta — sem número nenhum ser lido.
 *
 * Os valores continuam escritos embaixo: a barra dá a proporção, o texto dá a
 * quantidade, e nenhum dos dois substitui o outro.
 */
function CargaIA({ valores, total }: { valores: Record<string, number>; total: number }) {
  const [ref, inView] = useInView<HTMLDivElement>();

  return (
    <div ref={ref} className="mt-5">
      <div className="flex h-2.5 w-full gap-[3px] overflow-hidden rounded-full">
        {total === 0 ? (
          <span className="h-full flex-1 rounded-full" style={{ background: "var(--viz-track)" }} />
        ) : (
          FATIAS.map((fatia, i) => {
            const fracao = (valores[fatia.key] ?? 0) / total;
            if (fracao <= 0) return null;
            return (
              <span
                key={fatia.key}
                className="h-full rounded-full transition-[width] duration-700 ease-out"
                style={{
                  width: inView ? `${fracao * 100}%` : "0%",
                  background: fatia.color,
                  transitionDelay: `${i * 90}ms`,
                }}
              />
            );
          })
        )}
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-3">
        {FATIAS.map((fatia) => (
          <div key={fatia.key} className="min-w-0">
            <dt className="flex items-center gap-1.5 text-[11px] leading-tight text-muted-foreground">
              <span
                aria-hidden
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ background: fatia.color }}
              />
              <span className="min-w-0 truncate">{fatia.label}</span>
            </dt>
            <dd className="mt-1 text-2xl font-bold tabular-nums leading-none text-foreground">
              {num(valores[fatia.key] ?? 0)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
