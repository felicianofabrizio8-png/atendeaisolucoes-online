import { useId, type CSSProperties, type ReactNode } from "react";
import { LayoutGroup, motion, useReducedMotion } from "framer-motion";
import { ArrowDownUp, Flame, Search, X } from "lucide-react";
import { OwnerBadge } from "@/components/team/ConversationOwner";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/data/mock";
import { ContactAvatar } from "./ContactAvatar";
import { CustomerTierBadge } from "./CustomerTierBadge";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";
import type { FollowupCycleView } from "@/lib/atendimento/followup-view";
import type { Attention } from "@/lib/atendimento/attention";
import { sharedContactsPreview } from "@/lib/whatsapp/shared-contacts";
// CSS da tela importado aqui (e não no arquivo da rota): assim ele vai junto
// do código da tela, e não no pacote inicial de todas as páginas.
import "./atendimento.css";

export type RailSort = "recentes" | "prioridade";

const SORTS: { id: RailSort; label: string; hint: string }[] = [
  { id: "recentes", label: "Recentes", hint: "Última mensagem primeiro" },
  {
    id: "prioridade",
    label: "Prioridade",
    hint: "Quem espera há mais tempo, janela fechando, follow-up vencido e leads quentes primeiro",
  },
];

export function ConversationRail({
  contacts,
  selectedId,
  onSelect,
  query,
  onQueryChange,
  activeFilterLabel,
  onClearFilter,
  statusChip,
  followupByConversation,
  attention,
  sort = "recentes",
  onSortChange,
  metrics,
}: {
  contacts: AtendimentoContact[];
  selectedId: string | null;
  onSelect: (conversationId: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
  activeFilterLabel: string | null;
  onClearFilter: () => void;
  /** Selo sobre a origem dos dados da fila (reais ou simulados). */
  statusChip?: React.ReactNode;
  followupByConversation?: ReadonlyMap<string, FollowupCycleView>;
  /** Sinais de espera/janela/quente por conversa (ver lib/atendimento/attention). */
  attention?: ReadonlyMap<string, Attention>;
  sort?: RailSort;
  onSortChange?: (sort: RailSort) => void;
  /** Métricas da fila (cartão giratório / pílulas), logo abaixo do título. */
  metrics?: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const sortGroup = useId();

  return (
    <div className="at-rail flex h-full min-h-0 flex-col gap-3">
      <div className="at-rail-heading">
        <h1>Conversas</h1>
        <p className="at-count" aria-label={`${contacts.length} conversas na lista`}>
          {contacts.length}
        </p>
      </div>

      {metrics}

      <div className="at-search relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Buscar cliente, cidade ou produto…"
          className="h-10 w-full rounded-full bg-secondary/60 pl-10 pr-9 text-sm outline-none ring-0 transition-colors placeholder:text-muted-foreground focus:bg-secondary"
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            aria-label="Limpar busca"
            className="at-search-clear absolute right-1.5 top-1/2 -translate-y-1/2"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="at-rail-tools">
        {onSortChange && (
          <LayoutGroup id={sortGroup}>
            <div className="at-sort" role="radiogroup" aria-label="Ordenar conversas">
              <ArrowDownUp className="at-sort-icon" aria-hidden="true" />
              {SORTS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={sort === option.id}
                  title={option.hint}
                  onClick={() => onSortChange(option.id)}
                >
                  {sort === option.id && (
                    <motion.span
                      layoutId="at-sort-pill"
                      className="at-sort-pill"
                      transition={
                        reduceMotion
                          ? { duration: 0 }
                          : { type: "spring", stiffness: 420, damping: 34 }
                      }
                    />
                  )}
                  <span>{option.label}</span>
                </button>
              ))}
            </div>
          </LayoutGroup>
        )}
        {(activeFilterLabel || statusChip) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {activeFilterLabel && (
              <button type="button" onClick={onClearFilter} className="at-filter-chip">
                {activeFilterLabel}
                <X className="h-3 w-3" />
              </button>
            )}
            {statusChip}
          </div>
        )}
      </div>

      <div className="at-rail-list -mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
        {contacts.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            Nenhuma conversa com esse filtro.
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {contacts.map(({ lead, conversation, messages, history, hue }) => {
              const last = messages[messages.length - 1];
              const selected = conversation.id === selectedId;
              const openWindow =
                Date.now() - new Date(conversation.lastMessageAt).getTime() < 24 * 3_600_000;
              const followup = followupByConversation?.get(conversation.id);
              const info = attention?.get(conversation.id);
              // O FUP já tem selo próprio e "fora da janela" valeria para quase
              // toda conversa antiga: aqui só espera, janela fechando e quente.
              const signals = (info?.signals ?? []).filter(
                (s) => s.key !== "followup" && s.tone !== "info",
              );
              const lead1 = signals[0]?.tone;

              return (
                <li key={conversation.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(conversation.id)}
                    aria-current={selected}
                    data-tone={lead1}
                    className={cn(
                      "at-contact group flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors",
                      selected ? "bg-secondary" : "hover:bg-secondary/50",
                    )}
                    style={{ "--hue": hue } as CSSProperties}
                  >
                    <ContactAvatar
                      name={lead.name}
                      hue={hue}
                      online={openWindow}
                      channel={lead.channel}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-semibold">{lead.name}</span>
                        <CustomerTierBadge
                          history={history}
                          size="sm"
                          className="shrink-0"
                          hideNew
                        />
                        {followup?.bucket === "overdue" ? (
                          <span
                            className="at-fup shrink-0 rounded-full border border-destructive/30 px-1.5 py-0.5 text-[9px] font-bold text-destructive"
                            aria-label={
                              "Follow-up vencido, tentativa " +
                              followup.attempts +
                              " de " +
                              followup.maxAttempts
                            }
                            title={
                              "Follow-up vencido · tentativa " +
                              followup.attempts +
                              " de " +
                              followup.maxAttempts
                            }
                          >
                            FUP
                          </span>
                        ) : followup?.bucket === "upcoming" ? (
                          <span
                            className="at-fup shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9px] font-bold text-muted-foreground"
                            aria-label="Próximo follow-up"
                            title="Próximo follow-up programado"
                          >
                            FUP
                          </span>
                        ) : null}
                        <span className="at-contact-time ml-auto shrink-0 text-[10px] font-medium text-muted-foreground">
                          {timeAgo(conversation.lastMessageAt)}
                        </span>
                      </span>
                      {/* "Disponível" em toda linha era ruído: só quem tem dono mostra. */}
                      {lead.assignedTo && <OwnerBadge userId={lead.assignedTo} />}
                      <span className="mt-0.5 flex items-center gap-1.5">
                        <span className="truncate text-xs text-muted-foreground">
                          {last?.role === "agent" ? "Você: " : ""}
                          {(last && (sharedContactsPreview(last) ?? last.text)) ?? "—"}
                        </span>
                        {conversation.unread ? (
                          <span className="at-unread ml-auto shrink-0 rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground tabular-nums">
                            {conversation.unread}
                          </span>
                        ) : null}
                      </span>
                      {signals.length > 0 && (
                        <span className="at-signals">
                          {signals.slice(0, 2).map((signal) => (
                            <span key={signal.key} data-tone={signal.tone}>
                              {signal.key === "hot" ? (
                                <Flame aria-hidden="true" />
                              ) : (
                                <i aria-hidden="true" />
                              )}
                              {signal.label}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
