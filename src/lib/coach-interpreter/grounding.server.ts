// ============================================================================
// Coach Interpreter — Grounding (Knowledge Base + Catálogo + Regras + Campanhas)
//
// Fase 3.4 (Hotfix Grounding): antes de qualquer geração, o Interpreter
// consulta OBRIGATORIAMENTE o conhecimento operacional da empresa para
// evitar respostas construídas apenas com conhecimento genérico da LLM.
//
// Restrições respeitadas:
//   - Nenhuma migration nova, nenhuma API pública alterada.
//   - Nenhuma tabela nova — apenas SELECT nas já existentes.
//   - Recebe o supabase autenticado (RLS por tenant) — nunca supabaseAdmin.
//   - Determinístico e resiliente: falhas parciais NÃO derrubam o fluxo,
//     apenas reduzem `groundingScore` e sinalizam em `warnings`.
// ============================================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type SB = SupabaseClient<Database>;

export interface CoachGroundingSources {
  products: boolean;
  knowledge_base: boolean;
  faq: boolean;
  quick_replies: boolean;
  active_rules: boolean;
  campaigns: boolean;
}

export interface CoachGroundingCounts {
  products: number;
  quick_replies: number;
  active_rules: number;
  campaigns: number;
  kb_sections: number;
}

export interface CoachGroundingRawProduct {
  name: string;
  category: string | null;
  description: string | null;
}

export interface CoachGroundingRaw {
  products: CoachGroundingRawProduct[];
  forbiddenWords: string[];
  preferredWords: string[];
  activeRuleTitles: string[];
  detectedDomains: string[]; // ex.: ["piscinas"]
}

export interface CoachGroundingContext {
  block: string; // Texto pronto para injeção no system prompt (pt-BR).
  sourcesUsed: CoachGroundingSources;
  groundingScore: number; // 0..1 — quanto conhecimento efetivo foi carregado.
  counts: CoachGroundingCounts;
  warnings: string[]; // sanitizadas
  isEmpty: boolean; // true quando nenhuma fonte trouxe dado útil
  raw: CoachGroundingRaw; // dados estruturados para o Domain Validator
}


const MAX_PRODUCTS = 40;
const MAX_QUICK_REPLIES = 20;
const MAX_RULES = 30;
const MAX_CAMPAIGNS = 5;
const MAX_STRING = 400;

