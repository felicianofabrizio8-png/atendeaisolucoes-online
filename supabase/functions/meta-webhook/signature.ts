// Módulo PURO de parsing de App Secrets e verificação de assinatura da Meta.
//
// Por que é um módulo separado e puro (sem `Deno.env`, sem I/O):
//  - é a lógica que decide se um webhook é aceito ou rejeitado — precisa de
//    cobertura de teste real, e o runtime de teste do projeto é Vitest/Node;
//  - mantendo-o livre de globais do Deno, o MESMO arquivo é deployado na Edge
//    Function e importado pelos testes, eliminando o risco de a lógica testada
//    divergir da lógica implantada.
//
// Regra de ouro de observabilidade: NADA aqui retorna material secreto.
// Retornamos comprimentos, rótulos e prefixos de hash esperados — nunca o
// segredo, nunca a assinatura recebida completa, nunca o corpo da requisição.

/** Um App Secret da Meta é sempre exatamente 32 caracteres hexadecimais. */
export const META_APP_SECRET_LENGTH = 32;
const HEX_32 = /[a-fA-F0-9]{32}/;
const HEX_32_EXACT = /^[a-fA-F0-9]{32}$/;

export type SecretSource =
  | "META_APP_SECRET"
  | "META_INSTAGRAM_APP_SECRET"
  | "META_APP_SECRETS"
  | "META_APP_SECRETS_JSON";

export type SecretCandidate = {
  appId: string | null;
  label: string;
  secret: string;
  source: SecretSource;
};

/** Token que NÃO produziu um App Secret válido. Descrito sem expor o valor. */
export type MalformedToken = {
  source: SecretSource;
  index: number;
  /** Comprimento do token bruto — ajuda a diagnosticar sem vazar conteúdo. */
  rawLength: number;
  reason: "empty" | "no_32_hex_secret";
};

export type SecretParseResult = {
  candidates: SecretCandidate[];
  malformed: MalformedToken[];
};

export type MetaWebhookEnv = {
  META_APP_SECRET?: string;
  META_APP_ID?: string;
  META_INSTAGRAM_APP_SECRET?: string;
  META_INSTAGRAM_APP_ID?: string;
  META_APP_SECRETS?: string;
};

