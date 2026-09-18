import { formatBRL } from "@/data/mock";
import { classifyCustomer, describeHistory } from "@/lib/customer-loyalty";
import { CustomerTierBadge } from "./CustomerTierBadge";
import type { AtendimentoContact } from "@/hooks/useAtendimentoData";

export function InsightPanel({ contact }: { contact: AtendimentoContact }) {
  const tier = classifyCustomer(contact.history);
  return <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto"><div><h3 className="text-2xl font-extrabold">Informações</h3><p className="text-xs text-muted-foreground">Dados da conversa atual</p></div><CustomerTierBadge history={contact.history} /><div className="grid gap-3 text-sm"><Info label="Nome" value={contact.lead.name} /><Info label="Telefone" value={contact.lead.phone ?? contact.lead.handle} /><Info label="Cidade" value={contact.conversation.detectedCity} /><Info label="Estado" value={contact.conversation.detectedState} /><Info label="Interesse" value={contact.lead.product} /><Info label="Ticket registrado" value={contact.lead.estimatedValue ? formatBRL(contact.lead.estimatedValue) : null} /></div><div className="rounded-2xl bg-secondary/60 p-3 text-xs text-muted-foreground"><strong className="text-foreground">Relacionamento: {tier.label}</strong><p className="mt-1">{describeHistory(contact.history)}</p></div></div>;
}

function Info({ label, value }: { label: string; value?: string | null }) { return <div><div className="mb-1 text-xs font-semibold text-muted-foreground">{label}</div><div className="rounded-xl bg-secondary/50 px-3 py-2">{value || "Não informado"}</div></div>; }
