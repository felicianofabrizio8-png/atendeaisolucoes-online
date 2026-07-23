// Coach Teach Mode — extração estruturada (BLOCO 2).
// Server-side apenas. Consome Lovable AI Gateway via LLMGateway existente.
//
// BLOCO 2:
//  - Novo prompt v2026-07-23.b2 exige título CONCEITUAL, regra com
//    seções Gatilho/Ação/Objetivo/Evitar, categoria e prioridade coerentes.
//  - Resposta da IA passa por normalizeAiDraft (funções puras testáveis)
//    antes de virar CoachLearningDraft — respostas malformadas caem em
//    fallback seguro em vez de lançar exceção.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { LLMGateway } from "@/lib/llm-gateway/LLMGateway.server";
import { LovableChatProvider } from "@/lib/llm-gateway/providers/LovableChatProvider";
import {
  TEACH_MODE_PROMPT_VERSION,
  type CoachLearningDraft,
} from "./schema";
import { normalizeAiDraft } from "./interpretation";

type SB = SupabaseClient<Database>;

const TEACH_MODE_MODEL = "google/gemini-2.5-flash";
const TEACH_MODE_TEMPERATURE = 0.2;
const TEACH_MODE_MAX_TOKENS = 1100;

const SYSTEM_PROMPT = `Você é o assistente de "Ensinar IA" do Atende Aí.
Um vendedor está corrigindo o Coach IA. Sua tarefa: transformar a correção em um APRENDIZADO REUTILIZÁVEL — não uma resposta pontual para uma única frase.

RETORNE APENAS JSON válido (sem markdown, sem code fences) com este shape exato:
{
  "category": "objection" | "product_positioning" | "pricing" | "qualification" | "closing" | "followup" | "tone" | "process" | "other",
  "product_ref": string | null,
  "title": string,
  "description": string,
  "rule_structured": string,
  "positive_example": string | null,
  "negative_example": string | null,
  "priority": number,
  "confidence": number
}

TÍTULO (3–120 chars):
- Represente o PADRÃO COMPORTAMENTAL, não a frase do cliente.
- NUNCA copie literalmente a mensagem do cliente nem use aspas.
- NUNCA use "Lidar com …", "Responder a …" ou frases citando texto.
- NÃO inclua nome de cliente, produto específico ou detalhes temporários,
  a menos que sejam essenciais ao aprendizado.
- Exemplos corretos:
  • "Reconhecer quando o cliente está comparando propostas"
  • "Conduzir decisões compartilhadas"
  • "Responder clientes que ainda estão avaliando a compra"
  • "Trabalhar objeções de preço com foco em valor"

DESCRIÇÃO (3–2000 chars):
- Explique: (1) qual situação ativa o aprendizado, (2) o erro a evitar,
  (3) o comportamento esperado, (4) o objetivo comercial/atendimento.

REGRA ESTRUTURADA (rule_structured, 3–2000 chars):
- Estruture EXATAMENTE neste formato, cada seção separada por linha em branco:

Gatilho:
<situação que aciona a regra>

Ação obrigatória:
<o que a IA DEVE fazer>

Objetivo:
<resultado esperado>

Evitar:
• <erro 1>
• <erro 2>
• <erro 3>

CATEGORIA — escolha a mais adequada:
- comparação de orçamentos, "está caro", "vou pensar" → objection
- preço/desconto/parcelamento como tema central → pricing
- diferenciais técnicos ou modelo do produto → product_positioning
- descoberta de necessidade → qualification
- assinatura/fechamento de contrato → closing
- retomar contato após espera (esposa, marido, "vou pensar") → followup
- tom, linguagem, insistência → tone
- política interna, fluxo, procedimento → process
- fora do catálogo → other

PRIORIDADE (0–100) — reflita IMPACTO real do erro:
- 90–100: risco legal/financeiro/segurança/compliance/promessa indevida.
- 75–89: erro que prejudica diretamente conversão ou confiança.
- 50–74: melhoria importante de atendimento.
- 25–49: preferência de estilo ou refinamento.
- 0–24: detalhe pouco relevante.
NÃO atribua 90+ por padrão. A maioria dos aprendizados fica entre 55 e 80.

EXEMPLOS:
- positive_example: uma resposta modelo que aplica a regra.
- negative_example: um exemplo claro do erro que deve ser evitado.
- NUNCA invente prazos, produtos, preços, condições comerciais, nome do
  cliente, forma de pagamento ou intenção de compra que não estejam no
  contexto fornecido.
- Se a sugestão original do Coach foi rejeitada, use-a como negative_example.

REGRAS DURAS:
- Use APENAS: mensagem do cliente, sugestão original, correção do vendedor
  e contexto explícito. Não infira histórico não fornecido.
- product_ref é literal (o que o usuário escreveu). Sem inferir catálogo.
- confidence entre 0 e 1 — baixa quando faltam elementos essenciais.`;

export interface TeachModeExtractResult {
  draft: CoachLearningDraft;
  raw: unknown;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  promptVersion: string;
  usedFallback: boolean;
}

function parseJsonSafe(raw: string): unknown | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Tenta extrair o primeiro bloco { … } no meio de ruído.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function extractTeachModeDraft(args: {
  supabase: SB;
  companyId: string;
  companyName?: string | null;
  userExplanation: string;
  priorTurns?: Array<{ role: "user" | "assistant"; content: string }>;
  clientMessage?: string | null;
  suggestionText?: string | null;
}): Promise<TeachModeExtractResult> {
  const {
    supabase,
    companyId,
    companyName,
    userExplanation,
    priorTurns = [],
    clientMessage = null,
    suggestionText = null,
  } = args;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  void supabase;

  const gateway = new LLMGateway(supabaseAdmin, {
    providers: [new LovableChatProvider({ defaultModel: TEACH_MODE_MODEL })],
    cacheEnabled: false,
    retryAttempts: 1,
  });

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...(companyName
      ? [{ role: "system" as const, content: `Empresa: ${companyName}.` }]
      : []),
    ...priorTurns
      .slice(-8)
      .map((t) => ({ role: t.role, content: (t.content ?? "").slice(0, 1800) })),
    { role: "user" as const, content: userExplanation.slice(0, 4000) },
  ];

  const resp = await gateway.run({
    companyId,
    model: TEACH_MODE_MODEL,
    temperature: TEACH_MODE_TEMPERATURE,
    maxTokens: TEACH_MODE_MAX_TOKENS,
    responseFormat: "json",
    messages,
    tags: {
      feature: "coach_teach_mode",
      prompt_version: TEACH_MODE_PROMPT_VERSION,
    },
  });

  const parsed = parseJsonSafe(resp.text);
  const { draft, usedFallback } = normalizeAiDraft(parsed, {
    userExplanation,
    clientMessage,
    suggestionText,
  });

  return {
    draft,
    raw: parsed,
    provider: resp.provider,
    model: resp.model,
    tokensIn: resp.tokensIn,
    tokensOut: resp.tokensOut,
    latencyMs: resp.latencyMs,
    promptVersion: TEACH_MODE_PROMPT_VERSION,
    usedFallback,
  };
}
