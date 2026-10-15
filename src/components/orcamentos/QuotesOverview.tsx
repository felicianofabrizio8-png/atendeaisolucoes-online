import { useMemo, type CSSProperties } from "react";
import {
  ArrowUpRight,
  CircleCheck,
  FileText,
  Hourglass,
  Plus,
  Send,
  UserRound,
  Wallet,
} from "lucide-react";
import { brlCompact, num, useCountUp } from "@/components/dashboard/charts/primitives";
import { computeQuoteStatus, type Quote, type QuoteStatus } from "@/data/quotes";
import { daysUntil, formatQuoteMoney, quoteHue, quoteInitials } from "@/lib/quote-presentation";

export type QuoteFilter = "todos" | QuoteStatus;

export interface QuoteStats {
  counts: Record<QuoteFilter, number>;
  open: {
    total: number;
    count: number;
    byStatus: Record<"pendente" | "enviado" | "visualizado", number>;
  };
  approved: { total: number; count: number; rate: number };
  expiringSoon: number;
  /** Customers still waiting for their proposal (newest first). */
  toSend: Array<{ id: string; name: string }>;
  /** Open proposals expiring on each of the next seven days, today first. */
  dueByDay: Array<{ date: Date; count: number }>;
}

const OPEN = ["pendente", "enviado", "visualizado"] as const;

export function useQuoteStats(
  quotes: Quote[],
  nameOf: (quote: Quote) => string | undefined = () => undefined,
): QuoteStats {
  return useMemo(() => {
    const toSend: QuoteStats["toSend"] = [];
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const dueByDay = Array.from({ length: 7 }, (_, i) => ({
      date: new Date(today.getTime() + i * 86_400_000),
      count: 0,
    }));
    const counts: Record<QuoteFilter, number> = {
      todos: quotes.length,
      pendente: 0,
      enviado: 0,
      visualizado: 0,
      aprovado: 0,
      vencido: 0,
    };
    const byStatus = { pendente: 0, enviado: 0, visualizado: 0 };
    let openTotal = 0;
    let approvedTotal = 0;
    let expiringSoon = 0;
    for (const quote of quotes) {
      const status = computeQuoteStatus(quote);
      counts[status] += 1;
      if (status === "aprovado") approvedTotal += quote.finalValue;
      if (status === "pendente" || status === "enviado" || status === "visualizado") {
        openTotal += quote.finalValue;
        byStatus[status] += quote.finalValue;
        const days = daysUntil(quote.validUntil);
        if (days !== null && days >= 0 && days <= 3) expiringSoon += 1;
        if (days !== null && days >= 0 && days < 7) dueByDay[days].count += 1;
        if (status === "pendente") toSend.push({ id: quote.id, name: nameOf(quote) ?? "" });
      }
    }
    // Conversion over proposals the customer actually received.
    const delivered = counts.enviado + counts.visualizado + counts.aprovado + counts.vencido;
    return {
      counts,
      open: { total: openTotal, count: OPEN.reduce((n, k) => n + counts[k], 0), byStatus },
      approved: {
        total: approvedTotal,
        count: counts.aprovado,
        rate: delivered ? (counts.aprovado / delivered) * 100 : 0,
      },
      expiringSoon,
      toSend,
      dueByDay,
    };
  }, [quotes, nameOf]);
}

const LEGEND: Record<(typeof OPEN)[number], { label: string; color: string }> = {
  pendente: { label: "Para enviar", color: "#ffd29a" },
  enviado: { label: "Enviados", color: "#b9cbff" },
  visualizado: { label: "Visualizados", color: "#ffffff" },
};

