/**
 * Static Brand Composer — camada server-side.
 *
 * Ponte entre o backend autorizado (server function) e o compositor
 * determinístico puro (`static-brand-composer.ts`). Aqui obtemos acesso
 * temporário à logo publicada e delegamos o cálculo do plano para o
 * módulo puro. Nenhuma signed URL é persistida — o consumidor deve
 * descartar o plano ao final do request.
 *
 * REGRAS
 *  - `company_id` DEVE vir da sessão autenticada (nunca do frontend).
 *  - Este módulo NÃO consulta tabelas brand_* diretamente — usa a facade
 *    `brand-consumer.server.ts`.
 *  - Não gera logs contendo URLs — apenas códigos sanitizados.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { loadMarketingBrandContext } from "./brand-context-adapter";
import {
  planStaticBrandComposition,
  type StaticBaseImage,
  type StaticBrandCompositionCanvas,
  type StaticBrandCompositionContent,
  type StaticBrandCompositionPlan,
} from "./static-brand-composer";

type SB = SupabaseClient<Database>;

export interface PrepareStaticBrandCompositionInput {
  companyId: string;
  baseImage: StaticBaseImage;
  canvas: StaticBrandCompositionCanvas;
  content?: StaticBrandCompositionContent;
}

/**
 * Carrega o BrandContext, obtém acesso temporário à logo (se disponível)
 * e devolve um plano de composição pronto para rasterização. O plano
 * carrega uma signed URL efêmera na logo — trate-o como transitório.
 */
export async function prepareStaticBrandComposition(
  supabase: SB,
  input: PrepareStaticBrandCompositionInput,
): Promise<StaticBrandCompositionPlan> {
  if (!input.companyId) throw new Error("company_id_required");
  const brand = await loadMarketingBrandContext(supabase, input.companyId);
  return planStaticBrandComposition({
    baseImage: input.baseImage,
    canvas: input.canvas,
    brand,
    content: input.content,
  });
}
