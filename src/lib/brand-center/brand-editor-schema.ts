/**
 * Zod schemas para o editor administrativo do Brand Center.
 *
 * Regras centrais:
 *  - `company_id` NUNCA vem do cliente — é derivado da sessão no server.
 *  - Signed URLs jamais são aceitas ou persistidas.
 *  - MIME e extensão do asset ficam presos à allowlist definida em `.types`.
 *  - `storagePath` deve iniciar com `{company_id}/brand/{asset_type}/`.
 */

import { z } from "zod";
import {
  ALLOWED_FONTS,
  ALLOWED_LOGO_MIMES,
  EDITOR_ASSET_TYPES,
  MAX_LOGO_BYTES,
  MIME_TO_EXT,
} from "./brand-editor.types";

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const hexColor = z.string().regex(HEX_COLOR, "Cor inválida");

// Editor exige TODAS as cores/tipografia/tokens preenchidos
// (o schema JSONB base é permissivo por design para permitir evolução).
const StrictColors = z.object({
  primary: hexColor,
  secondary: hexColor,
  accent: hexColor,
  background: hexColor,
  surface: hexColor,
  text: hexColor,
  textInverse: hexColor,
});

const StrictTokens = z.object({
  radius: z.number().min(0).max(64),
  shadowIntensity: z.number().min(0).max(1),
  spacingBase: z.number().min(2).max(32),
  overlayOpacity: z.number().min(0).max(1),
  logoPosition: z.enum([
    "top-left","top-right","top-center",
    "bottom-left","bottom-right","bottom-center","center",
  ]),
  logoSafeMargin: z.number().min(0).max(256),
  imageStyle: z.enum(["photographic","illustrated","minimal","mixed"]),
  gradientStyle: z.enum(["none","subtle","vibrant"]),
});

const NAME = z
  .string()
  .trim()
  .min(1, "Nome obrigatório")
  .max(120, "Nome muito longo");

const DESCRIPTION = z
  .string()
  .trim()
  .max(500, "Descrição muito longa")
  .nullable()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const VISUAL_STYLE = z
  .string()
  .trim()
  .max(60, "Estilo muito longo")
  .nullable()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const AllowedFontSchema = z.enum(ALLOWED_FONTS);
const StrictTypography = z.object({
  body: AllowedFontSchema,
  heading: AllowedFontSchema,
  display: AllowedFontSchema,
  weights: z.array(z.number().int().min(100).max(900)).min(1),
  fallback: z.string().min(1).max(240),
});

/**
 * Payload de save de draft — nunca contém company_id, version_id ou signed URLs.
 * O server localiza a empresa via sessão e a versão de rascunho existente.
 */
export const BrandDraftPayloadSchema = z
  .object({
    name: NAME,
    description: DESCRIPTION,
    visualStyle: VISUAL_STYLE,
    colors: StrictColors,
    typography: StrictTypography,
    tokens: StrictTokens,
  })
  .strict();



const FILENAME = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine((v) => !/[\\/]/.test(v), "Nome de arquivo inválido");

const NO_SIGNED_URL_MARKERS = [
  "signedurl",
  "signed_url",
  "token=",
  "x-goog",
  "x-amz",
  "expires=",
  "?",
];

function assertNoSignedUrl(value: string, ctx: z.RefinementCtx, field: string) {
  const lowered = value.toLowerCase();
  for (const m of NO_SIGNED_URL_MARKERS) {
    if (lowered.includes(m)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} não pode conter signed URL`,
      });
      return;
    }
  }
}

const StoragePathSchema = z
  .string()
  .trim()
  .min(10)
  .max(300)
  .superRefine((v, ctx) => {
    assertNoSignedUrl(v, ctx, "storagePath");
    if (v.startsWith("/") || v.includes("..") || v.includes("//")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "storagePath inválido",
      });
    }
  });

/** Solicitação de upload — o server valida ownership + gera URL temporária. */
export const SignBrandAssetUploadSchema = z
  .object({
    assetType: z.enum(EDITOR_ASSET_TYPES),
    mimeType: z.enum(ALLOWED_LOGO_MIMES),
    sizeBytes: z
      .number()
      .int("Tamanho inválido")
      .positive("Tamanho inválido")
      .max(MAX_LOGO_BYTES, "Arquivo excede o tamanho máximo"),
    originalFilename: FILENAME,
  })
  .strict();

/**
 * Registro do asset após upload direto ao storage.
 * O server valida que `storagePath` começa com `{company_id}/brand/{assetType}/`
 * e que MIME/extensão são coerentes com a allowlist.
 */
export const RegisterBrandAssetSchema = z
  .object({
    assetType: z.enum(EDITOR_ASSET_TYPES),
    storagePath: StoragePathSchema,
    mimeType: z.enum(ALLOWED_LOGO_MIMES),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(MAX_LOGO_BYTES, "Arquivo excede o tamanho máximo"),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i, "sha256 inválido")
      .nullable(),
    originalFilename: FILENAME,
  })
  .strict()
  .superRefine((v, ctx) => {
    const expectedExt = MIME_TO_EXT[v.mimeType];
    const suffix = v.storagePath.split(".").pop()?.toLowerCase();
    // aceita jpg/jpeg indistintamente
    const okExt =
      suffix === expectedExt ||
      (expectedExt === "jpg" && suffix === "jpeg");
    if (!okExt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Extensão do arquivo não corresponde ao MIME informado",
      });
    }
  });

export const PublishBrandVersionSchema = z
  .object({ versionId: z.string().uuid() })
  .strict();

export const DeactivateBrandAssetSchema = z
  .object({ assetId: z.string().uuid() })
  .strict();

/**
 * Valida que um storage_path pertence a uma empresa/tipo específicos.
 * Usado no server durante `registerBrandAsset` para bloquear cross-tenant.
 */
export function assertStoragePathOwnership(
  storagePath: string,
  companyId: string,
  assetType: string,
): { ok: true } | { ok: false; reason: string } {
  const requiredPrefix = `${companyId}/brand/${assetType}/`;
  if (!storagePath.startsWith(requiredPrefix)) {
    return { ok: false, reason: "storage_path_prefix_mismatch" };
  }
  return { ok: true };
}
