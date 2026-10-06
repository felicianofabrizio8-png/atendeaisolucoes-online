import { createHash, randomUUID } from "node:crypto";

import { EXTERNAL_SALES_AGENT_MAX_MS, EXTERNAL_SALES_AGENT_MIN_MS } from "./agent-turn-budget";
import { normalizeProductFacts, renderFactValue, UNIVERSAL_FACT_KEYS } from "./catalog-facts";
import type { AgentContextBase, AgentDecision } from "./sales-agent-core";
import { collapseImageRuns, sanitizeSellerState, type SellerState } from "./sales-agent-seller-state";
import { isConversationAutoReply, resolveSalesAgentMode, SALES_AGENT_MODES, type SalesAgentMode, type SalesAgentModeSettings } from "./sales-agent-mode";
import { MAX_SALES_AGENT_PRODUCT_IMAGES } from "./sales-agent-product-images";

const DEFAULT_TIMEOUT_MS = EXTERNAL_SALES_AGENT_MAX_MS;
const MAX_RESPONSE_CHARS = 4_000;
const MAX_NEXT_ACTION_CHARS = 160;
const MAX_PRODUCTS = 5;
// A Vendedora pede o envio das fotos cadastradas dos produtos que selecionou.
const SEND_PRODUCT_MEDIA_ACTION = "send_product_media";
// Folga para a ida e a volta da rede (Workers → Railway): a standalone recebe só o
// que sobra do nosso timeout e decide se ainda cabe a correção de evidências.
const NETWORK_MARGIN_MS = 1_000;
// Limite de corpo do http_api da Vendedora standalone (max_body_bytes); acima disso ela responde 400.
const MAX_REQUEST_BYTES = 1_000_000;

export type ExternalSalesAgentResult =
  | { enabled: false; reason: "disabled" | "mode_not_enabled" | "not_configured"; correlationId: string }
  | { enabled: true; ok: true; decision: AgentDecision; correlationId: string; timing?: ExternalSalesAgentTiming;
      /** Texto de tudo o que a empresa cadastrou e foi enviado à Vendedora neste turno (catálogo + fatos da empresa). */
      evidenceText: string;
      /** Estado comercial devolvido pela Vendedora, para ser reenviado no próximo turno. */
      sellerState: SellerState | null }
  | { enabled: true; ok: false; reason: "config_invalid" | "invalid_request" | "budget_exhausted" | "timeout" | "network_error" | "http_error" | "invalid_response"; correlationId: string; timing?: ExternalSalesAgentTiming; httpStatus?: number; invalidResponseCode?: "invalid_json" | "invalid_shape" | "invalid_decision" };

/** Só números: o timeout efetivo dado à Vendedora e quanto a chamada levou. */
export type ExternalSalesAgentTiming = { budgetMs: number; durationMs: number };

type ExternalSalesAgentInput = {
  companyId: string;
  conversationId?: string | null;
  history: Array<{ role: "lead" | "agent" | "system"; text: string; productIds?: string[]; notice?: string }>;
  leadName: string | null;
  context: AgentContextBase;
  interpretation?: unknown;
  commercialState?: unknown;
  /** Estado comercial que a Vendedora devolveu no turno anterior desta conversa. */
  sellerState?: unknown;
  nextCatalogQuery?: unknown;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  /** Regras ativas da empresa (mesma fonte e status que o agente interno já usa). */
  coachRules?: Array<{ title: string; content: string }>;
  /** Aprendizados aprovados da empresa (mesma fonte e status que o agente interno já usa). */
  learnings?: Array<{ title: string; rule: string; description: string }>;
  /** Respostas rápidas ativas da empresa; chamado só quando a Vendedora vai ser acionada. */
  loadQuickReplies?: () => Promise<Array<{ name: string; content: string }>>;
  /** Tempo que resta ao turno para a Vendedora (do prazo do tick); undefined = só a config. */
  budgetMs?: number;
  onResult?: (result: ExternalSalesAgentResult) => void | Promise<void>;
};

type ExternalSalesAgentResponse = {
  evidence?: unknown;
  response?: unknown;
  handoff?: unknown;
  commercial_state?: unknown;
  selected_products?: unknown;
  next_action?: unknown;
};

async function notify(input: ExternalSalesAgentInput, result: ExternalSalesAgentResult): Promise<void> {
  try { await input.onResult?.(result); } catch { /* auditoria não altera o fallback */ }
}

function configuredCompanyIds(env: Record<string, string | undefined>): Set<string> {
  return new Set((env.EXTERNAL_SALES_AGENT_COMPANY_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean));
}

