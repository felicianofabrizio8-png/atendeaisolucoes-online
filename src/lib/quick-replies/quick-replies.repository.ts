import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface QuickReplyGrounding {
  name: string;
  category: string | null;
  content: string;
  sort_order: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function safeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(limit)));
}

export async function listActiveQuickRepliesForGrounding(
  companyId: string,
  client: SupabaseClient<Database>,
  limit = DEFAULT_LIMIT,
): Promise<QuickReplyGrounding[]> {
  const { data, error } = await client
    .from("quick_replies")
    .select("name, category, content, sort_order")
    .eq("company_id", companyId)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .limit(safeLimit(limit));

  if (error) throw error;
  return data ?? [];
}
