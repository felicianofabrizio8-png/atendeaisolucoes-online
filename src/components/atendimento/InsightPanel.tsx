import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ConversationAiChat } from "./ConversationAiChat";
import { useMemo, useState, useSyncExternalStore } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { listProducts, subscribeProducts } from "@/data/products";
import { classifyCustomer, describeHistory } from "@/lib/customer-loyalty";
import { CoachPanel } from "@/components/coach/CoachPanel";
import { AITimeline } from "@/components/AITimeline";
import { useSalesAgentPanelMode } from "@/hooks/useSalesAgentPanelMode";
import { listQuotes, subscribeQuotes } from "@/data/quotes";
import { QuoteCard } from "@/components/orcamentos/QuoteCard";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useIsMobile } from "@/hooks/use-mobile";
import { CustomerTierBadge } from "./CustomerTierBadge";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";
import { followupReasonLabel, type FollowupCycleView } from "@/lib/atendimento/followup-view";
import { extractConversationFacts, type Fact } from "@/lib/atendimento/conversation-facts";

type Tab = "info" | "ia";

/** Painel da conversa: copiloto consultivo e uma única instância dos controles da IA. */
export function InsightPanel({
  contact,
  onUseSuggestion,
  simulated = false,
  composerHasDraft = false,
  followup,
  initialTab = "info",
}: {
  contact: AtendimentoContact;
  onUseSuggestion: (text: string) => void;
  simulated?: boolean;
  composerHasDraft?: boolean;
  followup?: FollowupCycleView;
  /** A estrela do topo da conversa (celular) abre direto na Lume. */
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const isMobile = useIsMobile();
  const reducedMotion = useReducedMotion();

  return (
    <div className="at-insight flex h-full min-h-0 flex-col gap-5 pl-1">
      <SegmentedToggle tab={tab} onChange={setTab} />
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={tab}
          className="at-tab-content"
          initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reducedMotion ? 0 : -5 }}
          transition={{ duration: reducedMotion ? 0 : 0.14, ease: "easeOut" }}
        >
          {tab === "info" ? (
            // Coluna: Info em cima, automações embaixo (o contêiner da aba é flex
            // em linha, e lado a lado as duas espremiam a tela do celular).
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
              <InfoTab contact={contact} followup={followup} />
              {/* Celular: as automações moram no Info, para a Lume ficar só com
                  a conversa com a IA. Continuam montadas e acessíveis. */}
              {isMobile && !simulated && (
                <div className="mt-5">
                  <CoachAutomations
                    contact={contact}
                    onUseSuggestion={onUseSuggestion}
                    composerHasDraft={composerHasDraft}
                  />
                </div>
              )}
            </div>
          ) : simulated ? (
            <ConversationAiChat contact={contact} onUseSuggestion={onUseSuggestion} simulated />
          ) : (
            <CoachTab
              contact={contact}
              onUseSuggestion={onUseSuggestion}
              composerHasDraft={composerHasDraft}
              withAutomations={!isMobile}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function CoachTab({
  contact,
  onUseSuggestion,
  composerHasDraft,
  withAutomations = true,
}: {
  contact: AtendimentoContact;
  onUseSuggestion: (text: string) => void;
  composerHasDraft: boolean;
  withAutomations?: boolean;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <ConversationAiChat contact={contact} onUseSuggestion={onUseSuggestion} />
      {withAutomations && (
        <CoachAutomations
          contact={contact}
          onUseSuggestion={onUseSuggestion}
          composerHasDraft={composerHasDraft}
        />
      )}
    </div>
  );
}

/** Aprovação do modo assistido, resposta automática e devolução para a IA. */
function CoachAutomations({
  contact,
  onUseSuggestion,
  composerHasDraft,
}: {
  contact: AtendimentoContact;
  onUseSuggestion: (text: string) => void;
  composerHasDraft: boolean;
}) {
  const coachMessages = useMemo(
    () =>
      contact.messages.map((m) => ({
        id: m.id,
        role: m.role,
        text: m.text,
        at: m.at,
        sourceSubtype: m.sourceSubtype,
      })),
    [contact.messages],
  );

  // Empresa na Vendedora 2.0: o histórico técnico (códigos de eventos) é diagnóstico,
  // não informação para o atendente — fica recolhido e só para admin.
  const { mode } = useSalesAgentPanelMode();
  const { isAdmin } = useIsAdmin();

  return (
    <>
      {/* Aberto por padrão: aqui moram a aprovação do modo assistido, a resposta
          automática e a devolução para a IA — fechado, a Vendedora fica parada. */}
      <details open className="shrink-0 rounded-2xl border border-border">
        <summary className="cursor-pointer px-3 py-2.5 text-xs font-medium text-muted-foreground hover:text-foreground">
          Automações e aprovações
        </summary>
        <div className="max-h-[35vh] overflow-y-auto">
          <CoachPanel
            conversationId={contact.conversation.id}
            messages={coachMessages}
            onInsertSuggestion={onUseSuggestion}
            composerHasDraft={composerHasDraft}
            aiStatus={contact.conversation.aiStatus ?? null}
            humanTakeoverAt={contact.conversation.humanTakeoverAt ?? null}
          />
          {mode === "coach" && <AITimeline conversationId={contact.conversation.id} />}
          {mode === "vendedora" && isAdmin && (
            <details data-testid="ai-technical-history" className="border-t border-border">
              <summary className="cursor-pointer px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
                Histórico técnico
              </summary>
              <AITimeline conversationId={contact.conversation.id} />
            </details>
          )}
        </div>
      </details>
    </>
  );
}

function SegmentedToggle({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Painel lateral"
      className="at-tabs relative flex self-center rounded-full bg-secondary p-1 text-sm font-semibold"
    >
      {/* Pastilha deslizante: dá continuidade visual entre as duas abas. */}
      <span
        aria-hidden
        className="absolute inset-y-1 w-[calc(50%-0.25rem)] rounded-full bg-background shadow-sm transition-transform duration-300 ease-out"
        style={{ transform: tab === "ia" ? "translateX(100%)" : "translateX(0)" }}
      />
      {(["info", "ia"] as const).map((t) => (
        <button
          key={t}
          role="tab"
          aria-selected={tab === t}
          type="button"
          onClick={() => onChange(t)}
          className={cn(
            "relative z-10 w-[86px] rounded-full py-1.5 transition-colors",
            tab === t ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t === "info" ? "Info" : "Lume"}
        </button>
      ))}
    </div>
  );
}

function PanelHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h3 className="at-panel-title">{title}</h3>
      <p className="mt-1 text-[12.5px] text-muted-foreground">{subtitle}</p>
    </div>
  );
}

const SOURCE_TAG: Record<Fact["source"], string | null> = {
  registro: null,
  conversa: "da conversa",
  sugerida: "sugerida",
};

function Field({
  label,
  value: rawValue,
  fact,
  badge,
  multiline,
  emptyText = "não informado",
}: {
  label: string;
  value?: string | null;
  /** Fato extraído: valor + origem + trecho de evidência. */
  fact?: Fact | null;
  badge?: React.ReactNode;
  multiline?: boolean;
  emptyText?: string;
}) {
  const [copied, setCopied] = useState(false);
  const value = rawValue ?? fact?.value ?? null;
  const empty = !value;
  const tag = fact ? SOURCE_TAG[fact.source] : null;
  const title = fact?.evidence
    ? `Da conversa: “${fact.evidence}” — clique para copiar`
    : value
      ? "Clique para copiar"
      : undefined;

  const copy = () => {
    if (!value) return;
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div className="at-fact" data-field={label}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {badge ??
          (tag && value ? (
            <span className="text-[10.5px] font-medium text-muted-foreground/80">{tag}</span>
          ) : null)}
      </div>
      <button
        type="button"
        onClick={copy}
        title={title}
        className={cn(
          // Superfície cheia + borda: os campos precisam se ler como caixas
          // com contorno próprio, não como manchas um pouco mais claras que
          // o fundo preto.
          "at-info-field group relative w-full rounded-2xl border border-border bg-secondary px-3.5 text-left text-sm transition-colors hover:bg-accent",
          multiline
            ? "min-h-[110px] py-3 leading-relaxed"
            : "flex min-h-11 items-center py-2.5 pr-8 leading-snug",
          empty && "text-muted-foreground",
        )}
      >
        <span className={cn("block break-words", multiline && "whitespace-pre-wrap")}>
          {value ?? emptyText}
        </span>
        {value && (
          <span className="absolute right-3 top-3 opacity-0 transition-opacity group-hover:opacity-100">
            {copied ? (
              <Check className="h-3.5 w-3.5" style={{ color: "var(--status-won)" }} />
            ) : (
              <Copy className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </span>
        )}
      </button>
    </div>
  );
}

function InfoTab({
  contact,
  followup,
}: {
  contact: AtendimentoContact;
  followup?: FollowupCycleView;
}) {
  const { lead, conversation, history, summary, messages } = contact;
  const tier = classifyCustomer(history);
  const catalog = useSyncExternalStore(subscribeProducts, listProducts, listProducts);
  // Sem inventar: cadastro primeiro, depois o que a própria conversa diz.
  const facts = useMemo(
    () =>
      extractConversationFacts({
        lead,
        conversation,
        messages,
        catalog,
        followupNextAt: followup?.nextFollowupAt ?? null,
      }),
    [lead, conversation, messages, catalog, followup?.nextFollowupAt],
  );
  // Campos vazios não ocupam caixas de "não informado": viram uma lista curta.
  const pairFacts = (
    [
      ["Interesse", facts.interest],
      ["Modelo/medida", facts.model],
      ["Valor apresentado", facts.presentedValue],
      ["Pagamento", facts.payment],
    ] as const
  ).filter(([, fact]) => !!fact);
  const missing = (
    [
      ["Cidade/UF", facts.location],
      ["Interesse", facts.interest],
      ["Modelo/medida", facts.model],
      ["Valor", facts.presentedValue],
      ["Pagamento", facts.payment],
      ["Prazo", facts.timing],
      ["Próxima ação", facts.nextAction],
    ] as const
  )
    .filter(([, fact]) => !fact)
    .map(([label]) => label);

  return (
    <div className="at-info-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <PanelHeading title="Informações" subtitle="Do cadastro e da conversa" />

      <Field label="Nome" value={lead.name} badge={<CustomerTierBadge history={history} />} />
      <Field label="Telefone" value={lead.phone ?? lead.handle} />
      {facts.location && <Field label="Cidade/UF" fact={facts.location} />}

      {pairFacts.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {pairFacts.map(([label, fact]) => (
            <Field key={label} label={label} fact={fact} />
          ))}
        </div>
      )}

      {facts.timing && <Field label="Prazo/intenção" fact={facts.timing} />}
      <Field
        label="Resumo"
        multiline
        value={summary ?? facts.summary}
        emptyText="Ainda não há dados comerciais na conversa."
      />
      {facts.nextAction && <Field label="Próxima ação" fact={facts.nextAction} />}
      {missing.length > 0 && (
        <div className="at-missing">
          <p>Ainda sem informação</p>
          <div>
            {missing.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <small>Aparece aqui quando o cliente contar na conversa ou no cadastro.</small>
        </div>
      )}
      {followup && (
        <div className="rounded-2xl border border-border bg-secondary/30 p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">Follow-up</p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10.5px] font-semibold",
                followup.bucket === "overdue"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-secondary text-muted-foreground",
              )}
            >
              {followup.bucket === "overdue" ? "Vencido" : "Próximo"}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Motivo</dt>
              <dd className="mt-0.5 font-medium">{followupReasonLabel(followup.reason)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Tentativa</dt>
              <dd className="mt-0.5 font-medium">
                {followup.attempts} / {followup.maxAttempts}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-muted-foreground">Próximo contato</dt>
              <dd className="mt-0.5 font-medium">
                {followup.nextFollowupAt
                  ? new Date(followup.nextFollowupAt).toLocaleString("pt-BR")
                  : "Sem data programada"}
              </dd>
            </div>
          </dl>
        </div>
      )}

      <ConversationQuotes leadId={lead.id} />

      <div className="mb-2 rounded-2xl border border-border p-3.5">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Relacionamento</p>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold" style={{ color: tier.color }}>
            {tier.emoji} {tier.label}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{tier.reason}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">{describeHistory(history)}</p>
      </div>
    </div>
  );
}

const MAX_CONVERSATION_QUOTES = 5;

/**
 * Orçamentos deste cliente, dentro da conversa: o pendente fica visível com o botão de
 * enviar, e os enviados podem ser reenviados ou copiados — sem ir à tela Orçamentos.
 * Usa a mesma lista (já filtrada pela empresa) e o mesmo cartão daquela tela.
 */
function ConversationQuotes({ leadId }: { leadId: string }) {
  const quotes = useSyncExternalStore(subscribeQuotes, listQuotes, listQuotes);
  const mine = useMemo(
    () =>
      quotes
        .filter((quote) => quote.leadId === leadId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [quotes, leadId],
  );

  return (
    <div data-testid="conversation-quotes" className="space-y-2">
      <p className="text-xs font-medium text-muted-foreground">
        Orçamentos{mine.length > 0 ? ` (${mine.length})` : ""}
      </p>
      {mine.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          Nenhum orçamento para este cliente. Crie pelo menu ⋯ da conversa.
        </p>
      ) : (
        <>
          {mine.slice(0, MAX_CONVERSATION_QUOTES).map((quote) => (
            <QuoteCard key={quote.id} quote={quote} inConversation />
          ))}
          {mine.length > MAX_CONVERSATION_QUOTES && (
            <p className="text-[11px] text-muted-foreground">
              Mostrando os {MAX_CONVERSATION_QUOTES} mais recentes de {mine.length}. Os demais estão
              na tela Orçamentos.
            </p>
          )}
        </>
      )}
    </div>
  );
}