/** A empresa está na lista das que usam a Vendedora externa (EXTERNAL_SALES_AGENT_COMPANY_IDS)? */
export function isExternalSalesAgentEligible(
  companyId: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return configuredCompanyIds(env).has(companyId);
}

// Modos do tenant em que a Vendedora externa atua. Padrão: `silent` (só avalia) e
// `assisted` (a resposta vira sugestão para o atendente aprovar). `automatic` — ela
// mesma responde o cliente — exige opt-in explícito em EXTERNAL_SALES_AGENT_MODES.
const DEFAULT_EXTERNAL_MODES: readonly SalesAgentMode[] = ["silent", "assisted"];

function enabledModes(env: Record<string, string | undefined>): Set<SalesAgentMode> {
  const raw = env.EXTERNAL_SALES_AGENT_MODES?.trim();
  if (!raw) return new Set(DEFAULT_EXTERNAL_MODES);
  return new Set(
    raw.split(",").map((value) => value.trim()).filter((value): value is SalesAgentMode => SALES_AGENT_MODES.includes(value as SalesAgentMode)),
  );
}

// O automático ligado pelo atendente numa conversa é uma escolha explícita dele dentro de
// uma empresa em `assisted`: vale quando `assisted` está habilitado. O automático da empresa
// inteira continua exigindo o opt-in em EXTERNAL_SALES_AGENT_MODES.
function modeEnabled(env: Record<string, string | undefined>, settings: SalesAgentModeSettings): boolean {
  const mode = resolveSalesAgentMode(settings);
  if (mode === null) return false;
  const enabled = enabledModes(env);
  return enabled.has(mode) || (isConversationAutoReply(settings) && enabled.has("assisted"));
}

/**
 * A Vendedora externa atende este tenant neste modo? (allowlist, modo e configuração válida.)
 * Quando atende, é ela quem decide o turno com os dados cadastrados da empresa: o tick não
 * faz a triagem por palavra-chave antes de chamá-la.
 */
export function isExternalSalesAgentActive(
  settings: { company_id: string } & SalesAgentModeSettings,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!configuredCompanyIds(env).has(settings.company_id)) return false;
  return modeEnabled(env, settings) && getConfig(env) !== null;
}

function getConfig(env: Record<string, string | undefined>) {
  const endpoint = env.EXTERNAL_SALES_AGENT_ENDPOINT?.trim();
  const apiKey = env.EXTERNAL_SALES_AGENT_API_KEY?.trim();
  const timeoutValue = Number(env.EXTERNAL_SALES_AGENT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  let localTestEndpoint = false;
  try {
    const url = new URL(endpoint ?? "");
    localTestEndpoint = env.EXTERNAL_SALES_AGENT_ALLOW_LOCAL_HTTP_FOR_TESTS === "true"
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localTestEndpoint) return null;
  } catch {
    return null;
  }
  const maxTimeoutMs = localTestEndpoint ? 60_000 : EXTERNAL_SALES_AGENT_MAX_MS;
  if (!endpoint || !apiKey || !Number.isFinite(timeoutValue) || timeoutValue < 250 || timeoutValue > maxTimeoutMs) return null;
  return { endpoint, apiKey, timeoutMs: Math.floor(timeoutValue) };
}

function turnBudgetMs(timeoutMs: number): number {
  return Math.max(Math.floor(timeoutMs / 2), timeoutMs - NETWORK_MARGIN_MS);
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value.trim();
  return result ? result.slice(0, max) : null;
}

function cleanProductIds(value: unknown, allowed: Set<string>): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const ids = [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())))];
  // Produto fora do catálogo autorizado invalida a decisão. Produtos demais não: a
  // Vendedora pode apresentar várias opções num turno, e recusar a resposta inteira
  // por isso (invalid_decision) jogava o turno no fallback. Ficam os primeiros.
  if (ids.some((id) => !allowed.has(id))) return null;
  return ids;
}

function cleanCommercialState(value: unknown): Record<string, string | null> | null {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const allowed = ["detected_city", "detected_state", "detected_intent", "detected_interest", "detected_budget", "purchase_timing", "customer_stage"] as const;
  const output: Record<string, string | null> = {};
  for (const key of allowed) {
    if (source[key] === undefined) continue;
    const cleaned = cleanString(source[key], 160);
    if (source[key] !== null && cleaned === null) return null;
    output[key] = cleaned;
  }
  return output;
}

type StandaloneCatalogItem = { id: string; name: string; description: string; price: number; currency: "BRL"; category: string; features: string[]; available: true; source: "catalog"; has_media: boolean };