function clip(s: string | null | undefined, max = MAX_STRING): string {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function bullet(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n");
}

/**
 * Coleta o contexto de conhecimento da empresa para grounding do Interpreter.
 * Todas as consultas são independentes e resilientes.
 */
export async function buildCompanyGrounding(sb: SB, companyId: string): Promise<CoachGroundingContext> {
  const warnings: string[] = [];
  const sources: CoachGroundingSources = {
    products: false,
    knowledge_base: false,
    faq: false,
    quick_replies: false,
    active_rules: false,
    campaigns: false,
  };
  const counts: CoachGroundingCounts = {
    products: 0,
    quick_replies: 0,
    active_rules: 0,
    campaigns: 0,
    kb_sections: 0,
  };

  // -- Consultas em paralelo (defensivas: nenhuma joga fora do try) --------
  type Res<T> = { data: T | null; error: unknown };
  const safe = async <T,>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<Res<T>> => {
    try {
      const r = await p;
      return { data: r.data ?? null, error: r.error ?? null };
    } catch (e) {
      return { data: null, error: e };
    }
  };

  const [productsRes, kbRes, quickRes, rulesRes, campaignsRes] = await Promise.all([
    safe(
      sb
        .from("products")
        .select("name, description, price, promo_price, category, notes, active")
        .eq("company_id", companyId)
        .eq("active", true)
        .order("name", { ascending: true })
        .limit(MAX_PRODUCTS),
    ),
    safe(
      sb
        .from("marketing_knowledge_base")
        .select(
          "brand_identity, tone_of_voice, differentiators, products_services, guarantees, cities_served, gifts, commercial_terms, preferred_words, forbidden_words, extra_notes",
        )
        .eq("company_id", companyId)
        .maybeSingle(),
    ),
    safe(
      sb
        .from("quick_replies")
        .select("name, category, content")
        .eq("company_id", companyId)
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .limit(MAX_QUICK_REPLIES),
    ),
    safe(
      sb
        .from("coach_rules")
        .select("title, category, scope_kind, priority, status")
        .eq("company_id", companyId)
        .eq("status", "active")
        .order("priority", { ascending: false })
        .limit(MAX_RULES),
    ),
    safe(
      sb
        .from("campaigns")
        .select("name, product, headline, primary_text, cta, status")
        .eq("company_id", companyId)
        .in("status", ["active", "publishing", "published"])
        .order("updated_at", { ascending: false })
        .limit(MAX_CAMPAIGNS),
    ),
  ]);

  const sections: string[] = [];
  const raw: CoachGroundingRaw = {
    products: [],
    forbiddenWords: [],
    preferredWords: [],
    activeRuleTitles: [],
    detectedDomains: [],
  };


  // -- Produtos ------------------------------------------------------------
  if ((productsRes as { error?: unknown }).error) {
    warnings.push("grounding_products_failed");
  } else {
    const rows = (productsRes.data ?? []) as Array<{
      name: string;
      description: string | null;
      price: number | null;
      promo_price: number | null;
      category: string | null;
      notes: string | null;
    }>;
    counts.products = rows.length;
    if (rows.length > 0) {
      sources.products = true;
      raw.products = rows.map((p) => ({
        name: clip(p.name, 80),
        category: p.category ? clip(p.category, 40) : null,
        description: p.description ? clip(p.description, 240) : null,
      }));
      const haystack = rows
        .map((p) => `${p.name ?? ""} ${p.category ?? ""} ${p.description ?? ""}`)
        .join(" ")
        .toLowerCase();
      if (/\b(piscina|fibra|prainha|maragogi|canyon)\b/.test(haystack)) {
        raw.detectedDomains.push("piscinas");
      }

      const lines = rows.map((p) => {
        const price =
          p.promo_price != null
            ? `promo R$ ${p.promo_price}`
            : p.price != null
              ? `R$ ${p.price}`
              : "preço sob consulta";
        const cat = p.category ? ` [${clip(p.category, 40)}]` : "";
        const desc = clip(p.description, 180);
        const notes = clip(p.notes, 120);
        return `${clip(p.name, 80)}${cat} — ${price}${desc ? ` — ${desc}` : ""}${notes ? ` (${notes})` : ""}`;
      });
      sections.push(
        `### CATÁLOGO DE PRODUTOS (fonte da verdade — nunca invente modelos, medidas ou preços fora desta lista)\n${bullet(lines)}`,
      );
    }
  }

  // -- Knowledge Base ------------------------------------------------------
  if ((kbRes as { error?: unknown }).error) {
    warnings.push("grounding_kb_failed");
  } else {
    const kb = kbRes.data as {
      brand_identity?: string | null;
      tone_of_voice?: string | null;
      differentiators?: string | null;
      products_services?: string | null;
      guarantees?: string | null;
      cities_served?: string | null;
      gifts?: string | null;
      commercial_terms?: string | null;
      preferred_words?: string | null;
      forbidden_words?: string | null;
      extra_notes?: string | null;
    } | null;
    if (kb) {
      const kbLines: string[] = [];
      const push = (label: string, val?: string | null) => {
        const v = clip(val, 500);
        if (v) {
          kbLines.push(`**${label}:** ${v}`);
          counts.kb_sections += 1;
        }
      };
      push("Identidade da marca", kb.brand_identity);
      push("Tom de voz", kb.tone_of_voice);
      push("Diferenciais", kb.differentiators);
      push("Produtos e serviços (descrição)", kb.products_services);
      push("Garantias", kb.guarantees);
      push("Cidades atendidas", kb.cities_served);
      push("Brindes", kb.gifts);
      push("Condições comerciais", kb.commercial_terms);
      push("Palavras preferidas", kb.preferred_words);
      push("Palavras proibidas", kb.forbidden_words);
      push("Observações extras", kb.extra_notes);
      const splitTokens = (s?: string | null) =>
        (s ?? "")
          .split(/[,;\n|]+/)
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length >= 2 && t.length <= 60);
      raw.forbiddenWords = splitTokens(kb.forbidden_words);
      raw.preferredWords = splitTokens(kb.preferred_words);
      if (kbLines.length > 0) {
        sources.knowledge_base = true;
        sections.push(`### BASE DE CONHECIMENTO DA EMPRESA\n${kbLines.join("\n")}`);
      }
    }
  }


  // -- Quick Replies (também servem como FAQ operacional) ------------------
  if ((quickRes as { error?: unknown }).error) {
    warnings.push("grounding_quick_replies_failed");
  } else {
    const rows = (quickRes.data ?? []) as Array<{
      name: string;
      category: string | null;
      content: string;
    }>;
    counts.quick_replies = rows.length;
    if (rows.length > 0) {
      sources.quick_replies = true;
      const isFaq = rows.some((r) => (r.category ?? "").toLowerCase().includes("faq"));
      if (isFaq) sources.faq = true;
      const lines = rows.map(
        (r) => `${clip(r.name, 60)}${r.category ? ` [${clip(r.category, 30)}]` : ""}: ${clip(r.content, 200)}`,
      );
      sections.push(
        `### RESPOSTAS RÁPIDAS / FAQ OPERACIONAL\n${bullet(lines)}`,
      );
    }
  }

  // -- Regras comerciais ativas -------------------------------------------
  if ((rulesRes as { error?: unknown }).error) {
    warnings.push("grounding_rules_failed");
  } else {
    const rows = (rulesRes.data ?? []) as Array<{
      title: string;
      category: string;
      scope_kind: string;
      priority: number;
    }>;
    counts.active_rules = rows.length;
    if (rows.length > 0) {
      sources.active_rules = true;
      const lines = rows.map(
        (r) => `[${r.category}/${r.scope_kind}] (p${r.priority}) ${clip(r.title, 140)}`,
      );
      sections.push(
        `### REGRAS COMERCIAIS JÁ ATIVAS (nunca proponha regra que contradiga uma destas)\n${bullet(lines)}`,
      );
    }
  }

  // -- Campanhas vigentes -------------------------------------------------
  if ((campaignsRes as { error?: unknown }).error) {
    warnings.push("grounding_campaigns_failed");
  } else {
    const rows = (campaignsRes.data ?? []) as Array<{
      name: string;
      product: string | null;
      headline: string | null;
      cta: string | null;
    }>;
    counts.campaigns = rows.length;
    if (rows.length > 0) {
      sources.campaigns = true;
      const lines = rows.map(
        (c) =>
          `${clip(c.name, 60)}${c.product ? ` — ${clip(c.product, 60)}` : ""}${c.headline ? ` — "${clip(c.headline, 120)}"` : ""}${c.cta ? ` [CTA: ${clip(c.cta, 40)}]` : ""}`,
      );
      sections.push(`### CAMPANHAS VIGENTES\n${bullet(lines)}`);
    }
  }

  // -- Score de grounding --------------------------------------------------
  const activeSources = Object.values(sources).filter(Boolean).length;
  const totalSources = Object.keys(sources).length;
  const groundingScore = totalSources > 0 ? Math.min(1, activeSources / totalSources) : 0;

  const isEmpty = sections.length === 0;

  const block = isEmpty
    ? "### CONTEXTO DA EMPRESA\n(NENHUMA fonte de conhecimento cadastrada. Não invente informações — se o proprietário mencionar produto, preço, medida, garantia, cidade, condição ou política específica, peça esclarecimento em vez de assumir.)"
    : `## CONTEXTO DA EMPRESA (grounding obrigatório)\nEste bloco é a ÚNICA fonte autorizada de fatos sobre a empresa. Ao interpretar a mensagem do proprietário e ao gerar perguntas de clarificação, você DEVE:\n1. Tratar este bloco como verdade acima do seu conhecimento geral.\n2. Nunca inventar produtos, modelos, medidas, preços, garantias, prazos, condições, cidades ou serviços que não estejam aqui.\n3. Gerar perguntas de clarificação compatíveis com o catálogo e as regras — nunca perguntas que assumam variáveis inexistentes (ex.: perguntar "largura ou profundidade?" quando os produtos têm dimensões fixas de fábrica).\n4. Se a informação necessária não estiver no bloco, marque como missing_information e peça esclarecimento — não complete pela imaginação.\n\n${sections.join("\n\n")}`;

  return {
    block,
    sourcesUsed: sources,
    groundingScore,
    counts,
    warnings,
    isEmpty,
    raw,
  };
}

