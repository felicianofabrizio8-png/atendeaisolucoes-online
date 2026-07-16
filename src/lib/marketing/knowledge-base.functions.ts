// Server functions for the Marketing Knowledge Base.
// - Uma linha por company_id. RLS garante isolamento.
// - get: cria implicitamente uma linha vazia se ainda não existir.

import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

type SB = SupabaseClient<Database>;

async function loadCompanyId(ctx: {
  supabase: unknown;
  userId: string;
}): Promise<{ companyId: string; supabase: SB; userId: string }> {
  const sb = ctx.supabase as SB;
  const { data, error } = await sb
    .from("profiles")
    .select("company_id")
    .eq("id", ctx.userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.company_id) throw new Error("Usuário sem empresa.");
  return { companyId: data.company_id, supabase: sb, userId: ctx.userId };
}

const FIELDS = [
  "id",
  "company_id",
  "brand_identity",
  "tone_of_voice",
  "differentiators",
  "products_services",
  "guarantees",
  "cities_served",
  "gifts",
  "commercial_terms",
  "preferred_words",
  "forbidden_words",
  "copy_best_practices",
  "extra_notes",
  "updated_at",
  "updated_by",
] as const;

export const getMarketingKnowledgeBase = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { companyId, supabase } = await loadCompanyId(context);
    const { data, error } = await supabase
      .from("marketing_knowledge_base")
      .select("*")
      .eq("company_id", companyId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return { kb: data };
    // Cria linha vazia na primeira leitura.
    const { data: created, error: insErr } = await supabase
      .from("marketing_knowledge_base")
      .insert({ company_id: companyId })
      .select("*")
      .single();
    if (insErr) throw new Error(insErr.message);
    return { kb: created };
  });

const UpsertSchema = z.object({
  brand_identity: z.string().max(4000).optional(),
  tone_of_voice: z.string().max(2000).optional(),
  differentiators: z.string().max(4000).optional(),
  products_services: z.string().max(4000).optional(),
  guarantees: z.string().max(2000).optional(),
  cities_served: z.string().max(2000).optional(),
  gifts: z.string().max(2000).optional(),
  commercial_terms: z.string().max(4000).optional(),
  preferred_words: z.string().max(2000).optional(),
  forbidden_words: z.string().max(2000).optional(),
  copy_best_practices: z.string().max(4000).optional(),
  extra_notes: z.string().max(4000).optional(),
});

export const upsertMarketingKnowledgeBase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: unknown) => UpsertSchema.parse(i))
  .handler(async ({ data, context }) => {
    const { companyId, supabase, userId } = await loadCompanyId(context);
    const payload = { company_id: companyId, updated_by: userId, ...data };
    const { data: row, error } = await supabase
      .from("marketing_knowledge_base")
      .upsert(payload, { onConflict: "company_id" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return { kb: row };
  });