// Campos que a standalone já recebe em colunas próprias; os demais fatos de Produtos
// (modelo, SKU, preço promocional, medidas, atributos da empresa, itens inclusos,
// variantes, observações) vão em `features`, no mesmo "Rótulo: valor" do agente interno.
const STANDALONE_OWN_FACT_KEYS = new Set<string>([UNIVERSAL_FACT_KEYS.name, UNIVERSAL_FACT_KEYS.category, UNIVERSAL_FACT_KEYS.price, UNIVERSAL_FACT_KEYS.description]);

function standaloneFeatures(product: AgentContextBase["grounding"]["catalog"][number]): string[] {
  // Fatos normalizados (fonte oficial): atributo em conflito com campo não vira fato.
  return normalizeProductFacts(product).facts
    .filter((fact) => !STANDALONE_OWN_FACT_KEYS.has(fact.key))
    .map((fact) => `${fact.label}: ${renderFactValue(fact.value)}`);
}

// A standalone faz Product.from_dict: float(price) e str(campo). price null → 400;
// description/category null viram o fato literal "None". Só enviamos produtos com
// preço validado; os demais ficam fora do catálogo autorizado do turno.
function toStandaloneCatalog(catalog: AgentContextBase["grounding"]["catalog"]): StandaloneCatalogItem[] {
  const items: StandaloneCatalogItem[] = [];
  for (const product of catalog) {
    const id = typeof product.id === "string" && product.id.trim() ? product.id : "";
    const name = typeof product.name === "string" ? product.name.trim() : "";
    if (!id || !name || typeof product.price !== "number" || !Number.isFinite(product.price) || product.price < 0) continue;
    items.push({
      id,
      name,
      description: typeof product.description === "string" ? product.description : "",
      price: product.price,
      currency: "BRL",
      category: typeof product.category === "string" ? product.category : "",
      features: standaloneFeatures(product),
      available: true,
      source: "catalog",
      // Só diz se há foto cadastrada: a Vendedora só promete enviar fotos de quem tem.
      has_media: Array.isArray(product.images) && product.images.length > 0,
    });
  }
  return items;
}

type CompanyFact = { label: string; text: string };
const MAX_COMPANY_FACTS = 40;

// Tudo o que a empresa (company_id) cadastrou no sistema e a Vendedora pode afirmar:
// perfil da IA, FAQ, base de conhecimento aprovada, regras comerciais e respostas rápidas.
// Os rótulos são os nomes dos campos do sistema; o conteúdo é só o que a empresa preencheu.
function toCompanyFacts(
  context: AgentContextBase,
  quickReplies: Array<{ name: string; content: string }>,
  coachRules: Array<{ title: string; content: string }> = [],
  learnings: Array<{ title: string; rule: string; description: string }> = [],
): CompanyFact[] {
  const facts: CompanyFact[] = [];
  const add = (label: unknown, text: unknown) => {
    if (typeof label !== "string" || typeof text !== "string" || !label.trim() || !text.trim()) return;
    if (facts.length < MAX_COMPANY_FACTS) facts.push({ label: label.trim(), text: text.trim() });
  };
  const profile = context.aiProfile;
  add("Descrição da empresa", profile?.description);
  add("Produtos e serviços", profile?.products);
  add("Formas de pagamento", profile?.payment_methods);
  add("Prazo médio", profile?.avg_lead_time);
  add("Horário de atendimento", profile?.business_hours);
  add("Região atendida", profile?.region);
  add("Diferenciais", profile?.differentials);
  const rules = context.grounding.commercialRules;
  add("Termos comerciais", rules.commercialTerms);
  add("Política de pagamento", rules.paymentPolicy);
  add("Política de instalação", rules.installationPolicy);
  add("Previsão da próxima carga", rules.nextLoadForecast);
  add("Política de visita", rules.visitPolicy);
  add("Política de aquecimento", rules.heatingPolicy);
  add("Política de frete", rules.shippingPolicy);
  add("Política de itens inclusos", rules.includedItemsPolicy);
  // Só regras ativas e aprendizados aprovados (quem filtra o status é a fonte que já existe).
  for (const rule of coachRules) add(`Regra da empresa: ${rule.title}`, rule.content);
  for (const learning of learnings) add(`Aprendizado aprovado: ${learning.title}`, learning.rule || learning.description);
  for (const reply of quickReplies) add(reply.name, reply.content);
  for (const item of profile?.faq ?? []) add(item.q, item.a);
  for (const item of Array.isArray(context.knowledge) ? context.knowledge : []) add(item.question, item.answer);
  return facts;
}

const STANDALONE_ROLES = { lead: "user", agent: "assistant", system: "system" } as const;

