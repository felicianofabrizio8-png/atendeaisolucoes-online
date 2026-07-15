// MetaOutbound — ÚNICA porta de saída autorizada para escrever na Meta Graph API.
//
// Regra arquitetural (a ser enforçada por lint em fase futura):
//   `fetch("https://graph.facebook.com...")` só é permitido neste arquivo.
//
// Todo chamador passa por `postGraph()`, que:
//   1) invoca o EnvironmentGuard.assertOutbound()
//   2) se `proceed=false`, devolve OutboundSimulated (nunca faz fetch)
//   3) se `proceed=true`, executa fetch idêntico ao caminho legado
//
// Comportamento em `legacy` (kill switch OFF) e em `production` é bit-a-bit
// igual ao atual — mesmos headers, mesmo body, mesma URL. Nada muda p/ Solário.

import { assertOutbound, type GuardDeps } from "@/lib/environment/EnvironmentGuard.server";
import type { OutboundAction } from "@/lib/environment/types";
import type { OutboundResult } from "./MetaOutboundContract";

export interface PostGraphInput {
  /** Empresa dona da ação (obrigatório para o guard). */
  companyId: string;
  /** Nome semântico da ação (ex.: "whatsapp.send.text", "meta.campaign.publish"). */
  action: string;
  /** URL completa Graph API. */
  url: string;
  /** Método HTTP. Default POST. */
  method?: "GET" | "POST" | "DELETE" | "PUT" | "PATCH";
  /** Headers HTTP (Authorization etc.). */
  headers?: Record<string, string>;
  /**
   * Corpo da requisição. Aceita qualquer BodyInit compatível com o fetch nativo
   * (string JSON, string form-urlencoded, FormData p/ multipart, Blob, etc.).
   * Passado ao fetch bit-a-bit; NUNCA re-serializado. Para logs/simulação,
   * use `logicalPayload` (o body físico não é lido em simulação).
   */
  body?: BodyInit | undefined;
  /** Payload lógico p/ log (será sanitizado). Se ausente, usa body. */
  logicalPayload?: unknown;
  /** Usuário responsável (auth). */
  userId?: string | null;
  /** Agente responsável (ex.: "ai-agent", "followup-tick"). */
  agentId?: string | null;
  /** Extrai externalId do JSON de resposta (opcional). */
  extractExternalId?: (json: unknown) => string | null;
  /** Injeção p/ testes. */
  guardDeps?: GuardDeps;
  /** fetch injetável p/ testes. */
  fetchImpl?: typeof fetch;
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Ponto único de saída para Graph API. */
export async function postGraph<TRaw = unknown>(
  input: PostGraphInput,
): Promise<OutboundResult<TRaw>> {
  const method = input.method ?? "POST";
  const action: OutboundAction = {
    companyId: input.companyId,
    userId: input.userId ?? null,
    agentId: input.agentId ?? null,
    action: input.action,
    targetUrl: input.url,
    method,
    payload: input.logicalPayload ?? tryParseBody(typeof input.body === "string" ? input.body : undefined),
  };

  const decision = await assertOutbound(action, input.guardDeps);

  if (!decision.proceed) {
    return {
      success: true,
      simulated: true,
      environment: decision.environment,
      externalRequestSent: false,
      simulationId: decision.simulationId,
      would: { url: input.url, method },
    };
  }

  // proceed=true → mesmo caminho de sempre.
  const doFetch = input.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(input.url, {
      method,
      headers: input.headers,
      body: input.body,
    });
  } catch (e) {
    return {
      success: false,
      simulated: false,
      environment: decision.environment === "legacy" ? "legacy" : "production",
      externalRequestSent: false,
      error: e instanceof Error ? e.message : "network_error",
      retryable: true,
    };
  }

  const text = await res.text();
  let parsed: unknown = null;
  let parsedOk = false;
  if (text) {
    try {
      parsed = JSON.parse(text);
      parsedOk = true;
    } catch {
      parsed = null;
      parsedOk = false;
    }
  }

  if (!res.ok) {
    const providerErr = parsedOk
      ? (parsed as { error?: { message?: string } } | null)?.error
      : undefined;
    return {
      success: false,
      simulated: false,
      environment: decision.environment === "legacy" ? "legacy" : "production",
      externalRequestSent: true,
      error: providerErr?.message ?? `HTTP ${res.status}`,
      status: res.status,
      retryable: isRetryable(res.status),
      providerError: providerErr ?? (parsedOk ? parsed : text),
      rawBody: text,
      parsedBody: parsedOk ? parsed : null,
    };
  }

  const successJson: unknown = parsedOk ? parsed : text || null;
  const externalId = input.extractExternalId ? input.extractExternalId(successJson) : null;
  return {
    success: true,
    simulated: false,
    environment: decision.environment === "legacy" ? "legacy" : "production",
    externalRequestSent: true,
    externalId,
    status: res.status,
    raw: successJson as TRaw,
  };
}

function tryParseBody(body: string | undefined): unknown {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    // form-urlencoded → devolve como string; sanitizer trata.
    return { raw: body };
  }
}
