import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isQuickReplyExpired } from "./validity";

export interface QuickReplyGrounding {
  name: string;
  category: string | null;
  content: string;
  sort_order: number;
  companyId?: string | null;
  conflictKey?: string | null;
}

const BASE_COLUMNS = "name, category, content, sort_order, company_id, conflict_key";
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
  now: Date = new Date(),
): Promise<QuickReplyGrounding[]> {
  const read = (columns: string) =>
    client
      .from("quick_replies")
      .select(columns)
      .eq("company_id", companyId)
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .limit(safeLimit(limit));

  // `valid_until` pode ainda não existir no banco (migration pendente): nesse caso lê sem ele.
  let { data, error } = await read(`${BASE_COLUMNS}, valid_until`);
  if (error) ({ data, error } = await read(BASE_COLUMNS));
  if (error) throw error;
  type Row = Database["public"]["Tables"]["quick_replies"]["Row"] & { valid_until?: string | null };
  // Informação vencida não chega à IA: sem ela, a pergunta segue para um atendente.
  const rows = ((data ?? []) as unknown as Row[]).filter((reply) => !isQuickReplyExpired(reply.valid_until, now));
  return rows.map((reply) => ({
    name: reply.name,
    category: reply.category,
    content: reply.content,
    sort_order: reply.sort_order,
    companyId: reply.company_id,
    conflictKey: reply.conflict_key,
  }));
}
