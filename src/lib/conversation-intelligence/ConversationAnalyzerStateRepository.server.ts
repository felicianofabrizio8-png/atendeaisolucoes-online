// Repositório do watermark de processamento (conversation_analyzer_state).
import { ANALYZER_VERSION, type ProcessingStatus } from "./ConversationIntelligenceTypes";

type LooseClient = {
  from: (t: string) => {
    select: (c: string) => {
      eq: (col: string, v: unknown) => {
        eq: (col: string, v: unknown) => {
          eq: (col: string, v: unknown) => {
            maybeSingle: () => Promise<{ data: { id: string; attempts: number } | null }>;
          };
        };
      };
    };
    update: (row: Record<string, unknown>) => {
      eq: (col: string, v: unknown) => Promise<{ error: unknown }>;
    };
    insert: (row: Record<string, unknown>) => Promise<{ error: unknown }>;
  };
};

export async function markState(params: {
  companyId: string;
  conversationId: string;
  contentHash: string;
  lastMessageAt: string | null;
  status: ProcessingStatus;
  errorCode?: string | null;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const client = supabaseAdmin as unknown as LooseClient;
  const nowIso = new Date().toISOString();

  const { data: existing } = await client
    .from("conversation_analyzer_state")
    .select("id, attempts")
    .eq("company_id", params.companyId)
    .eq("conversation_id", params.conversationId)
    .eq("analyzer_version", ANALYZER_VERSION)
    .maybeSingle();

  const payload = {
    company_id: params.companyId,
    conversation_id: params.conversationId,
    analyzer_version: ANALYZER_VERSION,
    last_content_hash: params.contentHash,
    last_message_at: params.lastMessageAt,
    last_analyzed_at: nowIso,
    processing_status: params.status,
    last_error_code: params.errorCode ?? null,
  };

  if (existing) {
    await client
      .from("conversation_analyzer_state")
      .update({ ...payload, attempts: existing.attempts + 1 })
      .eq("id", existing.id);
  } else {
    await client
      .from("conversation_analyzer_state")
      .insert({ ...payload, attempts: 1 });
  }
}
