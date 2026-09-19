import { Check, Copy, Sparkles } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatBRL } from "@/data/mock";
import { classifyCustomer, describeHistory } from "@/lib/customer-loyalty";
import { CustomerTierBadge } from "./CustomerTierBadge";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";

export function InsightPanel({ contact }: { contact: AtendimentoContact }) {
  const tier = classifyCustomer(contact.history);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto pr-1">
      <div>
        <h3 className="text-[30px] font-extrabold leading-none tracking-tight">Informações</h3>
        <p className="mt-1.5 flex items-center gap-1 text-[13px] font-bold text-muted-foreground">
          Dados da conversa atual
          <Sparkles className="h-3.5 w-3.5 text-primary" />
        </p>
      </div>

      <Field label="Nome" value={contact.lead.name} badge={<CustomerTierBadge history={contact.history} />} />
      <Field label="Telefone" value={contact.lead.phone ?? contact.lead.handle} />
      <Field label="Cidade" value={contact.conversation.detectedCity} />
      <Field label="Estado" value={contact.conversation.detectedState} />
      <Field label="Interesse" value={contact.lead.product} />
      <Field
        label="Ticket registrado"
        value={contact.lead.estimatedValue ? formatBRL(contact.lead.estimatedValue) : null}
      />

      <div className="rounded-2xl border border-border p-3.5">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Relacionamento
        </p>
        <p className="text-sm font-bold" style={{ color: tier.color }}>
          {tier.emoji} {tier.label}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{tier.reason}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">{describeHistory(contact.history)}</p>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  badge,
}: {
  label: string;
  value?: string | null;
  badge?: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

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
        disabled={!value}
        title={value ? "Clique para copiar" : undefined}
        className={cn(
          "group relative flex min-h-11 w-full items-center rounded-2xl border border-border bg-secondary px-3.5 text-left text-sm transition-colors",
          value ? "hover:bg-accent" : "cursor-default text-muted-foreground",
        )}
      >
        <span>{value ?? "Não informado"}</span>
        {value && (
          <span className="absolute right-3 opacity-0 transition-opacity group-hover:opacity-100">
            {copied ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
          </span>
        )}
      </button>
    </div>
  );
}
