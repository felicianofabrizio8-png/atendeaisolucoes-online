// ============================================================================
// /onboarding — Zero-Touch Onboarding UI (admin-only)
// Consome exclusivamente:
//   GET /api/onboarding/status
//   GET /api/onboarding/checklist
//   GET /api/onboarding/health
// Nenhuma escrita, nenhuma derivação de status no frontend.
// ============================================================================

import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CheckCircle2,
  Circle,
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
  RefreshCw,
  Sparkles,
  Rocket,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  OnboardingChecklist as ChecklistDTO,
  OnboardingHealth,
  OnboardingHealthIssue,
  OnboardingStatusSnapshot,
  OnboardingStepKey,
  OnboardingTimelineEvent,
  NextBestAction,
  ReadinessScore,
} from "@/lib/onboarding/OnboardingTypes";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});

// ------------------------------------------------------------------
// Mapa: cada etapa → rota existente (nunca criar telas duplicadas).
// ------------------------------------------------------------------
type StepAction = {
  to?: string;
  label: string;
  description: string;
  informative?: boolean; // apenas status, sem ação
};

const STEP_ACTIONS: Record<OnboardingStepKey, StepAction> = {
  company_created: {
    label: "Empresa registrada automaticamente",
    description: "Criada no primeiro acesso do administrador.",
    informative: true,
  },
  admin_created: {
    label: "Administrador identificado",
    description: "Definido no cadastro inicial do responsável.",
    informative: true,
  },
  team_invited: {
    to: "/configuracoes/usuarios",
    label: "Convidar equipe",
    description: "Adicione atendentes e financeiro em Configurações › Usuários.",
  },
  meta_connected: {
    to: "/onboarding/whatsapp",
    label: "Conectar Meta",
    description: "Login Meta oficial — sem inserir tokens manualmente.",
  },
  whatsapp_connected: {
    to: "/onboarding/whatsapp",
    label: "Conectar WhatsApp",
    description: "Vincule sua WABA e número via Embedded Signup.",
  },
  instagram_connected: {
    to: "/onboarding/whatsapp",
    label: "Conectar Instagram",
    description: "Selecione a conta Instagram Business vinculada à sua página.",
  },
  facebook_connected: {
    to: "/onboarding/whatsapp",
    label: "Conectar Facebook",
    description: "Autorize a página Facebook que receberá mensagens.",
  },
  products_added: {
    to: "/produtos",
    label: "Cadastrar produtos",
    description: "A IA precisa do catálogo para recomendar corretamente.",
  },
  templates_synced: {
    to: "/whatsapp",
    label: "Sincronizar templates",
    description: "Importe seus templates aprovados na Meta.",
  },
  professor_initialized: {
    to: "/ia",
    label: "Configurar IA de Atendimento",
    description: "Defina personalidade, objetivo e limites do agente.",
  },
  scientific_memory_created: {
    label: "Scientific Memory automática",
    description:
      "Gerada quando houver histórico operacional suficiente (>30 dias de dados).",
    informative: true,
  },
};

// ------------------------------------------------------------------
// Fetchers — usam a sessão Supabase para bearer token.
// ------------------------------------------------------------------
async function authedGet<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(path, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (res.status === 401) throw new Error("unauthorized");
  if (res.status === 403) throw new Error("forbidden");
  if (!res.ok) throw new Error(`http_${res.status}`);
  return (await res.json()) as T;
}

type StatusResp = { ok: true; snapshot: OnboardingStatusSnapshot } | { ok: false; error: string };
type ChecklistResp =
  | { ok: true; checklist: ChecklistDTO; nextBestAction: NextBestAction | null; readinessScore: ReadinessScore }
  | { ok: false; error: string };
type HealthResp =
  | { ok: true; health: OnboardingHealth; timeline: OnboardingTimelineEvent[] }
  | { ok: false; error: string };

