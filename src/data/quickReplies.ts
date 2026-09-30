import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type QuickReplyUpdate = Database["public"]["Tables"]["quick_replies"]["Update"];

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
    .from("quick_replies")
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
    .from("quick_replies")
    .insert({
      company_id: companyId,
      name: input.name.trim(),
      icon: input.icon?.trim() || null,
      category: input.category?.trim() || null,
      content: input.content,
      sort_order: input.sort_order ?? 0,
      active: input.active ?? true,
    })
    .select("*")
    .single();
  if (error) throw error;
  const { data: confirmed, error: confirmError } = await supabase
    .from("quick_replies")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", data.id)
    .maybeSingle();
  if (confirmError) throw confirmError;
  if (!confirmed) throw new Error("Resposta rápida criada, mas não foi confirmada no banco.");
  return confirmed as QuickReply;
}

export async function updateQuickReply(
  companyId: string,
  id: string,
  patch: Partial<QuickReplyInput>,
): Promise<QuickReply> {
  const row: QuickReplyUpdate = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.icon !== undefined) row.icon = patch.icon?.trim() || null;
  if (patch.category !== undefined) row.category = patch.category?.trim() || null;
  if (patch.content !== undefined) row.content = patch.content;
  if (patch.sort_order !== undefined) row.sort_order = patch.sort_order;
  if (patch.active !== undefined) row.active = patch.active;
  const { error } = await supabase
    .from("quick_replies")
    .update(row)
    .eq("company_id", companyId)
    .eq("id", id);
  if (error) throw error;
  const { data: confirmed, error: confirmError } = await supabase
    .from("quick_replies")
    .select("*")
    .eq("company_id", companyId)
    .eq("id", id)
    .maybeSingle();
  if (confirmError) throw confirmError;
  if (!confirmed) throw new Error("Resposta rápida não encontrada para atualização nesta empresa.");
  return confirmed as QuickReply;
}

export async function deleteQuickReply(companyId: string, id: string): Promise<void> {
  const { data, error } = await supabase
    .from("quick_replies")
    .delete()
    .eq("company_id", companyId)
    .eq("id", id)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Resposta rápida não encontrada para exclusão nesta empresa.");
}

export async function reorderQuickReplies(companyId: string, orderedIds: string[]): Promise<void> {
  // Atualiza sort_order em série (lista pequena, sem necessidade de RPC)
  const results = await Promise.all(
    orderedIds.map((id, idx) =>
      supabase
        .from("quick_replies")
        .update({ sort_order: idx })
        .eq("company_id", companyId)
        .eq("id", id),
    ),
  );
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}
