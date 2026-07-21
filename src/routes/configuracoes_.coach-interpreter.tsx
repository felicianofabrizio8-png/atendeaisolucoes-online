// ============================================================================
// FASE 3.0 — UI Administrativa isolada do Coach Interpreter.
//
// Escopo estrito:
//  - Somente admins podem abrir esta rota (guard client-side; barreira real é a
//    RLS/ACL do banco). Consome EXCLUSIVAMENTE as server functions da Fase 2.b
//    (`src/lib/coach-interpreter/coach-interpreter.functions.ts`).
//  - Nenhuma chamada direta a Supabase ou RPC; nenhuma lógica nova.
//  - Nenhuma integração com o CoachPanel V1, com o AgentRuntime, com prompts do
//    agente ou com a feature flag em produção (a flag é apenas consultada via
//    server function; nunca ativada aqui).
// ============================================================================
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ShieldAlert,
  Loader2,
  MessageSquare,
  Search,
  Send,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  
  Pencil,
  Trash2,
  Sparkles,
  Info,
  Copy,
  Clock,
} from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  listCoachConversationsFn,
  getCoachConversationFn,
  sendCoachMessageFn,
  createCoachConversationFn,
  retryCoachInterpretationFn,
  updateCoachProposalFn,
  discardCoachProposalFn,
  confirmCoachProposalFn,
} from "@/lib/coach-interpreter/coach-interpreter.functions";
import {
  getSafeInterpreterError,
  type SafeInterpreterError,
} from "@/lib/coach-interpreter/errors";

// ------------------------------------------------------------------
// Labels reaproveitados (server-safe consts vindas do módulo de regras).
// Não redefinimos categorias/tipos aqui; a fonte de verdade é a Fase 1.
import {
  COACH_CATEGORY_LABEL,
  COACH_TYPE_LABEL,
  type CoachRuleCategory,
  type CoachRuleType,
} from "@/lib/coach-rules/coach-rules.repository";

