// Server functions client-safe do Marketing Publisher.
// Toda mutação de dados de publicações é feita apenas via worker (service_role);
// aqui expomos apenas leitura por RLS e reprocessamento explícito.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { PublicationRow, PublisherStats } from "./types";

const RetrySchema = z.object({ id: z.string().uuid() });

export const listMarketingPublications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ publications: PublicationRow[] }> => {
    const { supabase } = context as { supabase: any };
    const r = await supabase
      .from("marketing_publications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);
    if (r.error) throw new Error(r.error.message);
    return { publications: (r.data ?? []) as PublicationRow[] };
  });

export const getPublisherStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PublisherStats & { scheduled: number }> => {
    const { PublisherAgent } = await import("./PublisherAgent.server");
    const ctx = context as { userId: string; supabase: any };
    // Descobre company_id do próprio usuário via profile (RLS-safe).
    const prof = await ctx.supabase
      .from("profiles")
      .select("company_id")
      .eq("id", ctx.userId)
      .maybeSingle();
    const companyId = prof?.data?.company_id as string | undefined;
    if (!companyId) throw new Error("Empresa não encontrada.");
    const agent = new PublisherAgent();
    return agent.stats(companyId);
  });

export const retryPublication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => RetrySchema.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: boolean; row: PublicationRow | null }> => {
    const ctx = context as { userId: string; supabase: any };
    const prof = await ctx.supabase
      .from("profiles")
      .select("company_id")
      .eq("id", ctx.userId)
      .maybeSingle();
    const companyId = prof?.data?.company_id as string | undefined;
    if (!companyId) throw new Error("Empresa não encontrada.");
    const { PublisherAgent } = await import("./PublisherAgent.server");
    const agent = new PublisherAgent();
    const row = await agent.retry(data.id, companyId);
    return { ok: !!row, row };
  });
