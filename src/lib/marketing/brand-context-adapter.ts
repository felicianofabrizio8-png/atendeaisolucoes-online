/**
 * Adapter Marketing IA ↔ Brand Center.
 *
 * Este módulo é a ÚNICA superfície pela qual o Marketing IA acessa a
 * identidade visual da empresa. Ele:
 *
 *   1. carrega o BrandContext publicado (fallback silencioso se não houver);
 *   2. obtém acesso temporário à logo principal (se existir);
 *   3. normaliza tudo num contrato interno `MarketingBrandContext` — sem
 *      expor tipos internos do Brand Center para o restante do Marketing IA.
 *
 * REGRAS
 *   - Signed URL vive apenas durante o request. Não pode ser persistida em
 *     campanha, draft, log ou snapshot de prompt.
 *   - Falha ao assinar a logo NÃO derruba a geração: cai em fallback
 *     "sem logo" e registra evento técnico sanitizado.
 *   - Nunca importar `brand.repository.ts`, `brand-editor.functions.ts`
 *     ou acessar tabelas `brand_*`/bucket `brand-assets` daqui.
 *   - `sanitizeBrandContextForPersistence` remove signed URLs antes de
 *     qualquer persistência (usado ao gravar snapshot do prompt).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  loadBrandContextForCompany,
  signPrimaryLogoAccess,
  type BrandAssetAccess,
} from "@/lib/brand-center/brand-consumer.server";
import type {
  BrandColors,
  BrandContext,
  BrandGradientStyle,
  BrandImageStyle,
  BrandLogoPosition,
  BrandTypography,
} from "@/lib/brand-center/brand.types";

type SB = SupabaseClient<Database>;

// ---------------------------------------------------------------------------
// Contrato interno consumido pelo Marketing IA
// ---------------------------------------------------------------------------

export interface MarketingBrandLogo {
  /** URL assinada (efêmera). NUNCA persistir. */
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  /** ISO-8601 de expiração da signed URL. */
  expiresAt: string;
}

export interface MarketingBrandTokens {
  logoPosition: BrandLogoPosition;
  logoSafeMargin: number;
  overlayOpacity: number;
  radius: number;
  gradientStyle: BrandGradientStyle;
  imageStyle: BrandImageStyle;
}

export interface MarketingBrandContext {
  isFallback: boolean;
  visualStyle: string | null;
  colors: BrandColors;
  typography: BrandTypography;
  tokens: MarketingBrandTokens;
  /** null = empresa não tem logo publicada OU falhou ao assinar. */
  logo: MarketingBrandLogo | null;
}

/**
 * Ponto único de integração. Chame no início da geração, use durante o
 * request e descarte ao final. Nunca serialize o objeto retornado para
 * banco/log sem passar por `sanitizeBrandContextForPersistence`.
 */
export async function loadMarketingBrandContext(
  supabase: SB,
  companyId: string,
): Promise<MarketingBrandContext> {
  const brand = await loadBrandContextForCompany(supabase, companyId);
  const logo = await tryLoadPrimaryLogo(supabase, brand);
  return adaptBrandContext(brand, logo);
}

/**
 * Adapta o BrandContext + logo em MarketingBrandContext. Extraído para
 * testes puros — não faz IO.
 */
export function adaptBrandContext(
  brand: BrandContext,
  logoAccess: BrandAssetAccess | null,
): MarketingBrandContext {
  const logo: MarketingBrandLogo | null = logoAccess
    ? {
        url: logoAccess.signedUrl,
        mimeType: logoAccess.mimeType,
        width: logoAccess.width,
        height: logoAccess.height,
        expiresAt: logoAccess.expiresAt,
      }
    : null;

  return {
    isFallback: brand.isFallback,
    visualStyle: brand.visualStyle,
    colors: brand.colors,
    typography: brand.typography,
    tokens: {
      logoPosition: brand.tokens.logoPosition,
      logoSafeMargin: brand.tokens.logoSafeMargin,
      overlayOpacity: brand.tokens.overlayOpacity,
      radius: brand.tokens.radius,
      gradientStyle: brand.tokens.gradientStyle,
      imageStyle: brand.tokens.imageStyle,
    },
    logo,
  };
}