export function QuotesOverview({
  stats,
  filter,
  onFilter,
  onAttention,
}: {
  stats: QuoteStats;
  filter: QuoteFilter;
  onFilter: (filter: QuoteFilter) => void;
  onAttention: () => void;
}) {
  const openTotal = useCountUp(stats.open.total);
  const approvedTotal = useCountUp(stats.approved.total);
  const toSend = useCountUp(stats.counts.pendente);
  const soon = useCountUp(stats.expiringSoon);
  const onTicks = Math.round(Math.max(0, Math.min(100, stats.approved.rate)) / 5);
  const toggle = (next: QuoteFilter) => onFilter(filter === next ? "todos" : next);
  return (
    <section className="lq-overview" aria-label="Resumo dos orçamentos">
      <div className="lq-stat lq-stat-hero">
        <span className="lq-flutes" aria-hidden="true" />
        <span className="lq-arc" aria-hidden="true" />
        <span className="lq-stat-top">
          <Wallet aria-hidden="true" />
          Em negociação
        </span>
        <strong>{formatQuoteMoney(Math.round(openTotal))}</strong>
        <div className="lq-stat-foot">
          {stats.open.count
            ? `${num(stats.open.count)} ${stats.open.count === 1 ? "proposta aberta" : "propostas abertas"}`
            : "Nenhuma proposta aberta agora"}
          {stats.open.total > 0 && (
            <>
              <div className="lq-pipeline" aria-hidden="true">
                {OPEN.map((key) =>
                  stats.open.byStatus[key] > 0 ? (
                    <i
                      key={key}
                      data-k={key}
                      style={{ flexGrow: stats.open.byStatus[key] } as CSSProperties}
                    />
                  ) : null,
                )}
              </div>
              <div className="lq-legend">
                {OPEN.filter((key) => stats.open.byStatus[key] > 0).map((key) => (
                  <span key={key} style={{ "--dot": LEGEND[key].color } as CSSProperties}>
                    {LEGEND[key].label} {brlCompact(stats.open.byStatus[key])}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      <button
        type="button"
        className="lq-stat"
        data-hue="green"
        aria-pressed={filter === "aprovado"}
        onClick={() => toggle("aprovado")}
      >
        <span className="lq-stat-top">
          <CircleCheck aria-hidden="true" />
          Aprovados
          <ArrowUpRight className="lq-stat-arrow" aria-hidden="true" />
        </span>
        <strong>{formatQuoteMoney(Math.round(approvedTotal))}</strong>
        <span className="lq-ticks" aria-hidden="true">
          {Array.from({ length: 20 }, (_, i) => (
            <i key={i} data-on={i < onTicks || undefined} />
          ))}
        </span>
        <span className="lq-stat-foot">
          {stats.approved.count
            ? `${stats.approved.rate.toFixed(0)}% das propostas enviadas viraram venda`
            : "Nenhuma proposta aprovada ainda"}
        </span>
      </button>
      <button
        type="button"
        className="lq-stat"
        data-hue="amber"
        aria-pressed={filter === "pendente"}
        onClick={() => toggle("pendente")}
      >
        <span className="lq-stat-top">
          <Send aria-hidden="true" />
          Para enviar
          <ArrowUpRight className="lq-stat-arrow" aria-hidden="true" />
        </span>
        <strong>{num(Math.round(toSend))}</strong>
        {stats.toSend.length > 0 && (
          <span className="lq-faces" aria-hidden="true">
            {stats.toSend.slice(0, 4).map((person, index) => (
              <span
                key={person.id}
                className="lq-avatar"
                style={{ "--hue": quoteHue(person.id), zIndex: 4 - index } as CSSProperties}
              >
                {quoteInitials(person.name)}
              </span>
            ))}
            {stats.toSend.length > 4 && <em>+{stats.toSend.length - 4}</em>}
          </span>
        )}
        <span className="lq-stat-foot">
          {stats.counts.pendente
            ? "Prontos para seguir pelo WhatsApp"
            : "Tudo enviado. Bom trabalho!"}
        </span>
      </button>
      <button type="button" className="lq-stat" data-hue="red" onClick={onAttention}>
        <span className="lq-stat-top">
          <Hourglass aria-hidden="true" />
          Vencendo
          <ArrowUpRight className="lq-stat-arrow" aria-hidden="true" />
        </span>
        <strong>{num(Math.round(soon))}</strong>
        <span className="lq-due" aria-hidden="true">
          {stats.dueByDay.map(({ date, count }, i) => (
            <span key={i} data-busy={count > 0 || undefined} data-today={i === 0 || undefined}>
              <i style={{ animationDelay: `${120 + i * 60}ms` }} />
              {date.toLocaleDateString("pt-BR", { weekday: "narrow" })}
            </span>
          ))}
        </span>
        <span className="lq-stat-foot">
          {stats.expiringSoon
            ? "Vencem em até 3 dias. Vale um lembrete."
            : stats.counts.vencido
              ? `${num(stats.counts.vencido)} já ${stats.counts.vencido === 1 ? "venceu" : "venceram"}`
              : "Nenhuma proposta perto de vencer"}
        </span>
      </button>
    </section>
  );
}

export function QuotesEmptyState({ onCreate }: { onCreate: () => void }) {
  const steps = [
    {
      icon: UserRound,
      hue: "var(--v-blue)",
      title: "Escolha o cliente",
      text: "Busque um contato ou cadastre na hora",
    },
    {
      icon: FileText,
      hue: "var(--v-violet)",
      title: "Monte a proposta",
      text: "Produto, desconto, parcelas e validade",
    },
    {
      icon: Send,
      hue: "var(--v-orchid)",
      title: "Envie no WhatsApp",
      text: "A mensagem sai pronta, direto na conversa",
    },
  ];
  return (
    <div className="lq-empty">
      <div>
        <h2>Sua primeira proposta começa aqui.</h2>
        <p>
          Crie um orçamento em segundos: escolha o produto, ajuste desconto e parcelas, e envie a
          mensagem pronta direto na conversa.
        </p>
        <button type="button" onClick={onCreate} className="lq-primary">
          <Plus aria-hidden="true" />
          Criar primeiro orçamento
        </button>
      </div>
      <ol className="lq-steps">
        {steps.map(({ icon: Icon, hue, title, text }) => (
          <li key={title}>
            <span style={{ "--hue": hue } as CSSProperties} aria-hidden="true">
              <Icon />
            </span>
            <div>
              <b>{title}</b>
              <small>{text}</small>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export const FILTERS: Array<{ id: QuoteFilter; label: string; dot?: string }> = [
  { id: "todos", label: "Todos" },
  { id: "pendente", label: "Para enviar", dot: "var(--st-pendente)" },
  { id: "enviado", label: "Enviados", dot: "var(--st-enviado)" },
  { id: "visualizado", label: "Visualizados", dot: "var(--st-visualizado)" },
  { id: "aprovado", label: "Aprovados", dot: "var(--st-aprovado)" },
  { id: "vencido", label: "Vencidos", dot: "var(--st-vencido)" },
];

export const SORTS = [
  { id: "recentes", label: "Mais recentes" },
  { id: "valor", label: "Maior valor" },
  { id: "validade", label: "Vencem primeiro" },
] as const;
export type QuoteSort = (typeof SORTS)[number]["id"];

export function sortQuotes(quotes: Quote[], sort: QuoteSort): Quote[] {
  if (sort === "recentes") return quotes;
  const copy = [...quotes];
  if (sort === "valor") return copy.sort((a, b) => b.finalValue - a.finalValue);
  return copy.sort((a, b) => (a.validUntil || "9999").localeCompare(b.validUntil || "9999"));
}
