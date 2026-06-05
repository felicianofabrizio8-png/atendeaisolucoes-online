import { supabase } from "@/integrations/supabase/client";

export type QuickReply = {
  id: string;
  company_id: string;
  name: string;
  icon: string | null;
  category: string | null;
  content: string;
  sort_order: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type QuickReplyInput = {
  name: string;
  icon?: string | null;
  category?: string | null;
  content: string;
  sort_order?: number;
  active?: boolean;
};

export async function listQuickReplies(
  companyId: string,
  opts?: { activeOnly?: boolean },
): Promise<QuickReply[]> {
  let q = supabase
    .from("quick_replies" as never)
    .select("*")
    .eq("company_id", companyId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (opts?.activeOnly) q = q.eq("active", true);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as QuickReply[];
}

export async function createQuickReply(
  companyId: string,
  input: QuickReplyInput,
): Promise<QuickReply> {
  const { data, error } = await supabase
    .from("quick_replies" as never)
    .insert({
      company_id: companyId,
      name: input.name.trim(),
      icon: input.icon?.trim() || null,
      category: input.category?.trim() || null,
      content: input.content,
      sort_order: input.sort_order ?? 0,
      active: input.active ?? true,
    } as never)
    .select("*")
    .single();
  if (error) throw error;
  return data as unknown as QuickReply;
}

export async function updateQuickReply(
  id: string,
  patch: Partial<QuickReplyInput>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.icon !== undefined) row.icon = patch.icon?.trim() || null;
  if (patch.category !== undefined) row.category = patch.category?.trim() || null;
  if (patch.content !== undefined) row.content = patch.content;
  if (patch.sort_order !== undefined) row.sort_order = patch.sort_order;
  if (patch.active !== undefined) row.active = patch.active;
  const { error } = await supabase
    .from("quick_replies" as never)
    .update(row as never)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteQuickReply(id: string): Promise<void> {
  const { error } = await supabase.from("quick_replies" as never).delete().eq("id", id);
  if (error) throw error;
}

export async function reorderQuickReplies(orderedIds: string[]): Promise<void> {
  // Atualiza sort_order em série (lista pequena, sem necessidade de RPC)
  await Promise.all(
    orderedIds.map((id, idx) =>
      supabase
        .from("quick_replies" as never)
        .update({ sort_order: idx } as never)
        .eq("id", id),
    ),
  );
}
