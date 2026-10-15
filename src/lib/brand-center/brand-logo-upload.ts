// Envio da logo principal da empresa para o cadastro de marca (Brand Center).
// Mesmo fluxo da tela Configurações → Identidade visual: URL assinada pelo
// servidor (que valida empresa e papel de admin), upload direto ao bucket e
// registro com revalidação server-side. O arquivo vai como está — a
// transparência de PNG/WebP é preservada.

import { supabase } from "@/integrations/supabase/client";
import { registerBrandAsset, signBrandAssetUpload } from "./brand-editor.functions";
import { ALLOWED_LOGO_MIMES, MAX_LOGO_BYTES } from "./brand-editor.types";

type LogoMime = (typeof ALLOWED_LOGO_MIMES)[number];

/** Mensagem pronta para o usuário quando o arquivo não serve; null se serve. */
export function validateLogoFile(file: { type: string; size: number }): string | null {
  if (!ALLOWED_LOGO_MIMES.includes(file.type as LogoMime)) return "Formato não suportado. Use PNG, JPG ou WebP.";
  if (file.size > MAX_LOGO_BYTES) return `O arquivo passa de ${(MAX_LOGO_BYTES / 1024 / 1024).toFixed(0)} MB.`;
  return null;
}

async function sha256(file: File): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function dimensions(file: File): Promise<{ width: number | null; height: number | null }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    const done = (width: number | null, height: number | null) => {
      URL.revokeObjectURL(url);
      resolve({ width, height });
    };
    img.onload = () => done(img.naturalWidth || null, img.naturalHeight || null);
    img.onerror = () => done(null, null);
    img.src = url;
  });
}

/** Traduz os códigos do servidor em texto para o usuário. */
export function brandLogoErrorMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (raw.includes("brand_editor_forbidden")) return "Só administradores da empresa podem alterar a logo.";
  if (raw.includes("brand_asset_too_large")) return "O arquivo é grande demais.";
  if (raw.includes("brand_asset_mime")) return "Formato não suportado. Use PNG, JPG ou WebP.";
  if (raw.includes("Unauthorized")) return "Sessão expirada. Entre novamente.";
  return "Não foi possível salvar a logo. Tente de novo.";
}

/** Envia e registra a logo principal. Lança com mensagem pronta para exibir. */
export async function uploadBrandLogo(file: File): Promise<{ assetId: string }> {
  const invalid = validateLogoFile(file);
  if (invalid) throw new Error(invalid);
  try {
    const mimeType = file.type as LogoMime;
    const sign = await signBrandAssetUpload({
      data: { assetType: "logo_primary", mimeType, sizeBytes: file.size, originalFilename: file.name },
    });
    const upload = await supabase.storage
      .from(sign.bucket)
      .uploadToSignedUrl(sign.storagePath, sign.token, file, { contentType: file.type, upsert: false });
    if (upload.error) throw new Error(upload.error.message);
    const [hash, dims] = await Promise.all([sha256(file), dimensions(file)]);
    const { assetId } = await registerBrandAsset({
      data: {
        assetType: "logo_primary",
        storagePath: sign.storagePath,
        mimeType,
        sizeBytes: file.size,
        width: dims.width,
        height: dims.height,
        sha256: hash,
        originalFilename: file.name,
      },
    });
    return { assetId };
  } catch (e) {
    throw new Error(brandLogoErrorMessage(e));
  }
}
