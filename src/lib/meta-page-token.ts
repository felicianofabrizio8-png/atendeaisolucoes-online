// Helpers para sanitizar e validar page_access_token da Meta antes de gravar
// em meta_pages. Evita persistir tokens concatenados (bug histórico) ou
// fallback de user token onde a coluna espera um page token.

const GRAPH = "https://graph.facebook.com/v25.0";

export interface PageTokenCheck {
  ok: boolean;
  token: string | null;
  reason?: string;
  pageId?: string;
  pageName?: string;
}

/**
 * Remove whitespace e detecta concatenação dupla (token salvo duas vezes
 * no mesmo campo). Quando detecta, retorna apenas a primeira metade —
 * que historicamente é o token válido. Não chama rede.
 */
export function sanitizePageAccessToken(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = String(raw).replace(/\s+/g, "");
  if (!t.startsWith("EAA")) return null;

  // Procura segunda ocorrência de "EAA" — sinal clássico de concatenação.
  const secondEaa = t.indexOf("EAA", 3);
  if (secondEaa > 0) {
    const first = t.slice(0, secondEaa);
    const second = t.slice(secondEaa);
    // Se as duas metades têm tamanhos próximos (±2), é dupla concatenação:
    // ficamos com a primeira metade.
    if (Math.abs(first.length - second.length) <= 2 && first.length >= 100) {
      return first;
    }
    // Caso suspeito mas não simétrico: trata como inválido por segurança.
    return null;
  }
  return t;
}

/**
 * Valida um page_access_token contra Graph /me. Retorna o token sanitizado
 * + id da página associada se o token estiver OK.
 */
export async function validatePageAccessToken(
  raw: string | null | undefined,
  expectedPageId?: string | null,
): Promise<PageTokenCheck> {
  const token = sanitizePageAccessToken(raw);
  if (!token) {
    return { ok: false, token: null, reason: "invalid_format_or_concatenated" };
  }
  try {
    const r = await fetch(`${GRAPH}/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
    const body = (await r.json()) as { id?: string; name?: string; error?: { message?: string } };
    if (!r.ok || !body.id) {
      return {
        ok: false,
        token: null,
        reason: body.error?.message ?? `graph_me_${r.status}`,
      };
    }
    if (expectedPageId && body.id !== expectedPageId) {
      return {
        ok: false,
        token: null,
        reason: `token_belongs_to_${body.id}_not_${expectedPageId}`,
        pageId: body.id,
        pageName: body.name,
      };
    }
    return { ok: true, token, pageId: body.id, pageName: body.name };
  } catch (e) {
    return {
      ok: false,
      token: null,
      reason: `network_error:${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

export interface UserTokenCheck {
  ok: boolean;
  reason?: string;
  type?: string;
  scopes?: string[];
  isValid?: boolean;
  appId?: string;
  userId?: string;
}

const REQUIRED_USER_SCOPES = ["ads_management", "ads_read", "business_management"];

/**
 * Valida que um token é USER (ou SYSTEM_USER) long-lived com escopos
 * obrigatórios para Marketing API. Usa /debug_token assinado com
 * APP_ID|APP_SECRET. Deve ser chamada ANTES de gravar em
 * integrations.access_token para impedir que um PAGE token seja persistido lá.
 */
export async function validateUserAccessToken(
  token: string | null | undefined,
  appId: string,
  appSecret: string,
): Promise<UserTokenCheck> {
  if (!token || !appId || !appSecret) {
    return { ok: false, reason: "missing_token_or_app_credentials" };
  }
  try {
    const appToken = `${appId}|${appSecret}`;
    const r = await fetch(
      `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(appToken)}`,
    );
    const body = (await r.json()) as {
      data?: {
        type?: string;
        is_valid?: boolean;
        scopes?: string[];
        app_id?: string;
        user_id?: string;
      };
      error?: { message?: string };
    };
    const d = body?.data;
    if (!r.ok || !d) {
      return { ok: false, reason: body?.error?.message ?? `debug_token_${r.status}` };
    }
    const type = d.type ?? "";
    const scopes = Array.isArray(d.scopes) ? d.scopes : [];
    const base = {
      type,
      scopes,
      isValid: d.is_valid ?? false,
      appId: d.app_id,
      userId: d.user_id,
    };
    if (!d.is_valid) return { ok: false, reason: "token_invalid", ...base };
    if (type !== "USER" && type !== "SYSTEM_USER") {
      return { ok: false, reason: `token_type_is_${type || "unknown"}`, ...base };
    }
    const missing = REQUIRED_USER_SCOPES.filter((s) => !scopes.includes(s));
    if (missing.length > 0) {
      return { ok: false, reason: `missing_scopes:${missing.join(",")}`, ...base };
    }
    return { ok: true, ...base };
  } catch (e) {
    return {
      ok: false,
      reason: `network_error:${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
