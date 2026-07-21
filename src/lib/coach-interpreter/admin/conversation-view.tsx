// Painel principal quando uma conversa está selecionada:
// cabeçalho + timeline + composer + coluna de proposals com filtros.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { getCoachConversationFn } from "@/lib/coach-interpreter/coach-interpreter.functions";
import { getSafeInterpreterError } from "@/lib/coach-interpreter/errors";
import { DEFAULT_FILTERS } from "./constants";
import type { ConversationRow, MessageRow, ProposalFilters, ProposalRow } from "./types";
import { ChatTimeline } from "./chat-timeline";
import { MessageComposer } from "./message-composer";
import { ProposalFilterBar } from "./proposal-filters";
import { ProposalCard } from "./proposal-card";
import { ConversationStatusBadge } from "./status-badges";
import { ErrorBanner } from "./error-banner";
import { FeatureDisabledScreen } from "./feature-disabled-screen";
import { formatDateTime } from "./helpers";

export function ConversationView({ conversationId }: { conversationId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getCoachConversationFn);
  const q = useQuery({
    queryKey: ["coach-interpreter", "conversation", conversationId],
    queryFn: () => getFn({ data: { conversation_id: conversationId } }),
    retry: false,
  });

  const [filters, setFilters] = useState<ProposalFilters>(DEFAULT_FILTERS);
  // Contador incrementado em eventos disparados pelo próprio usuário
  // (envio no composer). Usado pela ChatTimeline para forçar scroll ao fim.
  const [scrollBumpToken, setScrollBumpToken] = useState(0);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["coach-interpreter", "conversation", conversationId] });
    qc.invalidateQueries({ queryKey: ["coach-interpreter", "conversations"] });
  };
  const invalidateAndBump = () => {
    invalidate();
    setScrollBumpToken((t) => t + 1);
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

        <ChatTimeline
          messages={messages}
          conversationId={conv.id}
          onChanged={invalidate}
          scrollBumpToken={scrollBumpToken}
        />
        <MessageComposer conversationId={conv.id} onSent={invalidateAndBump} />
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
