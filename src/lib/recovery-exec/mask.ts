// Mascaramento do destinatário exibido na confirmação (Fase 6.3).
// O vendedor precisa reconhecer o número; ninguém precisa vê-lo inteiro.

export function maskRecipient(raw: string | null | undefined): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "número indisponível";
  if (digits.length <= 4) return `•••${digits}`;
  const head = digits.slice(0, 2);
  const tail = digits.slice(-4);
  return `+${head} ••••• ${tail}`;
}
