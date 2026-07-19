/**
 * Migração e normalização de payloads versionados do Brand Center.
 *
 * O contrato JSONB `colors/typography/tokens` é persistido junto de um
 * `schema_version` inteiro. Consumidores devem usar `migrateBrandVersionPayload`
 * antes de interpretar os dados — mesmo quando o schema atual for o único
 * conhecido — para manter o ponto de evolução único e testável.
 *
 * Regras:
 *  - schema_version ausente ou nulo → assumimos 1 (legado / pré-2.1).
 *  - schema_version conhecido → pass-through (dados já parseados por Zod).
 *  - schema_version futuro/desconhecido → função retorna `null` e o resolver
 *    cai em fallback COMPLETO em vez de aplicar heurística silenciosa.
 */

export const CURRENT_BRAND_SCHEMA_VERSION = 1 as const;

export interface BrandVersionPayloadRaw {
  schemaVersion: number | null | undefined;
  colors: unknown;
  typography: unknown;
  tokens: unknown;
}

export interface BrandVersionPayloadNormalized {
  schemaVersion: number;
  colors: unknown;
  typography: unknown;
  tokens: unknown;
}

/**
 * Retorna `null` quando o schema é desconhecido/futuro — nesse caso o resolver
 * deve tratar como "sem versão publicada" e cair para defaults, jamais aplicar
 * dados incompatíveis silenciosamente.
 */
export function migrateBrandVersionPayload(
  raw: BrandVersionPayloadRaw,
): BrandVersionPayloadNormalized | null {
  const declared = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 1;

  if (declared > CURRENT_BRAND_SCHEMA_VERSION) return null;
  if (declared < 1) return null;

  // Schema 1: pass-through — a validação real acontece nos schemas Zod
  // (`parseColors/parseTypography/parseTokens`) chamados pelo resolver.
  if (declared === 1) {
    return {
      schemaVersion: 1,
      colors: raw.colors,
      typography: raw.typography,
      tokens: raw.tokens,
    };
  }

  return null;
}