// A standalone acrescenta `message` ao histórico por conta própria, então o turno
// atual sai do history; papéis seguem o vocabulário dela (user/assistant).
function toStandaloneHistory(history: ExternalSalesAgentInput["history"], currentIndex: number) {
  // O aviso automático de encaminhamento não entra: lido como fala dela, fazia a Vendedora
  // entender que a conversa "estava com a equipe" e encaminhar de novo a cada mensagem.
  const previous = history.filter((item, index) => index !== currentIndex && typeof item.text === "string" && item.role in STANDALONE_ROLES && item.notice !== "handoff");
  return collapseImageRuns(previous)
    .slice(-40)
    .map((item) => {
      const productIds = Array.isArray(item.productIds) ? item.productIds.filter((id): id is string => typeof id === "string") : [];
      return { role: STANDALONE_ROLES[item.role], text: item.text, ...(productIds.length ? { productIds } : {}) };
    });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// `external_silent` só no modo silent: aí o tick registra a resposta e encerra. Nos demais
// modos a decisão segue o fluxo normal (safety layer, aprovação do assistido ou envio).
// Rótulos de cadastro que a Vendedora diz ter usado: só valem os que nós mesmos enviamos.
function cleanEvidenceLabels(value: unknown, sentLabels: Set<string>): string[] {
  const raw = isPlainObject(value) ? value.company_facts : null;
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((item): item is string => typeof item === "string" && sentLabels.has(item)))].slice(0, 10);
}

function normalizeDecision(body: ExternalSalesAgentResponse, allowedProductIds: Set<string>, silent: boolean, sentLabels: Set<string> = new Set()): AgentDecision | null {
  const state = cleanCommercialState(body.commercial_state);
  const selected = cleanProductIds(body.selected_products, allowedProductIds);
  if (!state || !selected) return null;
  const products = selected.slice(0, MAX_PRODUCTS);
  const handoff = body.handoff;
  const handoffRequested = typeof handoff === "boolean"
    ? handoff
    : Boolean(handoff && typeof handoff === "object" && !Array.isArray(handoff) && (handoff as Record<string, unknown>).required === true);
  const handoffReason = typeof handoff === "object" && handoff !== null && !Array.isArray(handoff)
    ? cleanString((handoff as Record<string, unknown>).reason, 200)
    : null;
  const message = cleanString(body.response, MAX_RESPONSE_CHARS);
  const nextAction = cleanString(body.next_action, MAX_NEXT_ACTION_CHARS);
  const marker = silent ? { external_silent: true } : {};
  if (handoffRequested) return { kind: "handoff", reason: handoffReason ?? "external_sales_agent_handoff", suggested_products: products, next_action: nextAction, ...marker, ...state };
  if (!message) return null;
  // Mesmo mecanismo do agente interno: com product_image_ids o tick envia as fotos
  // cadastradas logo depois do texto (só quando o modo permite enviar ao cliente).
  const images = nextAction === SEND_PRODUCT_MEDIA_ACTION ? selected.slice(0, MAX_SALES_AGENT_PRODUCT_IMAGES) : [];
  const labels = cleanEvidenceLabels(body.evidence, sentLabels);
  return { kind: "reply", message, suggested_products: products, ...(images.length ? { product_image_ids: images } : {}), ...(labels.length ? { evidence_labels: labels } : {}), next_action: nextAction, ...marker, ...state };
}

