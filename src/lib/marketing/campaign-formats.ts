// ============================================================================
// Campanha — resolução canônica de FORMATOS (Feed / Story / Feed+Story).
//
// Causa do pendente anterior: o modo manual gravava a escolha do usuário em
// `marketing_contents.ai_prompt.formats`, mas todas as etapas seguintes
// (criação das linhas, aprovação, render, publicação) assumiam sempre
// feed+story. Este módulo é o ÚNICO ponto de verdade da resolução.
//
// Regras:
//  - `formats` explícito no snapshot vence sempre.
//  - Campanha antiga (sem `formats`) → fallback legado = feed+story, e o
//    chamador registra `source: "legacy_fallback"` no log.
//  - Nunca inferir formatos pela existência de linhas antigas.
//
// Puro: sem IO, sem dependência de Supabase. Seguro para o cliente.
// ============================================================================

export type CampaignRole = "feed" | "story";
export type CampaignFormatSelection = "feed" | "story" | "feed_story";

export const CAMPAIGN_FORMAT_SELECTIONS: readonly CampaignFormatSelection[] = [
  "feed",
  "story",
  "feed_story",
] as const;

/** Comportamento histórico, aplicado a campanhas sem `formats` no snapshot. */
export const LEGACY_ROLES: readonly CampaignRole[] = ["feed", "story"] as const;

export interface ResolvedCampaignFormats {
  /** Roles efetivamente habilitadas, sempre na ordem feed → story. */
  roles: CampaignRole[];
  /** Valor canônico equivalente (útil para logs e persistência). */
  selection: CampaignFormatSelection;
  /** `explicit` = escolha do usuário; `legacy_fallback` = campanha antiga. */
  source: "explicit" | "legacy_fallback";
}

function rolesToSelection(roles: CampaignRole[]): CampaignFormatSelection {
  if (roles.length === 2) return "feed_story";
  return roles[0];
}

function normalizeRoles(input: unknown): CampaignRole[] | null {
  // Aceita "feed" | "story" | "feed_story" e também o array ["feed","story"].
  if (typeof input === "string") {
    if (input === "feed") return ["feed"];
    if (input === "story") return ["story"];
    if (input === "feed_story") return ["feed", "story"];
    return null;
  }
  if (Array.isArray(input)) {
    const set = new Set<CampaignRole>();
    for (const v of input) {
      if (v === "feed" || v === "story") set.add(v);
      else return null; // valor desconhecido → snapshot inválido
    }
    if (set.size === 0) return null;
    return (["feed", "story"] as CampaignRole[]).filter((r) => set.has(r));
  }
  return null;
}

/**
 * Lê `formats` de um snapshot `ai_prompt` (jsonb) e devolve as roles válidas.
 * Qualquer valor inválido/ausente cai no comportamento legado.
 */
export function resolveCampaignFormats(aiPrompt: unknown): ResolvedCampaignFormats {
  const raw =
    aiPrompt && typeof aiPrompt === "object"
      ? (aiPrompt as { formats?: unknown }).formats
      : undefined;
  const roles = normalizeRoles(raw);
  if (!roles) {
    return {
      roles: [...LEGACY_ROLES],
      selection: "feed_story",
      source: "legacy_fallback",
    };
  }
  return { roles, selection: rolesToSelection(roles), source: "explicit" };
}

export function isRoleEnabled(resolved: ResolvedCampaignFormats, role: CampaignRole): boolean {
  return resolved.roles.includes(role);
}

/** Converte o formato de `marketing_contents.format` para role de campanha. */
export function roleFromContentFormat(format: string | null | undefined): CampaignRole | null {
  if (format === "feed" || format === "reel") return "feed";
  if (format === "story") return "story";
  return null;
}

/** Log sanitizado (nunca contém texto do usuário nem PII). */
export function formatsTelemetry(
  event:
    | "campaign_formats_resolved"
    | "campaign_format_render_requested"
    | "campaign_format_render_skipped"
    | "campaign_format_publish_requested"
    | "campaign_format_publish_skipped",
  payload: {
    campaign_id?: string | null;
    company_id?: string | null;
    role?: CampaignRole | null;
    formats?: CampaignFormatSelection | null;
    source?: ResolvedCampaignFormats["source"] | null;
    reason?: string | null;
  },
): string {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level: "info",
    event,
    campaign_id: payload.campaign_id ?? null,
    company_id: payload.company_id ?? null,
    role: payload.role ?? null,
    formats: payload.formats ?? null,
    formats_source: payload.source ?? null,
    reason: payload.reason ?? null,
  });
}

/** Rótulos de UI — compartilhados por modo IA e modo manual. */
export const CAMPAIGN_FORMAT_LABELS: Record<CampaignFormatSelection, string> = {
  feed_story: "Feed + Story",
  feed: "Somente Feed",
  story: "Somente Story",
};

/** Valida uma seleção vinda do cliente. `null` quando desconhecida. */
export function parseFormatSelection(
  value: unknown,
): CampaignFormatSelection | null {
  return typeof value === "string" &&
    (CAMPAIGN_FORMAT_SELECTIONS as readonly string[]).includes(value)
    ? (value as CampaignFormatSelection)
    : null;
}

/** Roles de uma seleção canônica (sem passar por `ai_prompt`). */
export function rolesFromSelection(
  selection: CampaignFormatSelection,
): CampaignRole[] {
  return selection === "feed_story" ? ["feed", "story"] : [selection];
}
