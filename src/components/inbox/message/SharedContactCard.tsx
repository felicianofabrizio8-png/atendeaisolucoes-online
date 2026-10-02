import { useState } from "react";
import { Check, Copy, ExternalLink, UserRound } from "lucide-react";
import type { SharedContact } from "@/lib/whatsapp/shared-contacts";

/**
 * Cartão de contato compartilhado pelo lead no WhatsApp (mensagem `contacts`).
 * Os dados vêm de `source_metadata.raw.contacts` via `getSharedContacts`.
 * Usa `currentColor` para funcionar tanto em balão do lead quanto do agente.
 */
export function SharedContactCard({ contact }: { contact: SharedContact }) {
  const [copied, setCopied] = useState(false);
  const copyPhone = () => {
    if (!contact.phone) return;
    void navigator.clipboard?.writeText(contact.phone).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div
      data-shared-contact
      className="min-w-[220px] max-w-full rounded-xl border border-current/15 bg-current/[0.04] p-3"
    >
      <div className="flex items-center gap-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-current/10">
          <UserRound className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{contact.name ?? "Contato sem nome"}</p>
          <p className="truncate text-xs opacity-75">{contact.phone ?? "Sem telefone"}</p>
        </div>
      </div>
      {contact.phone ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copyPhone}
            className="inline-flex items-center gap-1.5 rounded-full border border-current/25 px-3 py-1 text-[11px] font-semibold hover:bg-current/10"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copiado" : "Copiar telefone"}
          </button>
          {contact.whatsappUrl ? (
            <a
              href={contact.whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-current/25 px-3 py-1 text-[11px] font-semibold hover:bg-current/10"
            >
              <ExternalLink className="h-3 w-3" /> Abrir no WhatsApp
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SharedContactList({ contacts }: { contacts: SharedContact[] }) {
  return (
    <div className="space-y-2">
      {contacts.map((item, index) => (
        <SharedContactCard key={index} contact={item} />
      ))}
    </div>
  );
}
