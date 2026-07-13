// Repositório do watermark de processamento (conversation_analyzer_state).
import { ANALYZER_VERSION, type ProcessingStatus } from "./ConversationIntelligenceTypes";

export async function markState(params: {
  companyId: string;
  conversationId: string;
  contentHash: string;
  lastMessageAt: string | null;
  status: ProcessingStatus;
  errorCode?: string | null;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const nowIso = new Date().toISOString();

  const { data: existing } = await supabaseAdmin
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
    await supabaseAdmin
      .from("conversation_analyzer_state")
      .update({ ...payload, attempts: (existing.attempts as number) + 1 })
      .eq("id", existing.id as string);
  } else {
    await supabaseAdmin
      .from("conversation_analyzer_state")
      .insert({ ...payload, attempts: 1 });
  }
}
