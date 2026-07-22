// ============================================================================
// Coach Interpreter — Domain Validator (Hotfix pós-Grounding)
//
// Camada de validação semântica entre o Grounding e a persistência do output
// do LLM. Objetivo: nenhuma sugestão / pergunta / proposta pode contradizer
// o catálogo, a base de conhecimento ou as regras da empresa.
//
// Regras aplicadas (todas incrementais, sem alterar arquitetura/DB/APIs):
//   1) Regras negativas por domínio (ex.: piscinas de fibra têm dimensões
//      fixas de fábrica — nunca perguntar largura/profundidade/formato).
//   2) Regras negativas globais oriundas de `marketing_knowledge_base.forbidden_words`.
//   3) Perguntas guiadas por domínio: se todas as clarificações forem
//      bloqueadas, fornecemos uma pergunta segura derivada do catálogo real.
//   4) Detecção de produtos citados que não existem no catálogo (warning).
//
// A saída é PURA — não escreve em banco, não chama LLM. O service consome
// o resultado, filtra o `CoachInterpreterOutput` e anexa `domain_validation`
// aos metadados de auditoria da mensagem do assistente.
// ============================================================================
import type { CoachInterpreterOutput, CoachProposal } from "./schema";
import type { CoachGroundingRaw } from "./grounding.server";

export interface DomainValidationBlock {
  kind: "clarification_question" | "proposal";
  index: number;
  text: string;
  reason: string;
  matched?: string;
}

export interface DomainValidationResult {
  passed: boolean;
  filteredOutput: CoachInterpreterOutput;
  blockedRules: DomainValidationBlock[]; // perguntas/proposals descartadas
  warnings: string[];
  recommendedQuestions: string[]; // adicionadas quando tudo foi bloqueado
  domainsDetected: string[];
  regenerated: false; // reservado — nesta fase apenas filtramos
  metadata: {
    passed: boolean;
    blocked_rules: Array<{ kind: string; reason: string; matched?: string }>;
    regenerated: false;
    validation_reason: string;
    domains_detected: string[];
    recommended_questions_used: string[];
  };
}

// --- Registros determinísticos por domínio ----------------------------------

interface DomainPolicy {
  domain: string;
  bannedQuestionPatterns: RegExp[];
  bannedReason: string;
  recommendedQuestions: string[];
}

