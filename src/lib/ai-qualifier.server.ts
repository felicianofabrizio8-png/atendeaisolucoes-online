// ============================================================================
// AI Qualifier — Fase 2 (puro, sem I/O)
// Heurísticas determinísticas que complementam a extração do LLM:
//  - objeções (preço, prazo, concorrência, financiamento, espaço, confiança)
//  - sinal de compra iminente (lead_ready_to_close)
//  - normalização de cidade/estado/timing
//  - cálculo do lead_score e temperatura (frio/morno/quente)
// ============================================================================

export type Objection =
  | "preco"
  | "prazo"
  | "concorrencia"
  | "financiamento"
  | "espaco"
  | "confianca";

export type Temperature = "frio" | "morno" | "quente";
export type CustomerStage = "curioso" | "pesquisando" | "pronto_para_comprar";
export type PurchaseTiming = "imediato" | "30d" | "60d" | "90d+" | "indefinido";

const OBJECTION_PATTERNS: { id: Objection; re: RegExp }[] = [
  { id: "preco", re: /\b(caro|caríssim|salgad|fora do orçamento|muito (alto|elevad)|preço alto|barat)/i },
  { id: "prazo", re: /\b(demora|muito tempo|prazo longo|só (mês|semana) que vem|quando.*(chega|entrega|instala))/i },
  { id: "concorrencia", re: /\b(concorrente|outra empresa|outro fornecedor|empresa x|mais barato em outr)/i },
  { id: "financiamento", re: /\b(financia|parcel|cartão|boleto|pix.*divid|entrada|à vista)/i },
  { id: "espaco", re: /\b(não cabe|espaço pequeno|terreno pequeno|quintal pequeno|sem espaço)/i },
  { id: "confianca", re: /\b(golpe|confiá|seguro|garanti|reclama|reputaç|reclame aqui|cnpj)/i },
];

const READY_TO_CLOSE_PATTERNS: RegExp[] = [
  /\b(vou fechar|quero fechar|fecho (com|hoje|agora)|pode fechar)\b/i,
  /\b(quero (instal|comprar|adquirir)|quando (consegu|pode)e?m? (entreg|instal|chega))\b/i,
  /\b(manda (a|o) (proposta|contrato|nota|pagamento)|me passa o (pix|boleto))\b/i,
  /\b(pode mandar (o|a) (link|pagamento|boleto|pix))\b/i,
];

const BR_STATES_RE =
  /\b(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)\b/;

export function detectObjections(text: string): Objection[] {
  const out: Objection[] = [];
  for (const { id, re } of OBJECTION_PATTERNS) {
    if (re.test(text) && !out.includes(id)) out.push(id);
  }
  return out;
}

export function detectReadyToClose(text: string): boolean {
  return READY_TO_CLOSE_PATTERNS.some((re) => re.test(text));
}

export function normalizeState(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.toUpperCase().match(BR_STATES_RE);
  return m ? m[1] : null;
}

export function normalizeTiming(s: string | null | undefined): PurchaseTiming | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/(imediat|hoje|agora|essa semana|nesta semana|asap|urgente)/.test(t)) return "imediato";
  if (/(30 ?dias|próximo mês|proxim[ao] m[eê]s|mês que vem|um m[eê]s)/.test(t)) return "30d";
  if (/(60 ?dias|2 ?mes(es)?)/.test(t)) return "60d";
  if (/(90 ?dias|3 ?mes(es)?|trimestre|semestre|próximo ano|pr[oó]ximo ano|ano que vem)/.test(t))
    return "90d+";
  if (/(ainda (n[aã]o sei|sem prazo)|pesquisand|talvez|futuro)/.test(t)) return "indefinido";
  return null;
}

// ---------------------------------------------------------------------------
// Score comercial
// ---------------------------------------------------------------------------
// Componentes:
//  + cidade detectada              +10
//  + estado/UF detectado           +5
//  + tamanho de piscina detectado  +15
//  + interesse detectado           +10
//  + orçamento detectado           +10
//  + timing imediato               +25  (30d=+15, 60d=+10, 90d=+5)
//  + customer_stage=pronto         +25 (pesquisando=+15, curioso=+5)
//  + ready_to_close                +30
//  - cada objeção                  -7   (mín 0)
// ---------------------------------------------------------------------------

export interface ScoreInput {
  detected_city?: string | null;
  detected_state?: string | null;
  detected_pool_size?: string | null;
  detected_interest?: string | null;
  detected_budget?: string | null;
  purchase_timing?: PurchaseTiming | null;
  customer_stage?: CustomerStage | null;
  lead_ready_to_close?: boolean;
  objections?: Objection[];
}

export function computeLeadScore(input: ScoreInput): number {
  let s = 0;
  if (input.detected_city) s += 10;
  if (input.detected_state) s += 5;
  if (input.detected_pool_size) s += 15;
  if (input.detected_interest) s += 10;
  if (input.detected_budget) s += 10;
  switch (input.purchase_timing) {
    case "imediato":
      s += 25;
      break;
    case "30d":
      s += 15;
      break;
    case "60d":
      s += 10;
      break;
    case "90d+":
      s += 5;
      break;
  }
  switch (input.customer_stage) {
    case "pronto_para_comprar":
      s += 25;
      break;
    case "pesquisando":
      s += 15;
      break;
    case "curioso":
      s += 5;
      break;
  }
  if (input.lead_ready_to_close) s += 30;
  s -= (input.objections?.length ?? 0) * 7;
  return Math.max(0, Math.min(100, s));
}

export function temperatureFromScore(score: number): Temperature {
  if (score >= 80) return "quente";
  if (score >= 50) return "morno";
  return "frio";
}

// Merge: union de objeções, mantendo a ordem original; cap 6
export function mergeObjections(prev: string[] | null | undefined, next: Objection[]): Objection[] {
  const set = new Set<Objection>();
  for (const o of prev ?? []) {
    if (
      o === "preco" ||
      o === "prazo" ||
      o === "concorrencia" ||
      o === "financiamento" ||
      o === "espaco" ||
      o === "confianca"
    ) {
      set.add(o);
    }
  }
  for (const o of next) set.add(o);
  return [...set].slice(0, 6);
}
