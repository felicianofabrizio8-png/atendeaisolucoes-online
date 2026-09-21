import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Loader2, Paperclip, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/data/mock";
import { classifyCustomer, describeHistory } from "@/lib/customer-loyalty";
import { answerQuestion, type CopilotContext } from "@/lib/atendimento/copilot";
import { AiComposer, type Attachment } from "./AiComposer";
import { SiriOrb } from "./SiriOrb";
import { CustomerTierBadge } from "./CustomerTierBadge";
import { RichText } from "./RichText";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";

type Tab = "info" | "ia";

export function InsightPanel({
  contact,
  onUseSuggestion,
}: {
  contact: AtendimentoContact;
  onUseSuggestion: (text: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("info");

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 pl-1">
      <SegmentedToggle tab={tab} onChange={setTab} />
      {tab === "info" ? (
        <InfoTab contact={contact} />
      ) : (
        <AiTab contact={contact} onUseSuggestion={onUseSuggestion} />
      )}
    </div>
  );
}

function SegmentedToggle({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Painel lateral"
      className="relative flex self-center rounded-full bg-secondary p-1 text-sm font-semibold"
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
          {t === "info" ? "Info" : "IA"}
        </button>
      ))}
    </div>
  );
}

function PanelHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h3 className="text-[30px] font-extrabold leading-none tracking-tight">{title}</h3>
      <p className="mt-1.5 flex items-center gap-1 text-[13px] font-bold text-muted-foreground">
        {subtitle}
        <Sparkles className="h-3.5 w-3.5" style={{ color: "var(--primary)" }} />
      </p>
    </div>
  );
}

function Field({
  label,
  value,
  badge,
  multiline,
}: {
  label: string;
  value?: string | null;
  badge?: React.ReactNode;
  multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const empty = !value;

  const copy = () => {
    if (!value) return;
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  };

  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-[13px] font-bold">{label}</span>
        {badge}
      </div>
      <button
        type="button"
        onClick={copy}
        title={value ? "Clique para copiar" : undefined}
        className={cn(
          // Superfície cheia + borda: os campos precisam se ler como caixas
          // com contorno próprio, não como manchas um pouco mais claras que
          // o fundo preto.
          "group relative w-full rounded-2xl border border-border bg-secondary px-3.5 text-left text-sm transition-colors hover:bg-accent",
          multiline ? "min-h-[110px] py-3 leading-relaxed" : "h-11 flex items-center",
          empty && "text-muted-foreground",
        )}
      >
        <span className={cn("block", multiline && "whitespace-pre-wrap")}>
          {value ?? "não informado"}
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

function InfoTab({ contact }: { contact: AtendimentoContact }) {
  const { lead, conversation, history, summary } = contact;
  const tier = classifyCustomer(history);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <PanelHeading title="Informações" subtitle="Dados gerados por IA" />

      <Field
        label="Nome"
        value={lead.name}
        badge={<CustomerTierBadge history={history} />}
      />
      <Field label="Telefone" value={lead.phone ?? lead.handle} />
      <Field label="Cidade" value={conversation.detectedCity} />
      <Field label="Estado" value={conversation.detectedState} />
      <Field
        label="Resumo"
        multiline
        value={summary ?? conversation.detectedIntent ?? null}
      />

      <div className="rounded-2xl border border-border p-3.5">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Relacionamento
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: tier.color }}>
            {tier.emoji} {tier.label}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{tier.reason}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">{describeHistory(history)}</p>
      </div>

      <dl className="grid grid-cols-2 gap-2 pb-2">
        <MiniStat label="Interesse" value={lead.product} />
        <MiniStat
          label="Ticket"
          value={lead.estimatedValue ? formatBRL(lead.estimatedValue) : null}
        />
        <MiniStat label="Orçamento" value={conversation.detectedBudget} />
        <MiniStat label="Prazo" value={conversation.purchaseTiming} />
      </dl>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="rounded-xl border border-border bg-secondary px-3 py-2">
      <dt className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-xs font-medium leading-snug">{value ?? "—"}</dd>
    </div>
  );
}

