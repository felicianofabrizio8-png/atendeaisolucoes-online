import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { getLeadById } from "@/data/leadRepo";
import { resolveSalesAgentMode } from "@/lib/sales-agent-mode";
import { timeAgo } from "@/data/mock";
import { AiLoadChart } from "./charts/AiLoadChart";
import type { DashboardData } from "./useDashboardData";
import { ChartExplorer } from "./charts/ChartExplorer";

export function AICommand({ data }: { data: DashboardData }) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;
  const [mode, setMode] = useState<{ companyId: string; label: string } | null>(null);
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    void supabase
      .from("company_settings")
      // `*`: inclui o botão mestre da Vendedora sem falhar antes da migration dele.
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle()
      .then(({ data: settings, error }) => {
        if (cancelled) return;
        const label =
          error || !settings
            ? "Estado indisponível"
            : resolveSalesAgentMode(settings) === "silent"
              ? "Em avaliação"
              : resolveSalesAgentMode(settings) === "assisted"
                ? "Assistida"
                : settings.ai_auto_reply_enabled
                  ? "Respostas habilitadas"
                  : "Respostas desativadas";
        setMode({ companyId, label });
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);
  const recent = [...data.conversations]
    .filter((item) => item.aiHandling || Boolean(item.aiStatus))
    .sort((a, b) => +new Date(b.lastMessageAt) - +new Date(a.lastMessageAt))
    .slice(0, 4);

  return (
    <section
      aria-labelledby="ai-title"
      className="dash-ai-panel lume-dash-card viz-fade-up col-span-12 overflow-hidden rounded-2xl border border-border bg-card shadow-sm shadow-foreground/5"
      style={{ animationDelay: "300ms" }}
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_240px]">
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="ai-title" className="truncate text-sm font-semibold">
                Vendedora IA
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Atendimento, conclusões e encaminhamentos por canal
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-border bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                {mode && mode.companyId === companyId ? mode.label : "Verificando estado"}
              </span>
              <ChartExplorer title="Vendedora IA" chartClass="dash-ai-panel">
                <AiLoadChart conversations={data.conversations} />
              </ChartExplorer>
            </div>
          </div>

          <AiLoadChart conversations={data.conversations} />

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
