// Pure helpers for validating OAuth granted_scopes before listing Facebook
// Pages. Extracted so the client flow in configuracoes.tsx can enforce the
// minimum permission set required by intent="facebook_page" (publisher).

export const FB_PAGE_REQUIRED_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_posts",
] as const;

export type OauthIntent = "default" | "facebook_page";

export interface ScopeCheckResult {
  ok: boolean;
  missing: string[];
}

export function evaluateFacebookPageReadiness(
  grantedScopes: readonly string[] | null | undefined,
  intent: OauthIntent | string,
): ScopeCheckResult {
  if (intent !== "facebook_page") return { ok: true, missing: [] };
  const scopes = Array.isArray(grantedScopes) ? grantedScopes : [];
  if (scopes.length === 0) {
    // Sem dados de debug_token: não bloqueia — o fluxo segue e /me/accounts
    // decide. Bloqueio só ocorre quando temos evidência de scopes faltando.
    return { ok: true, missing: [] };
  }
  const missing = FB_PAGE_REQUIRED_SCOPES.filter((s) => !scopes.includes(s));
  return { ok: missing.length === 0, missing };
}

export function formatMissingScopesMessage(missing: readonly string[]): string {
  return (
    `Permissões faltando na Configuration do Facebook Login: ${missing.join(", ")}. ` +
    `Ajuste a Login Configuration no Meta Developers para incluir essas permissões e clique novamente em "Conectar publicação do Facebook".`
  );
}
