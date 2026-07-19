/**
 * Zod schemas para validação dos JSONB persistidos.
 * Todos os campos são opcionais: valores ausentes ou inválidos são
 * substituídos por defaults durante a normalização.
 */

import { z } from "zod";

// Cor em hexadecimal (#RGB, #RRGGBB ou #RRGGBBAA)
const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const hexColorSchema = z
  .string()
  .regex(HEX_COLOR, "invalid hex color");

export const colorsSchema = z
  .object({
    primary: hexColorSchema.optional(),
    secondary: hexColorSchema.optional(),
    accent: hexColorSchema.optional(),
    background: hexColorSchema.optional(),
    surface: hexColorSchema.optional(),
    text: hexColorSchema.optional(),
    textInverse: hexColorSchema.optional(),
  })
  .partial()
  .passthrough();

export const typographySchema = z
  .object({
    body: z.string().min(1).max(80).optional(),
    heading: z.string().min(1).max(80).optional(),
    display: z.string().min(1).max(80).optional(),
    weights: z.array(z.number().int().min(100).max(900)).optional(),
    fallback: z.string().min(1).max(240).optional(),
  })
  .partial()
  .passthrough();

export const tokensSchema = z
  .object({
    radius: z.number().min(0).max(64).optional(),
    shadowIntensity: z.number().min(0).max(1).optional(),
    spacingBase: z.number().min(2).max(32).optional(),
    overlayOpacity: z.number().min(0).max(1).optional(),
    logoPosition: z
      .enum([
        "top-left",
        "top-right",
        "top-center",
        "bottom-left",
        "bottom-right",
        "bottom-center",
        "center",
      ])
      .optional(),
    logoSafeMargin: z.number().min(0).max(256).optional(),
    imageStyle: z
      .enum(["photographic", "illustrated", "minimal", "mixed"])
      .optional(),
    gradientStyle: z.enum(["none", "subtle", "vibrant"]).optional(),
  })
  .partial()
  .passthrough();

export function parseColors(raw: unknown) {
  const r = colorsSchema.safeParse(raw);
  return r.success ? r.data : {};
}

export function parseTypography(raw: unknown) {
  const r = typographySchema.safeParse(raw);
  return r.success ? r.data : {};
}

export function parseTokens(raw: unknown) {
  const r = tokensSchema.safeParse(raw);
  return r.success ? r.data : {};
}
