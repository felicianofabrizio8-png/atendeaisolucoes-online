// Camada de dados do módulo Campanhas. Isolado — não toca inbox/whatsapp/webhooks.
import { supabase } from "@/integrations/supabase/client";

export type CampaignObjective = "whatsapp" | "instagram" | "messenger";
export type CampaignGoal =
  | "awareness"
  | "traffic"
  | "engagement"
  | "leads"
  | "sales"
  | "reactivation";
export type CampaignStatus = "draft" | "scheduled" | "active" | "paused" | "ended";

export const GOAL_LABELS: Record<CampaignGoal, string> = {
  awareness: "Reconhecimento",
  traffic: "Tráfego",
  engagement: "Engajamento",
  leads: "Leads",
  sales: "Vendas",
  reactivation: "Reativação",
};

export function goalLabel(g: CampaignGoal | null | undefined): string {
  return g ? GOAL_LABELS[g] ?? "Leads" : "Leads";
}

export function channelLabel(o: CampaignObjective): string {
  return ({ whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger" } as const)[o];
}

export interface Campaign {
  id: string;
  company_id: string;
  name: string;
  objective: CampaignObjective;
  goal: CampaignGoal;
  product: string | null;
  city: string | null;
  radius_km: number | null;
  daily_budget: number | null;
  start_date: string | null;
  media_url: string | null;
  media_type: string | null;
  primary_text: string | null;
  headline: string | null;
  cta: string | null;
  status: CampaignStatus;
  meta_campaign_id: string | null;
  leads_count: number;
  messages_count: number;
  spent: number;
  ai_diagnosis: string | null;
  created_at: string;
  updated_at: string;
}

export async function listCampaigns(companyId: string): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Campaign[];
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as Campaign) ?? null;
}

export async function createCampaign(
  companyId: string,
  input: Partial<Campaign> & { name: string },
): Promise<Campaign> {
  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      company_id: companyId,
      name: input.name,
      objective: input.objective ?? "whatsapp",
      goal: input.goal ?? "leads",
      product: input.product ?? null,
      city: input.city ?? null,
      radius_km: input.radius_km ?? null,
      daily_budget: input.daily_budget ?? null,
      start_date: input.start_date ?? null,
      media_url: input.media_url ?? null,
      media_type: input.media_type ?? null,
      primary_text: input.primary_text ?? null,
      headline: input.headline ?? null,
      cta: input.cta ?? null,
      status: input.status ?? "draft",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Campaign;
}

export async function updateCampaign(id: string, patch: Partial<Campaign>): Promise<void> {
  const { error } = await supabase.from("campaigns").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase.from("campaigns").delete().eq("id", id);
  if (error) throw error;
}

export function formatBRL(value: number | null | undefined): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(value ?? 0),
  );
}

export function statusLabel(s: CampaignStatus): string {
  return (
    {
      draft: "Rascunho",
      scheduled: "Agendada",
      active: "Ativa",
      paused: "Pausada",
      ended: "Encerrada",
    } as const
  )[s];
}

export function objectiveLabel(o: CampaignObjective): string {
  return ({ whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger" } as const)[o];
}