function useOnboardingData(enabled: boolean) {
  const status = useQuery({
    queryKey: ["onboarding", "status"],
    queryFn: () => authedGet<StatusResp>("/api/onboarding/status"),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const checklist = useQuery({
    queryKey: ["onboarding", "checklist"],
    queryFn: () => authedGet<ChecklistResp>("/api/onboarding/checklist"),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  const health = useQuery({
    queryKey: ["onboarding", "health"],
    queryFn: () => authedGet<HealthResp>("/api/onboarding/health"),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
  return { status, checklist, health };
}

// ------------------------------------------------------------------
// Componente principal
// ------------------------------------------------------------------
function OnboardingPage() {
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();
  const { status, checklist, health } = useOnboardingData(isAdmin);

  if (adminLoading) return <PageSkeleton />;

  if (!isAdmin) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="p-6 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-500 mt-0.5" />
          <div>
            <h2 className="text-base font-semibold">Acesso restrito</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Esta página é exclusiva para administradores da empresa.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  const isLoading = status.isLoading || checklist.isLoading || health.isLoading;
  const hasError = status.isError || checklist.isError || health.isError;

  if (isLoading) return <PageSkeleton />;

  if (hasError) {
    const err =
      (status.error as Error | undefined) ||
      (checklist.error as Error | undefined) ||
      (health.error as Error | undefined);
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="p-6">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-base font-semibold">Não foi possível carregar</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {err?.message === "forbidden"
              ? "Sua conta não tem permissão de administrador nesta empresa."
              : err?.message === "unauthorized"
                ? "Sua sessão expirou. Faça login novamente."
                : "Tente novamente em instantes."}
          </p>
          <Button
            className="mt-4"
            variant="outline"
            size="sm"
            onClick={() => {
              status.refetch();
              checklist.refetch();
              health.refetch();
            }}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-2" />
            Tentar novamente
          </Button>
        </Card>
      </div>
    );
  }

  const snapshot = status.data && status.data.ok ? status.data.snapshot : null;
  const check = checklist.data && checklist.data.ok ? checklist.data : null;
  const hlth = health.data && health.data.ok ? health.data : null;

  if (!snapshot || !check || !hlth) return <PageSkeleton />;

  const ready = snapshot.progress >= 100;
  const nba = check.nextBestAction;
  const readinessScore = check.readinessScore.score;

  const refetchAll = () => {
    status.refetch();
    checklist.refetch();
    health.refetch();
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      {/* Cabeçalho */}
      <header className="space-y-1">
        <div className="flex items-center gap-2 text-primary">
          <Sparkles className="h-4 w-4" aria-hidden />
          <span className="text-xs font-semibold uppercase tracking-wide">
            Primeiros passos
          </span>
        </div>
        <h1 className="text-2xl md:text-3xl font-semibold">Configure sua empresa</h1>
        <p className="text-sm text-muted-foreground">
          Conclua as etapas abaixo para começar a atender clientes pelo Atende Ai!
        </p>
      </header>

      {/* Visão geral */}
      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatBlock
            label="Progresso"
            value={`${snapshot.progress}%`}
            hint={statusLabel(snapshot.status)}
          />
          <StatBlock
            label="Readiness Score"
            value={`${readinessScore}/100`}
            hint={`${check.checklist.completedCount}/${check.checklist.totalCount} etapas concluídas`}
          />
          <StatBlock
            label="Situação geral"
            value={ready ? "Pronta para operar" : "Configuração em andamento"}
            hint={
              ready
                ? "Todas as etapas essenciais estão prontas"
                : `${check.checklist.requiredCompletedCount}/${check.checklist.requiredCount} etapas essenciais`
            }
            tone={ready ? "success" : "default"}
          />
        </div>

        <div>
          <Progress value={snapshot.progress} aria-label="Progresso do onboarding" />
        </div>

        {ready ? (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex items-start gap-3">
              <Rocket className="h-5 w-5 text-emerald-500 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">Empresa pronta para operar</p>
                <p className="text-xs text-muted-foreground">
                  Você pode começar a atender pelo Inbox agora mesmo.
                </p>
              </div>
            </div>
            <Button onClick={() => navigate({ to: "/inbox" })}>
              Ir para o Inbox
              <ArrowRight className="h-4 w-4 ml-1.5" />
            </Button>
          </div>
        ) : nba ? (
          <NextBestActionCard action={nba} onNavigate={(to) => navigate({ to })} />
        ) : null}
      </Card>

      {/* Antes de começar — Health */}
      {hlth.issues.length > 0 && (
        <section aria-labelledby="health-title" className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 id="health-title" className="text-lg font-semibold">
              Antes de começar
            </h2>
            <Button variant="ghost" size="sm" onClick={refetchAll}>
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Reverificar
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {hlth.issues.map((issue) => (
              <HealthIssueCard
                key={issue.code}
                issue={issue}
                onFix={(to) => navigate({ to })}
              />
            ))}
          </div>
        </section>
      )}

      {/* Checklist */}
      <section aria-labelledby="checklist-title" className="space-y-3">
        <h2 id="checklist-title" className="text-lg font-semibold">
          Checklist de configuração
        </h2>
        <Card className="divide-y divide-border">
          {check.checklist.items.map((item) => (
            <ChecklistRow
              key={item.key}
              item={item}
              onNavigate={(to) => navigate({ to })}
              isNext={nba?.step === item.key}
            />
          ))}
        </Card>
      </section>

      {/* Timeline */}
      <section aria-labelledby="timeline-title" className="space-y-3">
        <h2 id="timeline-title" className="text-lg font-semibold">
          Atividades recentes
        </h2>
        <Card className="p-4">
          {hlth.timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ainda não há atividades registradas.
            </p>
          ) : (
            <ol className="space-y-3">
              {hlth.timeline.map((ev) => (
                <li key={ev.id} className="flex items-start gap-3 text-sm">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{humanizeEvent(ev.eventType)}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDate(ev.createdAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </section>

      <p className="text-[11px] text-muted-foreground text-center pt-2">
        Status validado diretamente na Meta e no banco. Nada é marcado como
        concluído sem evidência real.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------
// Subcomponentes
// ------------------------------------------------------------------
function StatBlock({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "default" | "success";
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "text-2xl font-semibold mt-0.5",
          tone === "success" && "text-emerald-500",
        )}
      >
        {value}
      </div>
      {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function NextBestActionCard({
  action,
  onNavigate,
}: {
  action: NextBestAction;
  onNavigate: (to: string) => void;
}) {
  const cfg = STEP_ACTIONS[action.step];
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <ArrowRight className="h-5 w-5 text-primary mt-0.5" />
        <div>
          <div className="text-[11px] uppercase tracking-wide text-primary font-semibold">
            Próxima ação recomendada
          </div>
          <p className="text-sm font-semibold mt-0.5">{action.label}</p>
          <p className="text-xs text-muted-foreground">{action.reason}</p>
        </div>
      </div>
      {cfg.to && !cfg.informative ? (
        <Button onClick={() => onNavigate(cfg.to!)}>
          {cfg.label}
          <ArrowRight className="h-4 w-4 ml-1.5" />
        </Button>
      ) : null}
    </div>
  );
}

function ChecklistRow({
  item,
  onNavigate,
  isNext,
}: {
  item: ChecklistDTO["items"][number];
  onNavigate: (to: string) => void;
  isNext: boolean;
}) {
  const cfg = STEP_ACTIONS[item.key];
  const showAction = !item.ok && cfg.to && !cfg.informative;
  return (
    <div
      className={cn(
        "p-4 flex items-start gap-3",
        isNext && !item.ok && "bg-primary/5",
      )}
    >
      <div className="mt-0.5 shrink-0">
        {item.ok ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-500" aria-label="Concluído" />
        ) : (
          <Circle
            className={cn(
              "h-5 w-5",
              item.required ? "text-amber-500" : "text-muted-foreground",
            )}
            aria-label={item.required ? "Pendente essencial" : "Pendente opcional"}
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{item.label}</span>
          {item.required ? (
            <Badge variant="outline" className="text-[10px]">Essencial</Badge>
          ) : (
            <Badge variant="secondary" className="text-[10px]">Opcional</Badge>
          )}
          {cfg.informative && (
            <Badge variant="outline" className="text-[10px]">Automático</Badge>
          )}
          <span className="text-[10px] text-muted-foreground">
            Peso {item.weight}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{cfg.description}</p>
        {item.hint && (
          <p className="text-[11px] text-muted-foreground mt-0.5">{item.hint}</p>
        )}
      </div>
      {showAction && (
        <Button
          size="sm"
          variant={isNext ? "default" : "outline"}
          onClick={() => onNavigate(cfg.to!)}
          className="shrink-0"
        >
          {cfg.label}
          <ArrowRight className="h-3.5 w-3.5 ml-1" />
        </Button>
      )}
    </div>
  );
}

function HealthIssueCard({
  issue,
  onFix,
}: {
  issue: OnboardingHealthIssue;
  onFix: (to: string) => void;
}) {
  const target = HEALTH_ROUTES[issue.code];
  const tone =
    issue.severity === "critical"
      ? "border-destructive/40 bg-destructive/5"
      : issue.severity === "warn"
        ? "border-amber-500/40 bg-amber-500/5"
        : "border-border bg-muted/30";
  const iconColor =
    issue.severity === "critical"
      ? "text-destructive"
      : issue.severity === "warn"
        ? "text-amber-500"
        : "text-muted-foreground";
  return (
    <div className={cn("rounded-lg border p-4 flex items-start gap-3", tone)}>
      <AlertTriangle className={cn("h-4 w-4 mt-0.5 shrink-0", iconColor)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold">{healthTitle(issue.code)}</span>
          <Badge variant="outline" className="text-[10px]">
            {issue.severity === "critical"
              ? "Crítico"
              : issue.severity === "warn"
                ? "Atenção"
                : "Aviso"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{issue.message}</p>
        <p className="text-[10px] text-muted-foreground mt-1">
          Origem: diagnóstico interno · /api/onboarding/health
        </p>
      </div>
      {target && (
        <Button size="sm" variant="outline" onClick={() => onFix(target)}>
          Resolver
        </Button>
      )}
    </div>
  );
}

const HEALTH_ROUTES: Partial<Record<OnboardingHealthIssue["code"], string>> = {
  no_meta: "/onboarding/whatsapp",
  no_whatsapp: "/onboarding/whatsapp",
  no_instagram: "/onboarding/whatsapp",
  no_facebook: "/onboarding/whatsapp",
  no_integration: "/onboarding/whatsapp",
  no_products: "/produtos",
  no_ai_profile: "/ia",
  no_templates: "/whatsapp",
  no_users: "/configuracoes/usuarios",
};

function healthTitle(code: OnboardingHealthIssue["code"]): string {
  const map: Record<OnboardingHealthIssue["code"], string> = {
    no_meta: "Meta não conectada",
    no_whatsapp: "WhatsApp não conectado",
    no_instagram: "Instagram não conectado",
    no_facebook: "Facebook não conectado",
    no_products: "Nenhum produto cadastrado",
    no_ai_profile: "IA sem perfil configurado",
    no_templates: "Templates não sincronizados",
    no_users: "Nenhum funcionário convidado",
    no_integration: "Integração não configurada",
  };
  return map[code];
}

function statusLabel(status: OnboardingStatusSnapshot["status"]): string {
  switch (status) {
    case "pending":
      return "Aguardando início";
    case "in_progress":
      return "Em configuração";
    case "completed":
      return "Concluído";
    case "paused":
      return "Pausado";
  }
}

function humanizeEvent(type: string): string {
  const map: Record<string, string> = {
    company_created: "Empresa criada",
    admin_created: "Administrador definido",
    team_invited: "Funcionário convidado",
    meta_connected: "Meta conectada",
    whatsapp_connected: "WhatsApp conectado",
    instagram_connected: "Instagram conectado",
    facebook_connected: "Facebook conectado",
    products_added: "Produto cadastrado",
    templates_synced: "Templates sincronizados",
    professor_initialized: "IA configurada",
    scientific_memory_created: "Scientific Memory criada",
  };
  return map[type] ?? type.replaceAll("_", " ");
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

function PageSkeleton() {
  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-20 w-full" />
      </Card>
      <Card className="divide-y divide-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="p-4">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3 w-1/2 mt-2" />
          </div>
        ))}
      </Card>
      {/* Evita "unused" warning: Link importado será usado pelo mapa. */}
      <div className="hidden">
        <Link to="/">home</Link>
      </div>
    </div>
  );
}
