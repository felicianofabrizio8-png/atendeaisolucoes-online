/**
 * Função central de normalização de telefone para o padrão E.164 (focado em Brasil).
 * 
 * Regras:
 * 1. Remove todos os caracteres não numéricos.
 * 2. Se o número tiver 10 ou 11 dígitos (DDD + número), assume que é Brasil e adiciona 55.
 * 3. Se já começar com 55 e tiver 12 ou 13 dígitos, mantém.
 * 4. Retorna apenas dígitos.
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return "";

  // 1. Manter apenas dígitos
  let cleaned = phone.replace(/\D/g, "");

  if (!cleaned) return "";

  // 2. Lógica para Brasil
  // Se tem 10 ou 11 dígitos, é um número brasileiro sem DDI (ex: 15988002521 ou 1532241234)
  if (cleaned.length === 10 || cleaned.length === 11) {
    return `55${cleaned}`;
  }

  // Se tem 12 ou 13 dígitos e não começa com 55, mas parece ser Brasil (ex: 55... ja incluso ou outro DDI)
  // Se começar com 0, remove o zero inicial (comum em cadastros manuais errados)
  if (cleaned.startsWith("0")) {
    cleaned = cleaned.substring(1);
    return normalizePhone(cleaned);
  }

  return cleaned;
}

/**
 * Compara dois telefones de forma segura, normalizando ambos.
 */
export function isSamePhone(phoneA: string | null | undefined, phoneB: string | null | undefined): boolean {
  const normA = normalizePhone(phoneA);
  const normB = normalizePhone(phoneB);
  if (!normA || !normB) return false;
  return normA === normB;
}