interface ChatEntry {
  id: string;
  role: "user" | "ia";
  text: string;
  /** Nomes dos arquivos anexados à pergunta, só para exibição. */
  attachmentNames?: string[];
}

/**
 * Aba IA — superfície de conversa, não painel de leitura.
 *
 * Em repouso mostra só a orbe, a saudação e o campo: quem abre a aba quer
 * perguntar alguma coisa, e um card de sugestão sempre aberto roubava essa
 * decisão. O que a IA tem a dizer aparece quando o atendente pede.
 *
 * As sugestões prontas continuam em `@/lib/atendimento/copilot`
 * (`suggestNextMessage`, `quickPrompts`), sem superfície por enquanto.
 */
function AiTab({
  contact,
  onUseSuggestion,
}: {
  contact: AtendimentoContact;
  onUseSuggestion: (text: string) => void;
}) {
  const ctx: CopilotContext = useMemo(
    () => ({
      lead: contact.lead,
      conversation: contact.conversation,
      messages: contact.messages,
      history: contact.history,
      summary: contact.summary,
    }),
    [contact],
  );

  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Trocar de conversa zera o fio do copiloto: contexto antigo respondendo
  // sobre um cliente novo é pior do que começar do zero.
  useEffect(() => {
    setChat([]);
    setInput("");
  }, [contact.conversation.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [chat.length, thinking]);

  const ask = (question: string, attachments: Attachment[] = []) => {
    const q = question.trim();
    if ((!q && attachments.length === 0) || thinking) return;
    setInput("");
    setChat((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        role: "user",
        text: q,
        attachmentNames: attachments.map((a) => a.file.name),
      },
    ]);
    setThinking(true);
    // Pequeno atraso proposital: resposta instantânea parece bug, e o
    // "pensando…" comunica que a IA leu a conversa antes de responder.
    window.setTimeout(() => {
      const answer = answerQuestion(q, ctx);
      setChat((prev) => [...prev, { id: `a-${Date.now()}`, role: "ia", text: answer.text }]);
      setThinking(false);
    }, 420);
  };

  const idle = chat.length === 0 && !thinking;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {idle ? (
        <div className="flex min-h-0 flex-1 flex-col items-center">
          {/* Espaçadores 1 : 2,4 em vez de padding fixo — o conjunto fica no
              terço superior tanto na coluna baixa do desktop quanto na gaveta
              alta do celular. */}
          <div className="min-h-4 flex-[1]" />
          <div className="flex flex-col items-center gap-7">
            <SiriOrb size={176} />
            <p className="max-w-[13ch] text-center text-[22px] font-bold leading-tight">
              Como posso te ajudar hoje?
            </p>
          </div>
          <div className="flex-[2.4]" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {chat.map((entry) => (
            <div key={entry.id} className="space-y-1.5">
              <div
                className={cn(
                  "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                  // Minhas perguntas usam a cor de destaque do app; a resposta
                  // da IA fica na superfície neutra. Mesma lógica dos balões do
                  // chat com o cliente, para o olho não ter que reaprender.
                  entry.role === "user"
                    ? "ml-6 border border-primary/30 bg-primary/20 text-foreground"
                    : "border border-border bg-secondary",
                )}
              >
                {entry.text && (
                  <p className="whitespace-pre-wrap">
                    <RichText text={entry.text} />
                  </p>
                )}
                {entry.attachmentNames && entry.attachmentNames.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {entry.attachmentNames.map((name) => (
                      <li
                        key={name}
                        className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                      >
                        <Paperclip className="h-3 w-3 shrink-0" />
                        <span className="truncate">{name}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {entry.role === "ia" && (
                <button
                  type="button"
                  onClick={() => onUseSuggestion(entry.text)}
                  className="inline-flex items-center gap-1.5 rounded-full px-1 text-[11px] font-bold text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Wand2 className="h-3 w-3" />
                  Usar no chat
                </button>
              )}
            </div>
          ))}

          {thinking && (
            <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              lendo a conversa…
            </p>
          )}

          <div ref={endRef} />
        </div>
      )}

      <AiComposer value={input} onChange={setInput} onSubmit={ask} disabled={thinking} />
    </div>
  );
}