export async function callExternalSalesAgent(input: ExternalSalesAgentInput): Promise<ExternalSalesAgentResult> {
  const env = input.env ?? process.env;
  const correlationId = randomUUID();
  if (!configuredCompanyIds(env).has(input.companyId)) {
    const result = { enabled: false as const, reason: "disabled" as const, correlationId };
    await notify(input, result);
    return result;
  }
  const mode = resolveSalesAgentMode(input.context.settings);
  if (mode === null || !modeEnabled(env, input.context.settings)) {
    const result = { enabled: false as const, reason: "mode_not_enabled" as const, correlationId };
    await notify(input, result);
    return result;
  }
  const config = getConfig(env);
  if (!config) {
    const result = { enabled: true as const, ok: false as const, reason: "config_invalid" as const, correlationId };
    await notify(input, result);
    return result;
  }
  // O prazo do turno manda: a config é só o teto.
  const timeoutMs = input.budgetMs === undefined ? config.timeoutMs : Math.min(config.timeoutMs, Math.floor(input.budgetMs));
  if (input.budgetMs !== undefined && timeoutMs < EXTERNAL_SALES_AGENT_MIN_MS) {
    const result = { enabled: true as const, ok: false as const, reason: "budget_exhausted" as const, correlationId, timing: { budgetMs: Math.max(0, timeoutMs), durationMs: 0 } };
    await notify(input, result);
    return result;
  }
  const catalog = toStandaloneCatalog(input.context.grounding.catalog);
  const allowedProducts = new Set(catalog.map((product) => product.id));
  let currentIndex = input.history.length - 1;
  while (currentIndex >= 0 && !(input.history[currentIndex].role === "lead" && typeof input.history[currentIndex].text === "string" && input.history[currentIndex].text.trim())) currentIndex -= 1;
  const message = currentIndex >= 0 ? input.history[currentIndex].text.trim() : "";
  const leadName = typeof input.leadName === "string" && input.leadName.trim() ? input.leadName.trim() : null;
  let quickReplies: Array<{ name: string; content: string }> = [];
  try { quickReplies = (await input.loadQuickReplies?.()) ?? []; } catch { /* sem respostas rápidas o turno segue */ }
  const companyFacts = toCompanyFacts(input.context, quickReplies, input.coachRules, input.learnings);
  const evidenceText = [
    ...catalog.flatMap((product) => [product.name, product.description, product.category, String(product.price), ...product.features]),
    ...companyFacts.flatMap((fact) => [fact.label, fact.text]),
  ].filter(Boolean).join("\n");
  const payload = {
    company_id: input.companyId,
    message,
    history: toStandaloneHistory(input.history, currentIndex),
    lead_name: leadName,
    catalog,
    // O estado da própria Vendedora (turno anterior) é o que dá continuidade à venda.
    commercial_state: sanitizeSellerState(input.sellerState) ?? (isPlainObject(input.commercialState) ? input.commercialState : {}),
    next_catalog_query: typeof input.nextCatalogQuery === "string" ? input.nextCatalogQuery : null,
    authorized_context: {
      company_name: input.context.companyName,
      // Contrato genérico lido pela Vendedora: tom e fatos cadastrados pela empresa.
      tone: input.context.aiProfile?.tone ?? null,
      company_facts: companyFacts,
      ai_profile: input.context.aiProfile,
      knowledge: input.context.knowledge,
      commercial_rules: input.context.grounding.commercialRules,
      interpretation: input.interpretation ?? null,
    },
  };
  const body = JSON.stringify(payload);
  // Pedidos que a standalone recusaria com 400 nem saem: fallback local direto.
  if (!message || new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
    const result = { enabled: true as const, ok: false as const, reason: "invalid_request" as const, correlationId };
    await notify(input, result);
    return result;
  }
  const turnFingerprint = createHash("sha256").update(JSON.stringify({ companyId: input.companyId, conversationId: input.conversationId ?? null, history: input.history })).digest("hex").slice(0, 32);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  const finish = async (result: Extract<ExternalSalesAgentResult, { enabled: true }>) => {
    const timed = { ...result, timing: { budgetMs: timeoutMs, durationMs: Date.now() - startedAt } };
    await notify(input, timed);
    return timed;
  };
  try {
    const response = await (input.fetchImpl ?? fetch)(config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
        "Idempotency-Key": `atende-ai:${input.companyId}:${input.conversationId ?? "no-conversation"}:${turnFingerprint}`,
        "X-Request-Timeout-Ms": String(turnBudgetMs(timeoutMs)),
      },
      body,
      signal: controller.signal,
    });
    // Only record protocol metadata; the upstream body may contain customer data or secrets.
    if (!response.ok) return await finish({ enabled: true, ok: false, reason: "http_error", correlationId, httpStatus: response.status });
    let responseBody: unknown;
    try { responseBody = await response.json(); } catch { return await finish({ enabled: true, ok: false, reason: "invalid_response", correlationId, invalidResponseCode: "invalid_json" }); }
    if (!isPlainObject(responseBody)) return await finish({ enabled: true, ok: false, reason: "invalid_response", correlationId, invalidResponseCode: "invalid_shape" });
    const decision = normalizeDecision(responseBody as ExternalSalesAgentResponse, allowedProducts, mode === "silent", new Set(companyFacts.map((fact) => fact.label)));
    return await finish(decision ? { enabled: true, ok: true, decision, correlationId, evidenceText, sellerState: sanitizeSellerState((responseBody as ExternalSalesAgentResponse).commercial_state) } : { enabled: true, ok: false, reason: "invalid_response", correlationId, invalidResponseCode: "invalid_decision" });
  } catch (error) {
    return await finish({ enabled: true, ok: false, reason: error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error", correlationId });
  } finally {
    clearTimeout(timeout);
  }
}
