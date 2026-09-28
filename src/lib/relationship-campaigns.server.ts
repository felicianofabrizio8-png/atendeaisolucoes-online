import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type SegmentField = "status" | "channel" | "product" | "assigned_to" | "tag";
export type SegmentOperator = "eq" | "neq" | "contains";

export type SegmentPredicate = {
  field: SegmentField;
  op: SegmentOperator;
  value: string;
};

export type SegmentDefinition = {
  all?: SegmentPredicate[];
  any?: SegmentPredicate[];
};

type LeadCandidate = {
  id: string;
  name: string;
  phone: string | null;
  channel: string;
  status: string;
  tags: string[];
  product: string | null;
  assigned_to: string | null;
};

type RelationshipDb = {
  from: (table: string) => any;
};

const db = supabaseAdmin as unknown as RelationshipDb;
const MAX_PREDICATES = 20;
const SUPPORTED_FIELDS: SegmentField[] = ["status", "channel", "product", "assigned_to", "tag"];
const SUPPORTED_OPERATORS: SegmentOperator[] = ["eq", "neq", "contains"];

export function parseSegmentDefinition(input: unknown): SegmentDefinition {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("segment definition must be an object");
  }

  const value = input as Record<string, unknown>;
  const all = parsePredicates(value.all, "all");
  const any = parsePredicates(value.any, "any");
  if (all.length + any.length > MAX_PREDICATES) {
    throw new Error(`segment supports at most ${MAX_PREDICATES} predicates`);
  }
  return { all, any };
}

function parsePredicates(input: unknown, key: string): SegmentPredicate[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error(`${key} must be an array`);

  return input.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${key}[${index}] must be an object`);
    }
    const predicate = item as Record<string, unknown>;
    if (!SUPPORTED_FIELDS.includes(predicate.field as SegmentField)) {
      throw new Error(`${key}[${index}].field is not supported`);
    }
    if (!SUPPORTED_OPERATORS.includes(predicate.op as SegmentOperator)) {
      throw new Error(`${key}[${index}].op is not supported`);
    }
    if (typeof predicate.value !== "string" || predicate.value.length > 200) {
      throw new Error(`${key}[${index}].value must be a short string`);
    }
    return {
      field: predicate.field as SegmentField,
      op: predicate.op as SegmentOperator,
      value: predicate.value,
    };
  });
}

export function isLeadInSegment(lead: LeadCandidate, definition: SegmentDefinition): boolean {
  const matches = (predicate: SegmentPredicate) => {
    const raw = predicate.field === "tag" ? lead.tags : lead[predicate.field];
    const values = Array.isArray(raw) ? raw : [raw ?? ""];
    return values.some((candidate) => {
      const left = String(candidate).toLowerCase();
      const right = predicate.value.toLowerCase();
      if (predicate.op === "eq") return left === right;
      if (predicate.op === "neq") return left !== right;
      return left.includes(right);
    });
  };

  return (definition.all ?? []).every(matches) &&
    ((definition.any ?? []).length === 0 || (definition.any ?? []).some(matches));
}

async function loadCompanyLeads(companyId: string): Promise<LeadCandidate[]> {
  const { data, error } = await db
    .from("leads")
    .select("id,name,phone,channel,status,tags,product,assigned_to")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as LeadCandidate[];
}

export async function previewRelationshipSegment(
  companyId: string,
  input: unknown,
  sampleLimit = 25,
) {
  const definition = parseSegmentDefinition(input);
  const leads = await loadCompanyLeads(companyId);
  const eligible = leads.filter((lead) => isLeadInSegment(lead, definition));
  return {
    count: eligible.length,
    sample: eligible.slice(0, Math.max(0, Math.min(sampleLimit, 100))).map(toRecipientPreview),
    definition,
  };
}

function toRecipientPreview(lead: LeadCandidate) {
  return {
    lead_id: lead.id,
    name: lead.name,
    phone: lead.phone,
    channel: lead.channel,
    status: lead.status,
  };
}

export async function createRelationshipSegment(
  companyId: string,
  name: string,
  input: unknown,
) {
  const definition = parseSegmentDefinition(input);
  const { data, error } = await db
    .from("relationship_segments")
    .insert({ company_id: companyId, name: name.trim(), definition })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function createRelationshipCampaign(
  companyId: string,
  name: string,
  segmentId: string,
) {
  const { data: segment, error: segmentError } = await db
    .from("relationship_segments")
    .select("id,version,active")
    .eq("company_id", companyId)
    .eq("id", segmentId)
    .maybeSingle();
  if (segmentError) throw segmentError;
  if (!segment?.active) throw new Error("segment not found or inactive");

  const { data, error } = await db
    .from("relationship_campaigns")
    .insert({
      company_id: companyId,
      segment_id: segment.id,
      segment_version: segment.version,
      name: name.trim(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function materializeRelationshipRecipients(
  companyId: string,
  relationshipCampaignId: string,
) {
  const { data: campaign, error: campaignError } = await db
    .from("relationship_campaigns")
    .select("id,segment_id,segment_version,status")
    .eq("company_id", companyId)
    .eq("id", relationshipCampaignId)
    .maybeSingle();
  if (campaignError) throw campaignError;
  if (!campaign) throw new Error("relationship campaign not found");

  const { data: segment, error: segmentError } = await db
    .from("relationship_segments")
    .select("definition,version,active")
    .eq("company_id", companyId)
    .eq("id", campaign.segment_id)
    .maybeSingle();
  if (segmentError) throw segmentError;
  if (!segment?.active) throw new Error("segment not found or inactive");

  // Re-read the segment and all tenant leads immediately before materializing.
  // This is the eligibility revalidation boundary; no client-provided list is used.
  const definition = parseSegmentDefinition(segment.definition);
  const eligible = (await loadCompanyLeads(companyId)).filter((lead) =>
    isLeadInSegment(lead, definition),
  );
  const eligibleLeadIds = eligible.map((lead) => lead.id);

  const pendingReset = db
    .from("relationship_campaign_recipients")
    .update({ status: "ineligible", updated_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .eq("relationship_campaign_id", relationshipCampaignId)
    .in("status", ["pending", "ineligible"]);
  const { error: resetError } = await pendingReset;
  if (resetError) throw resetError;

  if (eligible.length > 0) {
    const rows = eligible.map((lead) => ({
      company_id: companyId,
      relationship_campaign_id: relationshipCampaignId,
      lead_id: lead.id,
      segment_version: segment.version,
      status: "pending",
      phone_snapshot: lead.phone,
      name_snapshot: lead.name,
      metadata: { source: "relationship_segment", segment_id: campaign.segment_id },
    }));
    const { error: insertError } = await db
      .from("relationship_campaign_recipients")
      .upsert(rows, {
        onConflict: "company_id,relationship_campaign_id,lead_id",
        ignoreDuplicates: true,
      });
    if (insertError) throw insertError;

    const { error: eligibleStatusError } = await db
      .from("relationship_campaign_recipients")
      .update({ status: "pending", updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .eq("relationship_campaign_id", relationshipCampaignId)
      .eq("status", "ineligible")
      .in("lead_id", eligibleLeadIds);
    if (eligibleStatusError) throw eligibleStatusError;
  }

  await db
    .from("relationship_campaigns")
    .update({ status: "ready", segment_version: segment.version })
    .eq("company_id", companyId)
    .eq("id", relationshipCampaignId);

  return {
    relationship_campaign_id: relationshipCampaignId,
    segment_version: segment.version,
    count: eligible.length,
    lead_ids: eligibleLeadIds,
  };
}
