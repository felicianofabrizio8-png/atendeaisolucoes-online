/**
 * Pure helpers for WhatsApp "contacts" messages (a contact card shared by
 * the lead). Both webhooks persist the full Meta payload in
 * `messages.source_metadata.raw`, so the card can be rebuilt on read —
 * including for messages received before this module existed.
 *
 * Meta payload: `contacts: [{ name: { formatted_name, first_name, ... },
 * phones: [{ phone, wa_id?, type? }] }]`.
 */

export interface SharedContact {
  name: string | null;
  /** Phone as shown on the shared card (for display / copy). */
  phone: string | null;
  /** Digits with country code, only when we are confident it is dialable. */
  whatsappDigits: string | null;
  whatsappUrl: string | null;
}

const GENERIC_LABEL = "👤 Contato";

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function contactName(name: unknown): string | null {
  if (!name || typeof name !== "object") return str(name);
  const n = name as Record<string, unknown>;
  return (
    str(n.formatted_name) ??
    ([str(n.first_name), str(n.middle_name), str(n.last_name)].filter(Boolean).join(" ") || null)
  );
}

// Never guess a country code: a WhatsApp link is only offered for wa_id
// (confirmed by Meta), an explicit international prefix, or a number long
// enough to already carry one.
function whatsappDigitsFor(phone: string | null, waId: string | null): string | null {
  const fromWaId = waId?.replace(/\D/g, "") ?? "";
  if (fromWaId.length >= 8 && fromWaId.length <= 15) return fromWaId;
  if (!phone) return null;
  const international = /^\s*(\+|00)/.test(phone);
  let digits = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("00")) digits = digits.slice(2);
  if (international && digits.length >= 8 && digits.length <= 15) return digits;
  if (digits.length >= 12 && digits.length <= 15) return digits;
  return null;
}

export function sharedContactsFromPayload(contacts: unknown): SharedContact[] {
  if (!Array.isArray(contacts)) return [];
  const out: SharedContact[] = [];
  for (const item of contacts) {
    if (!item || typeof item !== "object") continue;
    const c = item as Record<string, unknown>;
    const phones = Array.isArray(c.phones) ? c.phones : [];
    const first = phones.find(
      (p) => p && typeof p === "object" && (str(p.phone) || str(p.wa_id)),
    ) as Record<string, unknown> | undefined;
    const name = contactName(c.name);
    const phone = str(first?.phone) ?? str(first?.wa_id);
    if (!name && !phone) continue;
    const whatsappDigits = whatsappDigitsFor(phone, str(first?.wa_id));
    out.push({
      name,
      phone,
      whatsappDigits,
      whatsappUrl: whatsappDigits ? `https://wa.me/${whatsappDigits}` : null,
    });
  }
  return out;
}

export function getSharedContacts(message: {
  sourceSubtype?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
}): SharedContact[] {
  const subtype = (message.sourceSubtype ?? "").toLowerCase();
  if (subtype !== "contacts" && subtype !== "contact") return [];
  const raw = message.sourceMetadata?.raw;
  if (!raw || typeof raw !== "object") return [];
  return sharedContactsFromPayload((raw as Record<string, unknown>).contacts);
}

export function formatSharedContactsText(contacts: SharedContact[]): string {
  const [first] = contacts;
  if (!first) return GENERIC_LABEL;
  const main = [first.name, first.phone].filter(Boolean).join(" · ");
  const extra = contacts.length > 1 ? ` (+${contacts.length - 1})` : "";
  return `${GENERIC_LABEL}: ${main}${extra}`;
}

/** Texto curto para listas: nome · telefone quando o contato é recuperável. */
export function sharedContactsPreview(message: {
  text?: string | null;
  sourceSubtype?: string | null;
  sourceMetadata?: Record<string, unknown> | null;
}): string | null {
  const contacts = getSharedContacts(message);
  return contacts.length > 0 ? formatSharedContactsText(contacts) : null;
}
