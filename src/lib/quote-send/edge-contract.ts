// Espelho puro e testável de trechos-chave do contrato da Edge Function
// `meta-send` (branch WhatsApp). A Edge Function roda em Deno e não pode
// importar deste módulo, portanto a paridade é mantida por convenção +
// testes cruzados. Ao alterar aqui, alterar `supabase/functions/meta-send/index.ts`
// e vice-versa.
//
// Cobre:
// - Resolução de CORS por lista de padrões permitidos.
// - Mapeamento de erro Meta -> code de domínio.
// - Sanitização de logs (nunca vazar token, telefone completo, URL assinada).

export const ALLOWED_ORIGIN_PATTERNS: readonly RegExp[] = [
  /^https:\/\/([a-z0-9-]+\.)*lovable\.app$/i,
  /^https:\/\/([a-z0-9-]+\.)*lovableproject\.com$/i,
  /^https:\/\/([a-z0-9-]+\.)*atendeaisolucoes\.online$/i,
  /^http:\/\/localhost(:\d+)?$/i,
];

export interface CorsHeaders {
  "Access-Control-Allow-Origin": string;
  "Vary": string;
  "Access-Control-Allow-Headers": string;
  "Access-Control-Allow-Methods": string;
}

export function resolveCors(origin: string | null | undefined): CorsHeaders & { allowed: boolean } {
  const o = origin ?? "";
  const allowed = !!o && ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(o));
  return {
    "Access-Control-Allow-Origin": allowed ? o : "null",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    allowed,
  };
}

export type MetaMappedCode =
  | "outside_24h_window"
  | "graph_rate_limited"
  | "graph_api_rejected";

/**
 * Mapeia códigos numéricos da Meta Graph API para códigos de domínio.
 * - 131047 => outside_24h_window (fora da janela de 24h)
 * - 4 / 80007 => graph_rate_limited (rate limit da App/BSP)
 * - qualquer outro => graph_api_rejected
 */
export function mapMetaErrorCode(metaCode: number | null | undefined): MetaMappedCode {
  if (metaCode === 131047) return "outside_24h_window";
  if (metaCode === 4 || metaCode === 80007) return "graph_rate_limited";
  return "graph_api_rejected";
}

export interface EdgeErrorResponse {
  ok: false;
  code: string;
  error: string;
  requestId: string;
  attemptId: string | null;
  status?: number;
  metaCode?: number | null;
  outside24hWindow?: boolean;
}

export interface EdgeSuccessResponse {
  ok: true;
  messageId: string | null;
  conversationId: string;
  requestId: string;
  attemptId: string | null;
}

export function buildEdgeErrorBody(args: {
  code: string;
  message: string;
  requestId: string;
  attemptId: string | null;
  status?: number;
  metaCode?: number | null;
}): EdgeErrorResponse {
  return {
    ok: false,
    code: args.code,
    error: args.message,
    requestId: args.requestId,
    attemptId: args.attemptId,
    ...(args.status !== undefined ? { status: args.status } : {}),
    ...(args.metaCode !== undefined ? { metaCode: args.metaCode } : {}),
    ...(args.metaCode === 131047 ? { outside24hWindow: true } : {}),
  };
}

const SENSITIVE_PATTERNS: Array<{ re: RegExp; replace: string }> = [
  // Bearer tokens
  { re: /Bearer\s+[A-Za-z0-9._-]+/g, replace: "Bearer ***" },
  // Supabase signed URL tokens (?token=...)
  { re: /([?&]token=)[A-Za-z0-9._-]+/g, replace: "$1***" },
  // Signed storage URLs — colapsa qualquer /object/sign/.../file?...
  { re: /\/object\/sign\/[^\s"']+/g, replace: "/object/sign/***" },
  // Long digit sequences (>=8) => keep only last 4 as mask
  { re: /\b(\d{4,})(\d{4})\b/g, replace: "****$2" },
];

/** Devolve string sanitizada — nunca deve conter token, telefone completo ou URL assinada. */
export function sanitizeForLog(input: string): string {
  let out = input;
  for (const { re, replace } of SENSITIVE_PATTERNS) {
    out = out.replace(re, replace);
  }
  return out;
}