// ------------------------------------------------------------------
// Route
// ------------------------------------------------------------------
export const Route = createFileRoute("/configuracoes_/coach-interpreter")({
  component: InterpreterAdminPage,
  head: () => ({
    meta: [
      { title: "Coach Interpreter — Console Admin" },
      {
        name: "description",
        content:
          "Console administrativo para inspecionar conversas, mensagens e proposals do Coach Interpreter (Fase 2).",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  errorComponent: ({ error, reset }) => {
    const safe = getSafeInterpreterError(error);
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
          <h2 className="font-semibold text-destructive">Erro ao carregar Coach Interpreter</h2>
          <p className="text-sm text-muted-foreground mt-1 break-words">{safe.message}</p>
          <p className="text-[11px] text-muted-foreground mt-1 font-mono">code: {safe.code}</p>
          <button
            type="button"
            onClick={() => reset()}
            className="mt-3 text-sm text-primary underline"
          >
            Tentar novamente
          </button>
        </div>
      </div>
    );
  },
});

// ------------------------------------------------------------------
// Guard admin — 3.1a: sem flash. Enquanto (a) auth ainda carrega e user é
// desconhecido, (b) status de admin está sendo consultado, renderizamos
// apenas o spinner. O redirect para /login é agendado por useEffect no
// próximo tick — o spinner cobre esse intervalo.
// ------------------------------------------------------------------
// Corpo do console admin: guard + shell. Extraído em função separada porque
// o TanStack auto code-splitter REMOVE do módulo qualquer função usada como
// `component:` de rota. O corpo aqui NÃO é referenciado pelas opções da
// rota, então sobrevive e pode ser reaproveitado pelos testes via __test__.
function AdminPageBody() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();

  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/login" });
  }, [authLoading, user, navigate]);

  // Guard "sem flash": mostra spinner enquanto qualquer sinal de auth/admin
  // estiver indeterminado. Só decide após ambos concluírem.
  if (authLoading || !user || adminLoading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        data-testid="interpreter-guard-loading"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="sr-only">Verificando acesso…</span>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto p-8">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <h2 className="font-semibold">Acesso restrito</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Somente administradores podem acessar o console do Coach Interpreter.
            </p>
            <Link to="/configuracoes" className="text-sm text-primary underline mt-2 inline-block">
              Voltar para Configurações
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return <InterpreterShell />;
}

function InterpreterAdminPage() {
  return <AdminPageBody />;
}

// ------------------------------------------------------------------
// Types locais (espelham o retorno das server functions)
// ------------------------------------------------------------------
type ConversationRow = {
  id: string;
  company_id: string;
  owner_user_id: string | null;
  title: string | null;
  status: string;
  last_message_at: string | null;
  created_at: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  kind: string;
  author_user_id: string | null;
  content: string;
  payload: unknown;
  run: unknown;
  client_request_id: string | null;
  created_at: string;
};

type ProposalRow = {
  id: string;
  conversation_id: string;
  source_message_id: string;
  status: string;
  title: string;
  category: string;
  rule_type: string;
  scope_kind: string;
  scope_ref: unknown;
  priority: number;
  instruction: string;
  confidence: number;
  risk_level: string;
  warnings: unknown;
  normalized_output: unknown;
  created_at: string;
};

// ------------------------------------------------------------------
// Shell — layout master + detecção de feature flag desabilitada.
// ------------------------------------------------------------------
function InterpreterShell() {
  const listFn = useServerFn(listCoachConversationsFn);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ["coach-interpreter", "conversations"],
    queryFn: () => listFn(),
    retry: false,
  });

  // Feature flag / erros — passamos qualquer error do listQ pelo helper
  // seguro `getSafeInterpreterError`, que devolve { code, message, disabled,
  // killed, ... }. NUNCA usamos `String(err)` ou `.toString()` aqui.
  const listSafe: SafeInterpreterError | null = listQ.error
    ? getSafeInterpreterError(listQ.error)
    : null;

  if (listSafe?.disabled || listSafe?.killed) {
    return <FeatureDisabledScreen reason={listSafe.message} />;
  }

  return (
    <div className="flex flex-col h-full">
      <header className="border-b border-border px-4 py-3 flex items-center gap-3">
        <Link to="/configuracoes" className="p-1.5 rounded hover:bg-accent">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Coach Interpreter — Console Admin
            <span className="text-[10px] uppercase font-bold tracking-wide bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">
              Beta • Fase 2
            </span>
          </h1>
          <p className="text-xs text-muted-foreground">
            Inspeção read/write de conversas, mensagens e proposals. Isolado do agente em produção.
          </p>
        </div>
        <NewConversationButton
          onCreated={(id) => setSelectedId(id)}
          onDisabled={() => listQ.refetch()}
        />
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(300px,380px)_1fr] overflow-hidden">
        <ConversationsPanel
          conversations={listQ.data?.conversations ?? []}
          loading={listQ.isLoading}
          error={listSafe}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onRefresh={() => listQ.refetch()}
        />
        <section className="overflow-y-auto">
          {selectedId ? (
            <ConversationView conversationId={selectedId} />
          ) : (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-8 text-center">
              Selecione uma conversa à esquerda ou crie uma nova para inspecionar mensagens,
              timeline e proposals.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Feature flag disabled screen (mantido; agora consumido a partir do
// contrato SafeInterpreterError).
// ------------------------------------------------------------------
/**
 * @deprecated 3.1a — use `getSafeInterpreterError`. Mantido apenas para
 * compatibilidade com testes existentes que checam labels de flag.
 */
function extractDisabledMessage(err: unknown): string | null {
  const safe = getSafeInterpreterError(err);
  if (safe.disabled || safe.killed) return safe.message;
  return null;
}

function FeatureDisabledScreen({ reason }: { reason: string }) {
  return (
    <div className="max-w-2xl mx-auto p-8">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h2 className="font-semibold">Recurso desabilitado</h2>
            <p className="text-sm text-muted-foreground mt-1">{reason}</p>
            <p className="text-xs text-muted-foreground mt-3">
              O Console do Coach Interpreter só funciona quando a feature flag{" "}
              <code className="font-mono text-[11px] bg-muted px-1 py-0.5 rounded">
                coach_interpreter_enabled
              </code>{" "}
              está ligada. Ativação é responsabilidade explícita da equipe backend; nenhuma UI
              administrativa pode alterá-la.
            </p>
            <Link to="/configuracoes" className="text-sm text-primary underline mt-3 inline-block">
              Voltar para Configurações
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Conversations list — pesquisa + paginação + status.
// ------------------------------------------------------------------
const PAGE_SIZE = 15;

function ConversationsPanel({
  conversations,
  loading,
  error,
  selectedId,
  onSelect,
  onRefresh,
}: {
  conversations: ConversationRow[];
  loading: boolean;
  error: SafeInterpreterError | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => {
      const title = (c.title ?? "").toLowerCase();
      return title.includes(q) || c.id.toLowerCase().includes(q);
    });
  }, [conversations, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const clampedPage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(clampedPage * PAGE_SIZE, (clampedPage + 1) * PAGE_SIZE);

  return (
    <aside className="border-r border-border overflow-hidden flex flex-col">
      <div className="p-2 border-b border-border flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            type="search"
            aria-label="Buscar conversa"
            placeholder="Buscar por título ou ID…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(0);
            }}
            className="w-full h-8 pl-7 pr-2 rounded-md bg-background border border-border text-xs focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Recarregar conversas"
          className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando conversas…
          </div>
        ) : error ? (
          <ErrorBanner
            title="Falha ao carregar conversas"
            error={error}
            onRetry={onRefresh}
            testId="conversations-error"
          />
        ) : pageRows.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Nenhuma conversa encontrada.
          </div>
        ) : (
          <ul className="space-y-1" data-testid="conversations-list">
            {pageRows.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => onSelect(c.id)}
                  className={cn(
                    "w-full text-left rounded-md px-3 py-2 hover:bg-accent",
                    selectedId === c.id && "bg-accent",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate flex-1">
                      {c.title?.trim() || "(sem título)"}
                    </span>
                    <ConversationStatusBadge status={c.status} />
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1 flex gap-2 flex-wrap">
                    <span>{formatDateTime(c.last_message_at ?? c.created_at)}</span>
                    <span>·</span>
                    <span className="font-mono truncate">
                      {c.owner_user_id ? c.owner_user_id.slice(0, 8) : "—"}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {filtered.length > PAGE_SIZE && (
        <div className="border-t border-border p-2 flex items-center justify-between text-xs text-muted-foreground">
          <button
            type="button"
            disabled={clampedPage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            className="h-7 px-2 rounded hover:bg-accent disabled:opacity-40"
          >
            Anterior
          </button>
          <span>
            Página {clampedPage + 1} / {totalPages}
          </span>
          <button
            type="button"
            disabled={clampedPage >= totalPages - 1}
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            className="h-7 px-2 rounded hover:bg-accent disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      )}
    </aside>
  );
}

function NewConversationButton({
  onCreated,
  onDisabled,
}: {
  onCreated: (id: string) => void;
  /** Disparado quando o backend retorna feature flag desligada / kill-switch. */
  onDisabled: () => void;
}) {
  const qc = useQueryClient();
  const createFn = useServerFn(createCoachConversationFn);
  const m = useMutation({
    mutationFn: () => createFn({ data: { title: `Console — ${new Date().toLocaleString()}` } }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["coach-interpreter", "conversations"] });
      if (res?.conversation?.id) onCreated(res.conversation.id);
    },
    onError: (err) => {
      const safe = getSafeInterpreterError(err);
      if (safe.disabled || safe.killed) onDisabled();
    },
  });
  const safeErr = m.error ? getSafeInterpreterError(m.error) : null;
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => m.mutate()}
        disabled={m.isPending}
        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
      >
        {m.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <MessageSquare className="h-4 w-4" />
        )}
        Nova conversa
      </button>
      {safeErr && !safeErr.disabled && !safeErr.killed && (
        <span className="text-[11px] text-destructive" data-testid="new-conversation-error">
          {safeErr.message}
        </span>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Error banner reutilizável — sempre lê o contrato SafeInterpreterError,
// nunca `String(err)` nem `.toString()`. Pode ser usado em qualquer painel
// (listagem, timeline, composer, retry).
// ------------------------------------------------------------------
function ErrorBanner({
  title,
  error,
  onRetry,
  testId,
}: {
  title: string;
  error: SafeInterpreterError;
  onRetry?: () => void;
  testId?: string;
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      data-testid={testId}
      className="m-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-destructive">{title}</div>
          <div className="text-foreground mt-0.5 break-words">{error.message}</div>
          <div className="text-[10px] font-mono text-muted-foreground mt-0.5">
            code: {error.code}
          </div>
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="text-[11px] text-primary hover:underline shrink-0"
          >
            Tentar novamente
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------
// Conversation view — chat + timeline + proposals + filtros.
// ------------------------------------------------------------------
type ProposalFilters = {
  category: string;
  ruleType: string;
  status: string;
  minConfidence: number;
  ownerUser: string;
  dateFrom: string;
  dateTo: string;
};

const DEFAULT_FILTERS: ProposalFilters = {
  category: "",
  ruleType: "",
  status: "",
  minConfidence: 0,
  ownerUser: "",
  dateFrom: "",
  dateTo: "",
};

function ConversationView({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getCoachConversationFn);
  const q = useQuery({
    queryKey: ["coach-interpreter", "conversation", conversationId],
    queryFn: () => getFn({ data: { conversation_id: conversationId } }),
    retry: false,
  });

  const [filters, setFilters] = useState<ProposalFilters>(DEFAULT_FILTERS);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["coach-interpreter", "conversation", conversationId] });
    qc.invalidateQueries({ queryKey: ["coach-interpreter", "conversations"] });
  };

  const safe = q.error ? getSafeInterpreterError(q.error) : null;
  if (safe?.disabled || safe?.killed) return <FeatureDisabledScreen reason={safe.message} />;

  if (q.isLoading) {
    return (
      <div className="p-8 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando conversa…
      </div>
    );
  }
  if (safe) {
    return (
      <div className="p-4">
        <ErrorBanner
          title="Erro ao carregar a conversa"
          error={safe}
          onRetry={() => q.refetch()}
          testId="conversation-error"
        />
      </div>
    );
  }
  if (!q.data) return null;

  const conv = q.data.conversation as ConversationRow;
  const messages = (q.data.messages ?? []) as MessageRow[];
  const proposals = (q.data.proposals ?? []) as ProposalRow[];

  const filteredProposals = proposals.filter((p) => {
    if (filters.category && p.category !== filters.category) return false;
    if (filters.ruleType && p.rule_type !== filters.ruleType) return false;
    if (filters.status && p.status !== filters.status) return false;
    if (p.confidence < filters.minConfidence) return false;
    if (filters.dateFrom && p.created_at < filters.dateFrom) return false;
    if (filters.dateTo && p.created_at > filters.dateTo + "T23:59:59") return false;
    if (filters.ownerUser) {
      const owner = messages.find((m) => m.id === p.source_message_id)?.author_user_id ?? "";
      if (!owner.toLowerCase().includes(filters.ownerUser.toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_minmax(320px,420px)] h-full">
      <div className="flex flex-col min-h-0 border-r border-border">
        <div className="border-b border-border p-3">
          <h2 className="text-sm font-semibold truncate">{conv.title || "(sem título)"}</h2>
          <div className="text-[11px] text-muted-foreground flex gap-2 flex-wrap mt-0.5">
            <span className="font-mono">{conv.id.slice(0, 8)}</span>
            <span>·</span>
            <ConversationStatusBadge status={conv.status} />
            <span>·</span>
            <span>Criada {formatDateTime(conv.created_at)}</span>
          </div>
        </div>

        <ChatTimeline messages={messages} conversationId={conv.id} onChanged={invalidate} />
        <MessageComposer conversationId={conv.id} onSent={invalidate} />
      </div>

      <aside className="min-h-0 overflow-y-auto p-3">
        <ProposalFilterBar filters={filters} onChange={setFilters} proposals={proposals} />
        <div className="mt-3 space-y-3">
          {filteredProposals.length === 0 ? (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              Nenhuma proposal para os filtros atuais.
            </div>
          ) : (
            filteredProposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} onChanged={invalidate} />
            ))
          )}
        </div>
      </aside>
    </div>
  );
}

// ------------------------------------------------------------------
// Chat timeline
// ------------------------------------------------------------------
function ChatTimeline({
  messages,
  conversationId,
  onChanged,
}: {
  messages: MessageRow[];
  conversationId: string;
  onChanged: () => void;
}) {
  const retryFn = useServerFn(retryCoachInterpretationFn);
  const retryM = useMutation({
    mutationFn: (userMessageId: string) =>
      retryFn({ data: { conversation_id: conversationId, user_message_id: userMessageId } }),
    onSuccess: onChanged,
  });

  // Auto-scroll para o fim quando novas mensagens chegam.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const retryError =
    retryM.error && retryM.variables
      ? { messageId: retryM.variables, safe: getSafeInterpreterError(retryM.error) }
      : null;

  return (
    <div
      ref={scrollRef}
      className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3"
      data-testid="chat-timeline"
    >
      {messages.length === 0 ? (
        <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
          Nenhuma mensagem ainda. Envie a primeira abaixo.
        </div>
      ) : (
        messages.map((m) => (
          <div key={m.id}>
            <MessageBubble
              message={m}
              onRetry={m.kind === "user_message" ? () => retryM.mutate(m.id) : undefined}
              retrying={retryM.isPending && retryM.variables === m.id}
            />
            {retryError && retryError.messageId === m.id && (
              <div className="mt-2 flex justify-end">
                <div className="max-w-[85%]">
                  <ErrorBanner
                    title="Falha ao reinterpretar"
                    error={retryError.safe}
                    onRetry={() => retryM.mutate(m.id)}
                    testId={`retry-error-${m.id}`}
                  />
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function MessageBubble({
  message,
  onRetry,
  retrying,
}: {
  message: MessageRow;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const meta = KIND_META[message.kind] ?? DEFAULT_KIND_META;
  const isUser = message.kind === "user_message";
  return (
    <div
      className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}
      data-message-kind={message.kind}
    >
      <div className={cn("max-w-[85%] rounded-lg border px-3 py-2 text-sm", meta.bubble)}>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide opacity-80 mb-1">
          <meta.Icon className="h-3 w-3" />
          {meta.label}
          <span className="opacity-60 font-normal ml-1">
            · {formatDateTime(message.created_at)}
          </span>
        </div>
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
        {onRetry && (
          <div className="mt-2 flex justify-end">
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="text-[11px] inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-50"
            >
              {retrying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Reinterpretar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

type KindMeta = {
  label: string;
  Icon: typeof MessageSquare;
  bubble: string;
};

const KIND_META: Record<string, KindMeta> = {
  user_message: {
    label: "Usuário",
    Icon: MessageSquare,
    bubble: "bg-primary text-primary-foreground border-primary/40",
  },
  assistant_message: {
    label: "Interpreter",
    Icon: Sparkles,
    bubble: "bg-muted border-border",
  },
  clarification_request: {
    label: "Clarification",
    Icon: Info,
    bubble: "bg-blue-500/10 border-blue-500/30 text-foreground",
  },
  confirmation_ack: {
    label: "Confirmação",
    Icon: CheckCircle2,
    bubble: "bg-emerald-500/10 border-emerald-500/30 text-foreground",
  },
  error: {
    label: "Erro",
    Icon: AlertTriangle,
    bubble: "bg-destructive/10 border-destructive/30 text-foreground",
  },
};
const DEFAULT_KIND_META: KindMeta = {
  label: "Mensagem",
  Icon: MessageSquare,
  bubble: "bg-muted border-border",
};

// ------------------------------------------------------------------
// Composer
// ------------------------------------------------------------------
function MessageComposer({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent: () => void;
}) {
  const [text, setText] = useState("");
  // Idempotência visual: um único client_request_id por "tentativa lógica".
  // Só reciclamos após uma resposta bem-sucedida do servidor (nova mensagem
  // do usuário). Se der erro, mantemos o mesmo UUID para que reenviar caia
  // no caminho idempotente do backend (duplicate_*).
  const requestIdRef = useRef<string>(crypto.randomUUID());
  const sendFn = useServerFn(sendCoachMessageFn);
  const m = useMutation({
    mutationFn: (payload: string) =>
      sendFn({
        data: {
          conversation_id: conversationId,
          text: payload,
          client_request_id: requestIdRef.current,
        },
      }),
    onSuccess: () => {
      setText("");
      requestIdRef.current = crypto.randomUUID();
      onSent();
    },
    // NÃO limpar texto em erro — preservação exigida pela Fase 3.1a.
  });

  const safeErr = m.error ? getSafeInterpreterError(m.error) : null;

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || m.isPending) return;
    m.mutate(trimmed);
  };

  return (
    <div className="border-t border-border">
      {safeErr && (
        <ErrorBanner
          title="Falha ao enviar mensagem"
          error={safeErr}
          onRetry={submit}
          testId="composer-error"
        />
      )}
      <form
        className="p-3 flex gap-2 items-end"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          aria-label="Mensagem para o Interpreter"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Descreva uma regra ou instrução para o Coach interpretar… (Enter envia, Shift+Enter quebra linha)"
          rows={2}
          data-testid="composer-textarea"
          data-request-id={requestIdRef.current}
          className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={m.isPending || text.trim().length === 0}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60"
        >
          {m.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Enviar
        </button>
      </form>
    </div>
  );
}

// ------------------------------------------------------------------
// Proposal filters
// ------------------------------------------------------------------
function ProposalFilterBar({
  filters,
  onChange,
  proposals,
}: {
  filters: ProposalFilters;
  onChange: (f: ProposalFilters) => void;
  proposals: ProposalRow[];
}) {
  const statuses = useMemo(
    () => Array.from(new Set(proposals.map((p) => p.status))).sort(),
    [proposals],
  );
  const categories = useMemo(
    () => Array.from(new Set(proposals.map((p) => p.category))).sort(),
    [proposals],
  );
  const ruleTypes = useMemo(
    () => Array.from(new Set(proposals.map((p) => p.rule_type))).sort(),
    [proposals],
  );

  const update = <K extends keyof ProposalFilters>(k: K, v: ProposalFilters[K]) =>
    onChange({ ...filters, [k]: v });

  return (
    <div className="rounded-md border border-border p-3 space-y-2 text-xs">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Proposals ({proposals.length})</h3>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="text-[11px] text-primary hover:underline"
        >
          Limpar filtros
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <FilterSelect
          label="Categoria"
          value={filters.category}
          options={categories.map((c) => ({
            value: c,
            label: COACH_CATEGORY_LABEL[c as CoachRuleCategory] ?? c,
          }))}
          onChange={(v) => update("category", v)}
        />
        <FilterSelect
          label="Tipo"
          value={filters.ruleType}
          options={ruleTypes.map((t) => ({
            value: t,
            label: COACH_TYPE_LABEL[t as CoachRuleType] ?? t,
          }))}
          onChange={(v) => update("ruleType", v)}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          options={statuses.map((s) => ({ value: s, label: PROPOSAL_STATUS_LABEL[s] ?? s }))}
          onChange={(v) => update("status", v)}
        />
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Confidence min</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={filters.minConfidence}
            onChange={(e) => update("minConfidence", Number(e.target.value) || 0)}
            className="h-7 rounded border border-border bg-background px-2 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Usuário (autor)</span>
          <input
            type="text"
            value={filters.ownerUser}
            onChange={(e) => update("ownerUser", e.target.value)}
            placeholder="uuid parcial"
            className="h-7 rounded border border-border bg-background px-2 text-xs font-mono"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">De</span>
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(e) => update("dateFrom", e.target.value)}
            className="h-7 rounded border border-border bg-background px-2 text-xs"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted-foreground">Até</span>
          <input
            type="date"
            value={filters.dateTo}
            onChange={(e) => update("dateTo", e.target.value)}
            className="h-7 rounded border border-border bg-background px-2 text-xs"
          />
        </label>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-7 rounded border border-border bg-background px-2 text-xs"
      >
        <option value="">Todos</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ------------------------------------------------------------------
// Proposal card
// ------------------------------------------------------------------
const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  edited: "Edited",
  discarded: "Discarded",
  confirmed: "Confirmed",
  failed: "Failed",
  clarification: "Clarification",
  classified: "Classified",
  duplicate: "Duplicate",
};

const PROPOSAL_STATUS_STYLE: Record<string, string> = {
  pending: "bg-muted text-foreground border-border",
  edited: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  discarded: "bg-muted text-muted-foreground border-border line-through",
  confirmed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  clarification: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30",
  classified: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30",
  duplicate: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30",
};

function ProposalStatusBadge({ status }: { status: string }) {
  const style = PROPOSAL_STATUS_STYLE[status] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", style)}
      data-testid={`proposal-status-${status}`}
    >
      {PROPOSAL_STATUS_LABEL[status] ?? status}
    </span>
  );
}

function ConversationStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    closed: "bg-muted text-muted-foreground",
    archived: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "text-[10px] px-1.5 py-0.5 rounded font-medium",
        map[status] ?? "bg-muted text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

function ProposalCard({ proposal, onChanged }: { proposal: ProposalRow; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const updateFn = useServerFn(updateCoachProposalFn);
  const discardFn = useServerFn(discardCoachProposalFn);
  const confirmFn = useServerFn(confirmCoachProposalFn);

  const [title, setTitle] = useState(proposal.title);
  const [instruction, setInstruction] = useState(proposal.instruction);
  const [priority, setPriority] = useState(proposal.priority);
  const [criticalConfirmed, setCriticalConfirmed] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const updateM = useMutation({
    mutationFn: () =>
      updateFn({
        data: {
          proposal_id: proposal.id,
          title: title !== proposal.title ? title : undefined,
          instruction: instruction !== proposal.instruction ? instruction : undefined,
          priority: priority !== proposal.priority ? priority : undefined,
        },
      }),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });

  const discardM = useMutation({
    mutationFn: () => discardFn({ data: { proposal_id: proposal.id } }),
    onSuccess: onChanged,
  });

  const confirmM = useMutation({
    mutationFn: () =>
      confirmFn({
        data: {
          proposal_id: proposal.id,
          overrides: {},
          critical_confirmed: criticalConfirmed,
        },
      }),
    onSuccess: onChanged,
  });

  const warnings = Array.isArray(proposal.warnings) ? (proposal.warnings as string[]) : [];
  const normalized = proposal.normalized_output as
    | {
        condition?: string;
        examples?: string[];
        duplicate_warning?: { rule_id?: string; title?: string; reason?: string } | null;
      }
    | null
    | undefined;

  const dupWarn = normalized?.duplicate_warning ?? null;
  const isCritical = proposal.risk_level === "critical";
  const isTerminal =
    proposal.status === "confirmed" ||
    proposal.status === "discarded" ||
    proposal.status === "failed";

  return (
    <div
      className="rounded-md border border-border bg-card p-3 space-y-2 text-xs"
      data-testid={`proposal-${proposal.id}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold truncate">{proposal.title}</h4>
            <ProposalStatusBadge status={proposal.status} />
            {isCritical && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-destructive/15 text-destructive border border-destructive/30">
                Crítica
              </span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground mt-1 flex gap-2 flex-wrap">
            <span>
              {COACH_CATEGORY_LABEL[proposal.category as CoachRuleCategory] ?? proposal.category}
            </span>
            <span>·</span>
            <span>
              {COACH_TYPE_LABEL[proposal.rule_type as CoachRuleType] ?? proposal.rule_type}
            </span>
            <span>·</span>
            <span>Escopo {proposal.scope_kind}</span>
            <span>·</span>
            <span>P{proposal.priority}</span>
            <span>·</span>
            <span>conf {(proposal.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      </div>

      {editing ? (
        <div className="space-y-2">
          <label className="block">
            <span className="text-muted-foreground">Título</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full h-8 rounded border border-border bg-background px-2 text-xs"
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground">Instrução</span>
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={4}
              className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
            />
          </label>
          <label className="block">
            <span className="text-muted-foreground">Prioridade (0-100)</span>
            <input
              type="number"
              min={0}
              max={100}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) || 0)}
              className="w-24 h-8 rounded border border-border bg-background px-2 text-xs"
            />
          </label>
        </div>
      ) : (
        <>
          <p className="whitespace-pre-wrap text-foreground">{proposal.instruction}</p>
          {normalized?.condition && (
            <div className="rounded bg-muted/50 border border-border p-2">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                Condição
              </div>
              <div className="mt-0.5 whitespace-pre-wrap">{normalized.condition}</div>
            </div>
          )}
          {normalized?.examples && normalized.examples.length > 0 && (
            <div className="rounded bg-muted/50 border border-border p-2">
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                Exemplos
              </div>
              <ul className="mt-0.5 list-disc pl-4 space-y-0.5">
                {normalized.examples.map((ex, i) => (
                  <li key={i} className="whitespace-pre-wrap">
                    {ex}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {warnings.length > 0 && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2">
          <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
            <AlertTriangle className="h-3 w-3" /> Warnings
          </div>
          <ul className="mt-1 list-disc pl-4">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {dupWarn && (
        <div
          className="rounded border border-amber-500/40 bg-amber-500/10 p-2"
          data-testid="duplicate-warning"
        >
          <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold">
            <Copy className="h-3 w-3" /> Possível duplicata
          </div>
          <div className="mt-1">
            <div>
              <span className="text-muted-foreground">Regra existente:</span>{" "}
              <span className="font-medium">{dupWarn.title ?? dupWarn.rule_id ?? "—"}</span>
            </div>
            {dupWarn.reason && <div className="text-muted-foreground mt-0.5">{dupWarn.reason}</div>}
          </div>
        </div>
      )}

      <div className="text-[10px] text-muted-foreground flex items-center gap-1">
        <Clock className="h-3 w-3" /> {formatDateTime(proposal.created_at)}
      </div>

      {!isTerminal && (
        <div className="flex flex-wrap gap-2 pt-1">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => updateM.mutate()}
                disabled={updateM.isPending}
                className="inline-flex items-center gap-1 h-7 px-2 rounded bg-primary text-primary-foreground text-xs disabled:opacity-60"
              >
                {updateM.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3 w-3" />
                )}
                Salvar edição
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setTitle(proposal.title);
                  setInstruction(proposal.instruction);
                  setPriority(proposal.priority);
                }}
                className="inline-flex items-center gap-1 h-7 px-2 rounded border border-border text-xs hover:bg-accent"
              >
                Cancelar
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 h-7 px-2 rounded border border-border text-xs hover:bg-accent"
                data-testid="edit-proposal"
              >
                <Pencil className="h-3 w-3" /> Editar
              </button>

              {/* Confirm — sempre passa por AlertDialog. Dupla confirmação
                  para risco crítico (checkbox dentro do dialog). */}
              <button
                type="button"
                onClick={() => {
                  setCriticalConfirmed(false);
                  setConfirmOpen(true);
                }}
                disabled={confirmM.isPending}
                className="inline-flex items-center gap-1 h-7 px-2 rounded bg-emerald-600 text-white text-xs disabled:opacity-60"
                data-testid="confirm-proposal"
              >
                {confirmM.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3 w-3" />
                )}
                Confirmar
              </button>

              {/* Discard — dialog dedicado, ação destrutiva. */}
              <button
                type="button"
                onClick={() => setDiscardOpen(true)}
                disabled={discardM.isPending}
                className="inline-flex items-center gap-1 h-7 px-2 rounded border border-destructive/40 text-destructive text-xs hover:bg-destructive/10 disabled:opacity-60"
                data-testid="discard-proposal"
              >
                {discardM.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Descartar
              </button>
            </>
          )}
        </div>
      )}

      {/* AlertDialog: Confirmar proposal */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isCritical ? "Confirmar regra CRÍTICA?" : "Confirmar regra?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block font-medium text-foreground mb-1">{proposal.title}</span>
              <span className="block text-xs">
                Categoria{" "}
                <b>
                  {COACH_CATEGORY_LABEL[proposal.category as CoachRuleCategory] ??
                    proposal.category}
                </b>{" "}
                · Tipo{" "}
                <b>{COACH_TYPE_LABEL[proposal.rule_type as CoachRuleType] ?? proposal.rule_type}</b>{" "}
                · Escopo <b>{proposal.scope_kind}</b> · Prioridade <b>P{proposal.priority}</b>
              </span>
              {isCritical && (
                <span className="mt-3 block rounded border border-destructive/40 bg-destructive/10 p-2 text-destructive">
                  Esta regra é <b>crítica</b>. Marque o checkbox abaixo para autorizar
                  explicitamente a confirmação.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {isCritical && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={criticalConfirmed}
                onChange={(e) => setCriticalConfirmed(e.target.checked)}
                data-testid="critical-checkbox"
              />
              Confirmo estar ciente do risco crítico desta regra.
            </label>
          )}
          {confirmM.error && (
            <ErrorBanner
              title="Falha ao confirmar"
              error={getSafeInterpreterError(confirmM.error)}
              testId="confirm-error"
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmM.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmM.isPending || (isCritical && !criticalConfirmed)}
              data-testid="confirm-dialog-action"
              onClick={(e) => {
                e.preventDefault();
                confirmM.mutate(undefined, {
                  onSuccess: () => setConfirmOpen(false),
                });
              }}
            >
              {confirmM.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Confirmar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* AlertDialog: Descartar proposal */}
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent data-testid="discard-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar esta proposal?</AlertDialogTitle>
            <AlertDialogDescription>
              A proposal <b>{proposal.title}</b> será marcada como descartada. Esta ação não pode
              ser desfeita a partir da UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {discardM.error && (
            <ErrorBanner
              title="Falha ao descartar"
              error={getSafeInterpreterError(discardM.error)}
              testId="discard-error"
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={discardM.isPending}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={discardM.isPending}
              data-testid="discard-dialog-action"
              onClick={(e) => {
                e.preventDefault();
                discardM.mutate(undefined, {
                  onSuccess: () => setDiscardOpen(false),
                });
              }}
            >
              {discardM.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {updateM.error && (
        <ErrorBanner
          title="Falha ao salvar edição"
          error={getSafeInterpreterError(updateM.error)}
          testId="update-error"
        />
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// Exports p/ testes — agrupados em __test__ para não gerar warnings do
// react-refresh (mistura de exports de componente e não-componente).
export const __test__ = {
  extractDisabledMessage,
  formatDateTime,
  PROPOSAL_STATUS_LABEL,
  KIND_META,
  // Componentes internos expostos exclusivamente para a bateria de testes
  // de interação da Fase 3.1a. NÃO consumir fora de testes.
  InterpreterAdminPage: AdminPageBody,
  InterpreterShell,
  ConversationsPanel,
  NewConversationButton,
  ErrorBanner,
  MessageComposer,
  ChatTimeline,
  ProposalCard,
  FeatureDisabledScreen,
};

