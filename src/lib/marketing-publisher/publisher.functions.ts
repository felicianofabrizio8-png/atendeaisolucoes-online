// Server functions client-safe do Marketing Publisher.
// Toda mutação de dados de publicações é feita apenas via worker (service_role);
// aqui expomos apenas leitura por RLS e reprocessamento explícito.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const RetrySchema = z.object({ id: z.string().uuid() });

const ListSchema = z
  .object({
    scope: z.enum(["operational", "history", "all"]).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  })
  .optional();

// Status considerados operacionais (precisam de acompanhamento).
// Espelha OPERATIONAL_STATUSES em publication-filters.ts.
const OPERATIONAL = ["queued", "publishing", "failed", "cancelled"] as const;

export const listMarketingPublications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => ListSchema.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const scope = data?.scope ?? "operational";
    const limit = data?.limit ?? (scope === "history" ? 100 : 50);
    let q = supabase.from("marketing_publications").select("*");
    if (scope === "operational") q = q.in("status", OPERATIONAL as unknown as string[]);
    if (scope === "history") q = q.eq("status", "published");
    q = q.order("created_at", { ascending: false }).limit(limit);
    const r = await q;
    if (r.error) throw new Error(r.error.message);
    return { publications: r.data ?? [] };
  });

export const getPublisherStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { PublisherAgent } = await import("./PublisherAgent.server");
    const ctx = context as { userId: string; supabase: any };
    const prof = await ctx.supabase
      .from("profiles")
      .select("company_id")
      .eq("id", ctx.userId)
      .maybeSingle();
    const companyId = prof?.data?.company_id as string | undefined;
    if (!companyId) throw new Error("Empresa não encontrada.");
    const agent = new PublisherAgent();
    const stats = await agent.stats(companyId);
    return stats as {
      scheduled: number;
      queued: number;
      publishing: number;
      published: number;
      failed: number;
      cancelled: number;
    };
  });

export const retryPublication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw) => RetrySchema.parse(raw))
  .handler(async ({ data, context }) => {
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
    return { ok: !!row };
  });
