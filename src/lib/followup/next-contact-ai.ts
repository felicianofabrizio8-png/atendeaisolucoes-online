// ============================================================================
// followup/next-contact-ai.ts
// Responsabilidade: pedir à IA uma data de retorno quando o cliente falou de
// tempo de um jeito que o parser determinístico não resolve ("depois que o
// salário cair", "passando o feriado"). A resposta só vale se passar em
// `validateSuggestedDate` — evidência literal do cliente + data no horizonte.
// Qualquer falha → null (o chamador usa a política padrão).
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { zonedParts } from "./calendar";
import { validateSuggestedDate } from "./next-contact";

const MODEL = "google/gemini-2.5-flash";
export const NEXT_CONTACT_PROMPT_VERSION = "2026-09-28.a";

export async function suggestNextContactDate(args: {
  companyId: string;
  now: Date;
  timeZone: string;
  /** Mais antigas primeiro. */
  messages: Array<{ role: "lead" | "agent"; text: string; at: string }>;
}): Promise<Date | null> {
  const leadTexts = args.messages.filter((m) => m.role === "lead").map((m) => m.text);
  if (leadTexts.length === 0) return null;
  const p = zonedParts(args.now, args.timeZone);
  const today = `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;

  const transcript = args.messages
    .slice(-10)
    .map(
      (m) =>
        `${m.role === "lead" ? "Cliente" : "Atendente"} (${m.at.slice(0, 10)}): ${m.text.slice(0, 300)}`,
    )
    .join("\n");

  try {
    const [{ LLMGateway }, { LovableChatProvider }] = await Promise.all([
      import("@/lib/llm-gateway/LLMGateway.server"),
      import("@/lib/llm-gateway/providers/LovableChatProvider"),
    ]);
    const gateway = new LLMGateway(supabaseAdmin, {
      providers: [new LovableChatProvider({ defaultModel: MODEL, timeoutMs: 15_000 })],
      cacheEnabled: false,
      retryAttempts: 1,
    });
    const resp = await gateway.run({
      companyId: args.companyId,
      model: MODEL,
      temperature: 0,
      maxTokens: 80,
      responseFormat: "json",
      messages: [
        {
          role: "system",
          content: `Hoje é ${today} (fuso ${args.timeZone}). Leia a conversa e diga QUANDO faz sentido o vendedor procurar o cliente de novo, com base só no que o CLIENTE disse sobre tempo (prazo, data, evento).
Responda APENAS JSON: {"date":"YYYY-MM-DD" ou null,"evidence":"trecho EXATO copiado de uma mensagem do cliente"}.
Se o cliente não indicou tempo, responda {"date":null,"evidence":""}. Nunca invente.`,
        },
        { role: "user", content: transcript },
      ],
      tags: { feature: "followup_next_contact", prompt_version: NEXT_CONTACT_PROMPT_VERSION },
    });
    const parsed = JSON.parse(resp.text.replace(/^```(?:json)?|```$/g, "").trim()) as {
      date?: unknown;
      evidence?: unknown;
    };
    return validateSuggestedDate(parsed, { now: args.now, timeZone: args.timeZone, leadTexts });
  } catch (e) {
    console.warn("[followup] sugestão de data indisponível:", e instanceof Error ? e.message : e);
    return null;
  }
}
