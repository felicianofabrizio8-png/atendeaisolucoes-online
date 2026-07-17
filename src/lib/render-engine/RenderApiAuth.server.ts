// ============================================================================
// Render Worker API — auth + helpers reutilizáveis por todas as rotas públicas
// /api/public/render/*. Autenticação por header x-render-worker-secret com
// comparação timing-safe. Nenhum log expõe o valor do header.
// ============================================================================

import { timingSafeEqual } from "node:crypto";

const HEADER_NAME = "x-render-worker-secret";
const MAX_BODY_BYTES = 32 * 1024; // 32 KB — payloads são JSON pequeno

export const RENDER_HEADER_NAME = HEADER_NAME;

export function unauthorizedResponse(): Response {
  return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
}
export function badRequest(reason: string): Response {
  return Response.json({ ok: false, error: "bad_request", reason }, { status: 400 });
}
export function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
    status: 405,
    headers: { "content-type": "application/json", allow: "POST" },
  });
}
export function tooLarge(): Response {
  return Response.json({ ok: false, error: "payload_too_large" }, { status: 413 });
}
export function internalError(): Response {
  return Response.json({ ok: false, error: "internal_error" }, { status: 500 });
}

export function safeEqualSecret(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Autentica a requisição do Render Worker. Retorna null em sucesso,
 * ou uma Response de erro pronta para retornar.
 */
export function authenticateRenderWorker(request: Request): Response | null {
  const expected = process.env.RENDER_WORKER_SECRET;
  if (!expected || expected.length < 24) {
    // Sem secret configurado — comporta como "não autorizado", sem revelar.
    return unauthorizedResponse();
  }
  const provided = request.headers.get(HEADER_NAME) ?? "";
  if (!safeEqualSecret(provided, expected)) return unauthorizedResponse();
  return null;
}

/** Lê o body JSON com limite de tamanho. Retorna { data } ou { error: Response }. */
export async function readJsonBody<T = unknown>(
  request: Request,
): Promise<{ data: T } | { error: Response }> {
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    return { error: badRequest("expected_application_json") };
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { error: badRequest("body_read_failed") };
  }
  if (text.length > MAX_BODY_BYTES) return { error: tooLarge() };
  if (!text.trim()) return { error: badRequest("empty_body") };
  try {
    return { data: JSON.parse(text) as T };
  } catch {
    return { error: badRequest("invalid_json") };
  }
}

export function correlationId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Deriva de forma determinística o path do vídeo produzido por um job. */
export function deriveOutputVideoPath(companyId: string, videoId: string): string {
  return `${companyId}/${videoId}/video.mp4`;
}
