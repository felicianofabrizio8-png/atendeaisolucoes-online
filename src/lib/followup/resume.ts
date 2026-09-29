// ============================================================================
// followup/resume.ts
// Responsabilidade: carregar o contexto real da conversa e gerar a frase de
// retomada ({{1}} do `chamar_novamente`) via LLMGateway. Qualquer falha da IA
// ou frase reprovada na validação cai no fallback contextual determinístico.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  buildResumePrompt,
  fallbackResumePhrase,
  hasResumeContext,
  normalizeResumePhrase,
  RESUME_PROMPT_VERSION,
  type ResumeContext,
  type ResumePhraseSource,
} from "./resume-phrase";

const RESUME_MODEL = "google/gemini-2.5-flash";

export async function loadResumeContext(
  companyId: string,
  /** `null` = lead ainda sem conversa: o contexto vem só do lead e do orçamento. */
  conversationId: string | null,
  leadId: string,
): Promise<ResumeContext> {
  const none = Promise.resolve({ data: null });
  const [{ data: lead }, { data: conv }, { data: quote }, { data: msgs }] = await Promise.all([
    supabaseAdmin
      .from("leads")
      .select("name, product")
      .eq("company_id", companyId)
      .eq("id", leadId)
      .maybeSingle(),
    conversationId
      ? supabaseAdmin
          .from("conversations")
          .select(
            "detected_intent, detected_interest, detected_objections, purchase_timing, lead_ready_to_close",
          )
          .eq("company_id", companyId)
          .eq("id", conversationId)
          .maybeSingle()
      : none,
    supabaseAdmin
      .from("quotes")
      .select("product_name")
      .eq("company_id", companyId)
      .eq("lead_id", leadId)
      .eq("sent", true)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    conversationId
      ? supabaseAdmin
          .from("messages")
          .select("role, text, at")
          .eq("company_id", companyId)
          .eq("conversation_id", conversationId)
          .order("at", { ascending: false })
          .limit(20)
      : none,
  ]);

  const objections = (conv?.detected_objections ?? []) as string[];
  return {
    leadName: lead?.name ?? null,
    product: lead?.product ?? null,
    quote: quote ? { productName: quote.product_name ?? null } : null,
    objection: objections[0] ?? null,
    intent: conv?.detected_intent ?? null,
    interest: conv?.detected_interest ?? null,
    timing: conv?.purchase_timing ?? null,
    readyToClose: conv?.lead_ready_to_close === true,
    recentMessages: ((msgs ?? []) as Array<{ role: string; text: string | null }>)
      .slice()
      .reverse()
      .map((m) => ({
        role: m.role === "lead" || m.role === "agent" ? m.role : "system",
        text: m.text ?? "",
      })),
  };
}

export interface ResumePhrase {
  text: string;
  source: ResumePhraseSource;
  /** Motivo de não ter usado a IA, quando for o caso. */
  aiError?: string;
}

/**
 * Frase de retomada para o {{1}}. Com contexto, tenta a IA; se ela falhar ou
 * a frase não passar na validação (nome, tamanho, valores), usa o fallback
 * contextual. Sem contexto nenhum, nem chama a IA.
 */
export async function generateResumePhrase(args: {
  companyId: string;
  context: ResumeContext;
  templateBody: string;
}): Promise<ResumePhrase> {
  const { companyId, context, templateBody } = args;
  if (!hasResumeContext(context)) return fallbackResumePhrase(context);

  try {
    const [{ LLMGateway }, { LovableChatProvider }] = await Promise.all([
      import("@/lib/llm-gateway/LLMGateway.server"),
      import("@/lib/llm-gateway/providers/LovableChatProvider"),
    ]);
    const gateway = new LLMGateway(supabaseAdmin, {
      providers: [new LovableChatProvider({ defaultModel: RESUME_MODEL, timeoutMs: 15_000 })],
      cacheEnabled: false,
      retryAttempts: 1,
    });
    const resp = await gateway.run({
      companyId,
      model: RESUME_MODEL,
      temperature: 0.4,
      maxTokens: 200,
      messages: buildResumePrompt(context, templateBody),
      tags: { feature: "followup_resume_phrase", prompt_version: RESUME_PROMPT_VERSION },
    });
    const phrase = normalizeResumePhrase(resp.text, context);
    if (phrase) return { text: phrase, source: "ai" };
    return { ...fallbackResumePhrase(context), aiError: "frase reprovada na validação" };
  } catch (e) {
    return {
      ...fallbackResumePhrase(context),
      aiError: e instanceof Error ? e.message : String(e),
    };
  }
}