function stripQuotes(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

/**
 * Extrai um App Secret válido de um token livre.
 *
 * Aceita as formas que operadores realmente usam:
 *   "<secret>"                        → secret puro
 *   "<appId>:<secret>" / "<appId>=<secret>"
 *   "<rótulo>:<secret>" / "rótulo <secret>"
 *
 * Diferente da versão anterior, NUNCA cai no fallback de "usar o token inteiro
 * como se fosse um segredo". Um token sem 32 hex não é um App Secret — tratá-lo
 * como candidato só gerava ruído no diagnóstico e mascarava erros de digitação
 * no valor de META_APP_SECRETS.
 */
export function parseSecretToken(
  raw: string,
  index: number,
  source: SecretSource = "META_APP_SECRETS",
): { candidate: SecretCandidate | null; malformed: MalformedToken | null } {
  const token = stripQuotes(raw ?? "");
  if (!token) {
    return { candidate: null, malformed: null }; // separadores vazios são normais
  }

  const hexMatch = token.match(HEX_32);
  if (!hexMatch) {
    return {
      candidate: null,
      malformed: { source, index, rawLength: token.length, reason: "no_32_hex_secret" },
    };
  }

  const secret = hexMatch[0].toLowerCase();
  const before = token
    .slice(0, token.indexOf(hexMatch[0]))
    .replace(/[\s:=,-]+$/g, "")
    .trim();

  // O app_id da Meta é numérico e tem 6+ dígitos. Só consideramos dígitos que
  // apareçam ANTES do segredo, para não capturar dígitos de dentro do hex.
  const appId = before.match(/\b\d{6,}\b/)?.[0] ?? null;
  const label = before || `${source}[${index}]`;

  return { candidate: { appId, label, secret, source }, malformed: null };
}

function pushJsonEntry(
  out: SecretParseResult,
  item: unknown,
  index: number,
): void {
  if (typeof item === "string") {
    const { candidate, malformed } = parseSecretToken(item, index, "META_APP_SECRETS_JSON");
    if (candidate) out.candidates.push(candidate);
    if (malformed) out.malformed.push(malformed);
    return;
  }

  const record = (item ?? {}) as Record<string, unknown>;
  const rawSecret = String(record.secret ?? record.app_secret ?? "").trim();
  const appIdRaw = record.app_id ?? record.appId;
  const appId = appIdRaw === undefined || appIdRaw === null ? null : String(appIdRaw);

  if (!rawSecret) {
    out.malformed.push({
      source: "META_APP_SECRETS_JSON",
      index,
      rawLength: 0,
      reason: "empty",
    });
    return;
  }

  const hex = rawSecret.match(HEX_32)?.[0];
  if (!hex) {
    out.malformed.push({
      source: "META_APP_SECRETS_JSON",
      index,
      rawLength: rawSecret.length,
      reason: "no_32_hex_secret",
    });
    return;
  }

  out.candidates.push({
    appId,
    label: String(record.name ?? record.label ?? appId ?? `META_APP_SECRETS_JSON[${index}]`),
    secret: hex.toLowerCase(),
    source: "META_APP_SECRETS_JSON",
  });
}

/**
 * Monta a lista ordenada de App Secrets a testar contra a assinatura.
 *
 * Ordem (prioridade) — deliberada e coberta por teste:
 *   1. META_APP_SECRET           (app principal: Facebook / Messenger / Page)
 *   2. META_INSTAGRAM_APP_SECRET (app dedicado do Instagram Login)
 *   3. META_APP_SECRETS          (lista extra: rotação e apps adicionais)
 *
 * A ordem importa apenas para desempenho e para qual candidato aparece primeiro
 * no diagnóstico: a verificação testa TODOS os candidatos antes de rejeitar,
 * então um app novo em META_APP_SECRETS nunca é ofuscado pelos anteriores.
 */
export function buildSecretCandidates(env: MetaWebhookEnv): SecretParseResult {
  const out: SecretParseResult = { candidates: [], malformed: [] };

  const primary = (env.META_APP_SECRET ?? "").trim();
  if (primary) {
    const { candidate, malformed } = parseSecretToken(primary, 0, "META_APP_SECRET");
    if (candidate) {
      const appId = (env.META_APP_ID ?? "").trim() || candidate.appId;
      out.candidates.push({
        ...candidate,
        appId,
        label: appId ? `META_APP_SECRET:${appId}` : "META_APP_SECRET",
      });
    }
    if (malformed) out.malformed.push(malformed);
  }

  const instagram = (env.META_INSTAGRAM_APP_SECRET ?? "").trim();
  if (instagram) {
    const { candidate, malformed } = parseSecretToken(instagram, 0, "META_INSTAGRAM_APP_SECRET");
    if (candidate) {
      const appId = (env.META_INSTAGRAM_APP_ID ?? "").trim() || candidate.appId;
      out.candidates.push({
        ...candidate,
        appId,
        label: appId ? `META_INSTAGRAM_APP_SECRET:${appId}` : "META_INSTAGRAM_APP_SECRET",
      });
    }
    if (malformed) out.malformed.push(malformed);
  }

  const extra = (env.META_APP_SECRETS ?? "").trim();
  if (extra.startsWith("{") || extra.startsWith("[")) {
    try {
      const parsed = JSON.parse(extra);
      if (Array.isArray(parsed)) {
        parsed.forEach((item, index) => pushJsonEntry(out, item, index));
      } else if (parsed && typeof parsed === "object") {
        Object.entries(parsed as Record<string, unknown>).forEach(([appId, secret], index) => {
          if (typeof secret !== "string" || !secret.trim()) return;
          const hex = secret.match(HEX_32)?.[0];
          if (!hex) {
            out.malformed.push({
              source: "META_APP_SECRETS_JSON",
              index,
              rawLength: secret.trim().length,
              reason: "no_32_hex_secret",
            });
            return;
          }
          out.candidates.push({
            appId,
            label: appId,
            secret: hex.toLowerCase(),
            source: "META_APP_SECRETS_JSON",
          });
        });
      }
    } catch {
      // JSON inválido: registramos como malformado sem ecoar o conteúdo.
      out.malformed.push({
        source: "META_APP_SECRETS_JSON",
        index: 0,
        rawLength: extra.length,
        reason: "no_32_hex_secret",
      });
    }
  } else if (extra) {
    extra.split(/[\n,;]/).forEach((token, index) => {
      const { candidate, malformed } = parseSecretToken(token, index, "META_APP_SECRETS");
      if (candidate) out.candidates.push(candidate);
      if (malformed) out.malformed.push(malformed);
    });
  }

  // Deduplica pelo segredo: o mesmo app pode estar em META_APP_SECRET e também
  // na lista extra durante uma rotação. Mantemos a primeira ocorrência.
  const seen = new Set<string>();
  out.candidates = out.candidates.filter((c) => {
    if (seen.has(c.secret)) return false;
    seen.add(c.secret);
    return true;
  });

  return out;
}

/** Descrição de um candidato segura para log — sem o segredo. */
export type CandidateDiagnostic = {
  appId: string | null;
  label: string;
  source: SecretSource;
  secretLen: number;
  expectedPrefix: string;
};

export type SignatureResult = {
  ok: boolean;
  secretsTried: number;
  matched: { appId: string | null; label: string; source: SecretSource } | null;
  candidates: CandidateDiagnostic[];
  malformed: MalformedToken[];
  /** Motivo legível da rejeição — alimenta o log de observabilidade. */
  reason:
    | "ok"
    | "missing_signature_header"
    | "malformed_signature_header"
    | "no_secrets_configured"
    | "no_matching_secret";
};

export async function hmacHex(secret: string, bodyBytes: Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  // `bodyBytes` pode ser uma view sobre um buffer maior; normalizamos para um
  // ArrayBuffer exato para não assinar bytes extras.
  const sig = await crypto.subtle.sign("HMAC", key, bodyBytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verifica o header `X-Hub-Signature-256` contra TODOS os App Secrets
 * configurados. Suporta múltiplos apps (Facebook + Instagram + rotação) sem
 * exigir que se saiba de antemão qual app assinou — a Meta não envia o app_id
 * no payload do webhook.
 */
export async function verifyMetaSignature(
  rawBodyBytes: Uint8Array,
  signatureHeader: string | null,
  parsed: SecretParseResult,
): Promise<SignatureResult> {
  const { candidates, malformed } = parsed;
  const base = { secretsTried: candidates.length, matched: null, candidates: [], malformed };

  if (!signatureHeader) {
    return { ...base, ok: false, reason: "missing_signature_header" };
  }
  if (!signatureHeader.startsWith("sha256=")) {
    return { ...base, ok: false, reason: "malformed_signature_header" };
  }
  if (candidates.length === 0) {
    return { ...base, ok: false, reason: "no_secrets_configured" };
  }

  const provided = signatureHeader.slice("sha256=".length).toLowerCase();
  const diagnostics: CandidateDiagnostic[] = [];

  for (const c of candidates) {
    const expected = await hmacHex(c.secret, rawBodyBytes);
    diagnostics.push({
      appId: c.appId,
      label: c.label,
      source: c.source,
      secretLen: c.secret.length,
      expectedPrefix: expected.slice(0, 12),
    });
    if (constantTimeEqualHex(provided, expected)) {
      return {
        ok: true,
        secretsTried: candidates.length,
        matched: { appId: c.appId, label: c.label, source: c.source },
        candidates: diagnostics,
        malformed,
        reason: "ok",
      };
    }
  }

  return {
    ok: false,
    secretsTried: candidates.length,
    matched: null,
    candidates: diagnostics,
    malformed,
    reason: "no_matching_secret",
  };
}
