// Perfil personalizável: foto, banner, recado e telefone.
// As imagens são reduzidas no navegador (canvas → WebP) antes do envio, para
// subir rápido pelo celular, e vão para o bucket público "profile-media" na
// pasta do próprio usuário. O banco guarda a URL pública com ?v= para furar cache.

import { supabase } from "@/integrations/supabase/client";

const BUCKET = "profile-media";

export interface BannerPreset {
  id: string;
  label: string;
  css: string;
}

/** Banners prontos (gradientes), usados quando não há imagem. */
export const BANNER_PRESETS: BannerPreset[] = [
  {
    id: "lume",
    label: "Lume",
    css: "radial-gradient(120% 140% at 0% 0%, #a78bfa 0%, transparent 55%), radial-gradient(120% 140% at 100% 100%, #4f46e5 0%, transparent 60%), #1e1b4b",
  },
  {
    id: "aurora",
    label: "Aurora",
    css: "radial-gradient(90% 120% at 20% 10%, #34d399 0%, transparent 55%), radial-gradient(90% 120% at 85% 80%, #22d3ee 0%, transparent 60%), #064e3b",
  },
  {
    id: "por-do-sol",
    label: "Pôr do sol",
    css: "linear-gradient(135deg, #f97316 0%, #ec4899 55%, #7c3aed 100%)",
  },
  {
    id: "oceano",
    label: "Oceano",
    css: "linear-gradient(160deg, #0ea5e9 0%, #1d4ed8 60%, #0f172a 100%)",
  },
  {
    id: "brasa",
    label: "Brasa",
    css: "radial-gradient(110% 130% at 80% 0%, #fbbf24 0%, transparent 50%), linear-gradient(135deg, #b91c1c, #450a0a)",
  },
  {
    id: "grafite",
    label: "Grafite",
    css: "radial-gradient(100% 120% at 100% 0%, #52525b 0%, transparent 60%), linear-gradient(160deg, #27272a, #09090b)",
  },
  {
    id: "rosa",
    label: "Rosé",
    css: "linear-gradient(135deg, #fda4af 0%, #f472b6 50%, #a855f7 100%)",
  },
  {
    id: "menta",
    label: "Menta",
    css: "linear-gradient(135deg, #a7f3d0 0%, #5eead4 45%, #0d9488 100%)",
  },
];

export const DEFAULT_BANNER = BANNER_PRESETS[0];

export function bannerCss(preset: string | null | undefined): string {
  return (BANNER_PRESETS.find((p) => p.id === preset) ?? DEFAULT_BANNER).css;
}

export const BIO_MAX = 140;

export function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U"
  );
}

type Kind = "avatar" | "banner";

/** Tamanho final de cada tipo: foto quadrada e banner largo (3:1). */
const TARGET: Record<Kind, { w: number; h: number }> = {
  avatar: { w: 640, h: 640 },
  banner: { w: 1500, h: 500 },
};

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Não foi possível ler essa imagem."));
    };
    img.src = url;
  });
}

/**
 * Recorta pelo centro na proporção do tipo e reduz ao tamanho final.
 * `focusY` (0–1) escolhe a faixa vertical do recorte (banner arrastável).
 */
export async function prepareImage(file: File, kind: Kind, focusY = 0.5): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");
  const img = await loadImage(file);
  const { w, h } = TARGET[kind];
  const ratio = w / h;
  let sw = img.naturalWidth;
  let sh = sw / ratio;
  if (sh > img.naturalHeight) {
    sh = img.naturalHeight;
    sw = sh * ratio;
  }
  const sx = (img.naturalWidth - sw) / 2;
  const sy = (img.naturalHeight - sh) * Math.min(1, Math.max(0, focusY));
  const scale = Math.min(1, w / sw);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Seu navegador não conseguiu processar a imagem.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.88),
  );
  if (!blob) throw new Error("Não foi possível preparar a imagem.");
  return blob;
}

/** Envia a imagem já preparada e devolve a URL pública (com versão). */
export async function uploadProfileImage(userId: string, kind: Kind, blob: Blob): Promise<string> {
  const path = `${userId}/${kind}.webp`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { upsert: true, contentType: "image/webp", cacheControl: "3600" });
  if (error) throw new Error(friendlyStorageError(error.message));
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}

export async function removeProfileImage(userId: string, kind: Kind): Promise<void> {
  await supabase.storage.from(BUCKET).remove([`${userId}/${kind}.webp`]);
}

export interface ProfilePatch {
  display_name?: string | null;
  avatar_url?: string | null;
  banner_url?: string | null;
  banner_preset?: string | null;
  bio?: string | null;
  phone?: string | null;
}

export async function updateProfile(userId: string, patch: ProfilePatch): Promise<void> {
  // Colunas novas ainda não estão nos tipos gerados do Supabase.
  const table = supabase.from("profiles") as unknown as {
    update: (v: ProfilePatch) => {
      eq: (c: string, v: string) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
  const { error } = await table.update(patch).eq("id", userId);
  if (error) {
    if (/column .* does not exist|schema cache/i.test(error.message)) {
      throw new Error("O perfil personalizável ainda não foi ativado no banco.");
    }
    throw new Error(error.message);
  }
}

function friendlyStorageError(message: string): string {
  if (/bucket not found/i.test(message)) {
    return "O armazenamento de fotos de perfil ainda não foi ativado.";
  }
  if (/exceeded|too large|payload/i.test(message)) return "Imagem grande demais (máx. 5 MB).";
  return message;
}

/** Formata telefone brasileiro enquanto digita: (11) 91234-5678. */
export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 13);
  const local = d.length > 11 ? d.slice(d.length - 11) : d;
  const ddi = d.length > 11 ? `+${d.slice(0, d.length - 11)} ` : "";
  if (local.length <= 2) return ddi + local;
  if (local.length <= 6) return `${ddi}(${local.slice(0, 2)}) ${local.slice(2)}`;
  if (local.length <= 10)
    return `${ddi}(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return `${ddi}(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
}
