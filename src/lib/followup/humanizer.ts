// ============================================================================
// followup/humanizer.ts
// Responsabilidade: gerar variação linguística determinística das mensagens
// de follow-up (saudação, emoji, CTA) — opt-in via v2.humanize.
// Também expõe jitter para atrasos aleatórios controlados.
// Puro, sem I/O.
// ============================================================================

const GREETINGS = [
  "Oi {{nome}}",
  "Olá {{nome}}",
  "E aí {{nome}}",
  "Oi {{nome}}, tudo bem?",
  "Passando aqui rapidinho, {{nome}}",
];

const EMOJIS = ["😊", "🙂", "✨", "👋", ""];

const CTAS = [
  "Qualquer dúvida estou por aqui.",
  "Se preferir, é só me chamar quando puder.",
  "Posso te ajudar com algo agora?",
  "Fico no aguardo do seu retorno 🙏",
  "Quando puder, me dá um retorno por aqui.",
];

function pickSeeded<T>(arr: T[], seed: number, salt: number): T {
  const idx = Math.abs((seed * 9301 + salt * 49297) % 233280) % arr.length;
  return arr[idx];
}

export function humanizeTemplate(
  rawTemplate: string,
  attemptNumber: number,
  seed: number,
  vars: Record<string, string> = {},
): { text: string; variant: number } {
  // Substituição final de placeholders ({{nome}}, {{produto}}, {{agente}}, ...).
  // Executada também AO FINAL para cobrir placeholders introduzidos pelas
  // variações de saudação/CTA (ex.: "E aí {{nome}}"), evitando vazar
  // "{{nome}}" no WhatsApp.
  const interpolate = (s: string): string =>
    s.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");

  try {
    // Variante 1 = template original; 2+ aplica mutação
    if (attemptNumber <= 1 && seed % 3 === 0) {
      return { text: interpolate(rawTemplate), variant: 0 };
    }
    let text = rawTemplate;
    // Substitui saudação inicial se começar com "Oi" / "Olá"
    const greetingMatch = text.match(/^(Oi|Olá|Ola|E aí)[^,\n!.]*[,!.]?\s*/i);
    if (greetingMatch) {
      const newGreeting = pickSeeded(GREETINGS, seed, attemptNumber);
      text = newGreeting + ", " + text.slice(greetingMatch[0].length).trim();
    }
    // Emoji opcional
    const emoji = pickSeeded(EMOJIS, seed, attemptNumber + 7);
    if (emoji && !/[\u{1F300}-\u{1FAFF}]/u.test(text)) {
      text = text.replace(/([.!?])\s/, `$1 ${emoji} `);
    }
    // CTA final na 2ª+ tentativa
    if (attemptNumber > 1) {
      const cta = pickSeeded(CTAS, seed, attemptNumber + 13);
      text = text.trim() + "\n\n" + cta;
    }
    return { text: interpolate(text), variant: (seed * 31 + attemptNumber) | 0 };
  } catch {
    return { text: interpolate(rawTemplate), variant: 0 };
  }
}

/** Aplica jitter ±jitterMinutes (em ms) sobre baseMs, nunca negativo. */
export function jitterDelayMs(baseMs: number, jitterMinutes: number): number {
  const jitter = (Math.random() * 2 - 1) * jitterMinutes * 60 * 1000;
  return Math.max(0, baseMs + jitter);
}
