import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, CornerDownLeft, Loader2, Send, Sparkles, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/data/mock";
import { classifyCustomer, describeHistory } from "@/lib/customer-loyalty";
import {
  answerQuestion,
  quickPrompts,
  suggestNextMessage,
  type CopilotContext,
} from "@/lib/atendimento/copilot";
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
  followUps?: string[];
}

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

  const suggestion = useMemo(() => suggestNextMessage(ctx), [ctx]);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [copied, setCopied] = useState(false);
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

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || thinking) return;
    setInput("");
    setChat((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: q }]);
    setThinking(true);
    // Pequeno atraso proposital: resposta instantânea parece bug, e o
    // "pensando…" comunica que a IA leu a conversa antes de responder.
    window.setTimeout(() => {
      const answer = answerQuestion(q, ctx);
      setChat((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: "ia", text: answer.text, followUps: answer.followUps },
      ]);
      setThinking(false);
    }, 420);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <PanelHeading title="Sugestões" subtitle="Dados gerados por IA" />

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-[13px] font-bold">Próxima Mensagem</span>
            <span className="rounded-full bg-secondary/70 px-2 py-0.5 text-[10px] font-bold text-muted-foreground">
              {suggestion.play} · {suggestion.confidence}%
            </span>
          </div>

          <div className="rounded-2xl border border-border p-3.5 text-sm leading-relaxed">
            {suggestion.text}
          </div>

          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => onUseSuggestion(suggestion.text)}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:opacity-90"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Usar no chat
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(suggestion.text).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1200);
                });
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-border px-3 py-2 text-xs font-bold hover:bg-secondary"
            >
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? "Copiado" : "Copiar"}
            </button>
          </div>

          <p className="mt-2.5 rounded-2xl border border-border bg-secondary p-3.5 text-xs leading-relaxed text-muted-foreground">
            {suggestion.rationale}
          </p>
        </section>

        {chat.length === 0 && !thinking && (
          <section>
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Perguntas rápidas
            </p>
            <div className="flex flex-wrap gap-1.5">
              {quickPrompts().map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => ask(p)}
                  className="rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-transparent hover:bg-secondary hover:text-foreground"
                >
                  {p}
                </button>
              ))}
            </div>
          </section>
        )}

        {chat.map((entry) => (
          <div key={entry.id} className="space-y-2">
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
              <p className="whitespace-pre-wrap">
                <RichText text={entry.text} />
              </p>
            </div>
            {entry.followUps && entry.followUps.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {entry.followUps.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => ask(f)}
                    className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-secondary hover:text-foreground"
                  >
                    <CornerDownLeft className="h-3 w-3" />
                    {f}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {thinking && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            lendo a conversa…
          </p>
        )}

        <div ref={endRef} />
      </div>

      {/* Campo com borda em gradiente: é o convite visual para falar com a IA. */}
      <div
        className="rounded-full p-[2px]"
        style={{
          background:
            "linear-gradient(90deg, oklch(0.55 0.24 285), oklch(0.62 0.20 320), oklch(0.75 0.16 200))",
        }}
      >
        {/* <form> em vez de onKeyDown: Enter enviar é comportamento nativo do
            navegador aqui, inclusive em teclado virtual e leitor de tela. */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
          className="flex items-center gap-2 rounded-full bg-background px-4 py-1"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            // O <form> já cobre o Enter na maioria dos navegadores; o handler
            // explícito garante o mesmo comportamento onde a submissão
            // implícita não dispara (webviews e alguns teclados virtuais).
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                ask(input);
              }
            }}
            placeholder="Pergunte para IA"
            aria-label="Pergunte para a IA sobre esta conversa"
            className="h-10 flex-1 bg-transparent text-sm font-bold outline-none placeholder:font-bold"
            style={{ color: "inherit" }}
          />
          <button
            type="submit"
            disabled={!input.trim() || thinking}
            aria-label="Enviar pergunta"
            className="shrink-0 rounded-full p-1.5 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
