// Dashboard Executivo — consumidor READ-ONLY de /api/executive/snapshot.
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertCircle, Lock } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useExecutiveSnapshot, SnapshotError, type SnapshotPeriod } from "@/lib/executive-snapshot";
import { ExecutiveHeader } from "@/components/executivo/ExecutiveHeader";
import { ExecutiveKpis } from "@/components/executivo/ExecutiveKpis";
import { ExecutiveInsights } from "@/components/executivo/ExecutiveInsights";
import { ExecutiveCampaigns } from "@/components/executivo/ExecutiveCampaigns";
import { ExecutiveCoach } from "@/components/executivo/ExecutiveCoach";
import { ExecutiveClients } from "@/components/executivo/ExecutiveClients";
import { ExecutiveSystemHealth } from "@/components/executivo/ExecutiveSystemHealth";
import { ExecutiveSkeleton } from "@/components/executivo/ExecutiveSkeleton";

export const Route = createFileRoute("/executivo")({
  component: ExecutivePage,
});

function ExecutivePage() {
  const { user, profile } = useAuth();
  const [period, setPeriod] = useState<SnapshotPeriod>("30d");
  const query = useExecutiveSnapshot(period);

  const displayName =
    profile?.display_name?.split(/\s+/)[0] ?? user?.email?.split("@")[0] ?? "Executivo";

  const err = query.error;
  const forbidden =
    err instanceof SnapshotError && (err.status === 403 || err.status === 401);

  return (
    <main className="flex-1 overflow-y-auto bg-background" aria-labelledby="exec-page-title">
      <h1 id="exec-page-title" className="sr-only">Dashboard Executivo</h1>
      <div className="mx-auto max-w-7xl p-4 md:p-6 space-y-6 animate-in fade-in duration-500" aria-live="polite" aria-busy={query.isFetching}>
        <ExecutiveHeader
          displayName={displayName}
          generatedAt={query.data?.generatedAt}
          isFetching={query.isFetching}
          onRefresh={() => query.refetch()}
          period={period}
          onPeriodChange={setPeriod}
        />

        {forbidden ? (
          <div className="rounded-2xl border border-border bg-card p-10 text-center">
            <Lock className="h-8 w-8 mx-auto text-muted-foreground" />
            <h2 className="mt-3 text-lg font-semibold text-foreground">Acesso restrito</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              O Dashboard Executivo está disponível apenas para administradores da empresa.
            </p>
          </div>
        ) : query.isLoading ? (
          <ExecutiveSkeleton />
        ) : err ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-rose-500 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-foreground">Falha ao carregar snapshot</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {err instanceof SnapshotError ? err.code : "Erro desconhecido"}. Tente
                  atualizar novamente em instantes.
                </p>
                <button
                  onClick={() => query.refetch()}
                  className="mt-3 inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Tentar novamente
                </button>
              </div>
            </div>
          </div>
        ) : query.data ? (
          <>
            <ExecutiveKpis metrics={query.data.metrics} dataQuality={query.data.dataQuality} />
            <ExecutiveInsights
              insights={query.data.insights}
              generatedAt={query.data.generatedAt}
            />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <ExecutiveClients bundle={query.data} />
              <ExecutiveCampaigns campaigns={query.data.metrics.campaigns} />
            </div>
            <ExecutiveCoach bundle={query.data} />
            <ExecutiveSystemHealth dataQuality={query.data.dataQuality} />
          </>
        ) : null}
      </div>
    </div>
  );
}