/**
 * Snapshot seguro para persistência (drafts, snapshots de prompt, memória).
 * Estritamente remove signed URL e `expiresAt` — mantém apenas metadados
 * que podem trafegar em banco sem risco de exposição de acesso temporário.
 */
export function sanitizeBrandContextForPersistence(
  ctx: MarketingBrandContext,
): Omit<MarketingBrandContext, "logo"> & {
  logo: { mimeType: string; width: number | null; height: number | null } | null;
} {
  return {
    isFallback: ctx.isFallback,
    visualStyle: ctx.visualStyle,
    colors: ctx.colors,
    typography: ctx.typography,
    tokens: ctx.tokens,
    logo: ctx.logo
      ? {
          mimeType: ctx.logo.mimeType,
          width: ctx.logo.width,
          height: ctx.logo.height,
        }
      : null,
  };
}

/**
 * Bloco de texto injetado no system prompt do gerador de conteúdo.
 * Contém diretrizes de marca — nunca a signed URL. É seguro para persistir
 * junto do snapshot do prompt (é o mesmo texto passado ao modelo).
 */
export function buildBrandPromptBlock(ctx: MarketingBrandContext): string {
  if (ctx.isFallback && !ctx.logo) {
    return "# IDENTIDADE VISUAL\nEsta empresa ainda não publicou identidade visual — use recomendações neutras e não invente cores, fontes ou logo.";
  }
  const c = ctx.colors;
  const t = ctx.typography;
  const tk = ctx.tokens;
  const lines: string[] = [];
  lines.push("# IDENTIDADE VISUAL DA EMPRESA (obrigatório respeitar)");
  if (ctx.visualStyle) {
    lines.push(`Estilo visual: ${ctx.visualStyle}.`);
  }
  lines.push(
    `Cores oficiais — primária ${c.primary} · secundária ${c.secondary} · destaque ${c.accent} · texto ${c.text} · fundo ${c.background}. Não sugira paletas alternativas nem invente cores.`,
  );
  lines.push(
    `Tipografia — títulos "${t.heading}", corpo "${t.body}", display "${t.display}". Fallback "${t.fallback}". Não recomende trocar as fontes.`,
  );
  lines.push(
    `Tokens de aplicação — posição da logo: ${tk.logoPosition}; margem segura da logo: ${tk.logoSafeMargin}px; overlay: ${tk.overlayOpacity}; raio de borda: ${tk.radius}px; estilo de gradiente: ${tk.gradientStyle}; estilo de imagem: ${tk.imageStyle}.`,
  );
  if (ctx.logo) {
    lines.push(
      "Logo principal DISPONÍVEL — trate como asset fixo. NÃO descreva redesenho da logo. NÃO altere proporção, cores ou forma. NÃO aplique fundo branco automaticamente. Respeite a posição padrão e a margem segura.",
    );
  } else {
    lines.push(
      "Logo principal AUSENTE — não invente marca, não crie logo textual, não descreva logotipo. Gere sem logo.",
    );
  }
  lines.push(
    "REGRAS invioláveis: contraste legível, consistência entre formatos, sem redesenhar logo, sem alterar nome da empresa, sem cores fora da paleta oficial.",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Internos
// ---------------------------------------------------------------------------

async function tryLoadPrimaryLogo(
  supabase: SB,
  brand: BrandContext,
): Promise<BrandAssetAccess | null> {
  if (!brand.assets.byType.logo_primary) return null;
  try {
    return await signPrimaryLogoAccess(supabase, brand);
  } catch (err) {
    // Sanitização: só o CÓDIGO do erro; nunca a URL ou o message completo.
    const code = err instanceof Error ? err.message.split(":")[0] : "unknown";
    // eslint-disable-next-line no-console
    console.warn(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "warn",
        event: "marketing_brand_logo_sign_failed",
        company_id: brand.companyId,
        error_code: code,
      }),
    );
    return null;
  }
}