const DOMAIN_POLICIES: DomainPolicy[] = [
  {
    domain: "piscinas",
    // Piscinas de fibra têm dimensões fixas de fábrica: perguntar por
    // largura/profundidade/formato personalizado é semanticamente inválido.
    bannedQuestionPatterns: [
      /\b(prefere|qual|voc[êe] (quer|prefere))\b[^?]*\b(largura|profundidade|altura)\b/i,
      /\bqual (a )?(largura|profundidade|altura)\b/i,
      /\bqual formato\b[^?]*\b(prefere|deseja|quer)\b/i,
      /\b(medida|dimens[ãa]o) (personalizada|customizada|sob medida|sob encomenda)\b/i,
      /\bdeseja (uma )?piscina (retangular|redonda|oval|quadrada) (de|com)\b/i,
      /\b(qual|prefere) (o )?(comprimento|tamanho) (exato|personalizado|customizado)\b/i,
    ],
    bannedReason:
      "piscinas de fibra têm dimensões fixas de fábrica — o cliente escolhe entre modelos existentes, não configura medidas",
    recommendedQuestions: [
      "Qual o espaço disponível no local para instalação (em metros aproximados)?",
      "Prefere um modelo com prainha/degraus ou o tradicional retangular?",
      "Tem interesse em aquecimento, iluminação ou hidromassagem?",
      "Já tem uma ideia de prazo para instalação?",
    ],
  },
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function questionMentionsMissingProduct(question: string, products: CoachGroundingRaw["products"]): string | null {
  if (products.length === 0) return null;
  // heurística leve — captura substantivo capitalizado seguido de "de", número ou "m"
  const m = question.match(/\b(?:modelo|produto|piscina|kit|linha)\s+([A-ZÁ-Ú][\wÁ-Úá-ú0-9 -]{2,40})/);
  if (!m) return null;
  const cited = normalize(m[1] ?? "");
  const inCatalog = products.some((p) => normalize(p.name).includes(cited) || cited.includes(normalize(p.name)));
  return inCatalog ? null : m[1] ?? null;
}

function isForbiddenByKb(question: string, forbiddenWords: string[]): string | null {
  const q = normalize(question);
  for (const w of forbiddenWords) {
    const nw = normalize(w);
    if (nw.length >= 3 && q.includes(nw)) return w;
  }
  return null;
}

function detectDomains(raw: CoachGroundingRaw): string[] {
  const detected = new Set<string>(raw.detectedDomains);
  return Array.from(detected);
}

function pickRecommendedQuestions(
  domains: string[],
  needed: number,
): string[] {
  if (needed <= 0) return [];
  const pool: string[] = [];
  for (const d of domains) {
    const pol = DOMAIN_POLICIES.find((p) => p.domain === d);
    if (pol) pool.push(...pol.recommendedQuestions);
  }
  return pool.slice(0, Math.min(needed, 3));
}

/**
 * Executa a validação semântica sobre um output já válido segundo o schema.
 * Retorna um `filteredOutput` seguro para persistência.
 */
export function validateAgainstDomain(
  output: CoachInterpreterOutput,
  raw: CoachGroundingRaw,
): DomainValidationResult {
  const domains = detectDomains(raw);
  const activePolicies = DOMAIN_POLICIES.filter((p) => domains.includes(p.domain));
  const blocked: DomainValidationBlock[] = [];
  const warnings: string[] = [];

  // 1) Filtra clarification_questions -------------------------------------
  const keptQuestions: string[] = [];
  output.clarification_questions.forEach((q, idx) => {
    // regras por domínio
    for (const pol of activePolicies) {
      for (const rx of pol.bannedQuestionPatterns) {
        const match = q.match(rx);
        if (match) {
          blocked.push({
            kind: "clarification_question",
            index: idx,
            text: q,
            reason: `domain:${pol.domain}:${pol.bannedReason}`,
            matched: match[0].slice(0, 80),
          });
          return;
        }
      }
    }
    // regras globais da KB
    const kbHit = isForbiddenByKb(q, raw.forbiddenWords);
    if (kbHit) {
      blocked.push({
        kind: "clarification_question",
        index: idx,
        text: q,
        reason: "kb:forbidden_word",
        matched: kbHit,
      });
      return;
    }
    // produto citado fora do catálogo — warning, mas mantém pergunta
    const missing = questionMentionsMissingProduct(q, raw.products);
    if (missing) {
      warnings.push(`domain_question_cites_unknown_product:${missing}`);
    }
    keptQuestions.push(q);
  });

  // 2) Filtra proposals que instruem perguntar algo proibido ---------------
  const keptProposals: CoachProposal[] = [];
  output.proposals.forEach((p, idx) => {
    if (p.rule_type === "mandatory_question") {
      for (const pol of activePolicies) {
        for (const rx of pol.bannedQuestionPatterns) {
          const match = `${p.title} ${p.instruction} ${p.condition ?? ""}`.match(rx);
          if (match) {
            blocked.push({
              kind: "proposal",
              index: idx,
              text: p.title,
              reason: `domain:${pol.domain}:${pol.bannedReason}`,
              matched: match[0].slice(0, 80),
            });
            return;
          }
        }
      }
    }
    keptProposals.push(p);
  });

  // 3) Perguntas recomendadas quando tudo foi bloqueado --------------------
  let recommended: string[] = [];
  if (
    output.clarification_questions.length > 0 &&
    keptQuestions.length === 0 &&
    activePolicies.length > 0
  ) {
    recommended = pickRecommendedQuestions(domains, 3);
    for (const r of recommended) keptQuestions.push(r);
  }

  const passed = blocked.length === 0;

  const validation_reason = passed
    ? "domain_validation_ok"
    : `domain_validation_filtered:${blocked.length}_blocked${recommended.length > 0 ? `,${recommended.length}_recommended` : ""}`;

  const filteredOutput: CoachInterpreterOutput = {
    ...output,
    clarification_questions: keptQuestions,
    proposals: keptProposals,
    warnings: Array.from(
      new Set([
        ...output.warnings,
        ...warnings,
        ...(passed ? [] : ["domain_validation_applied"]),
        ...(recommended.length > 0 ? ["domain_recommended_question_added"] : []),
      ]),
    ).slice(0, 5),
  };

  return {
    passed,
    filteredOutput,
    blockedRules: blocked,
    warnings,
    recommendedQuestions: recommended,
    domainsDetected: domains,
    regenerated: false,
    metadata: {
      passed,
      blocked_rules: blocked.map((b) => ({
        kind: b.kind,
        reason: b.reason,
        matched: b.matched,
      })),
      regenerated: false,
      validation_reason,
      domains_detected: domains,
      recommended_questions_used: recommended,
    },
  };
}
