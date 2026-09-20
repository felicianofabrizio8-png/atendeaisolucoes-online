export type AssistedSuggestionStatus = "pending" | "approved" | "rejected";
export type AssistedSuggestionAction = "approve" | "reject";

const STATUS_PREFIX = "v2_status:";

export type AssistedSuggestionInput = {
  companyId: string;
  conversationId: string;
  leadId: string;
  text: string;
  productIds?: readonly string[];
};

export type AssistedSuggestionInsert = {
  company_id: string;
  conversation_id: string;
  lead_id: string;
  generated_text: string;
  classification: string;
  was_sent: false;
  was_edited: false;
  sent_text: null;
};

export type AssistedSuggestionRow = {
  id: string;
  company_id: string;
  conversation_id: string | null;
  classification: string | null;
  was_sent: boolean;
};

export type AssistedSuggestionTransition =
  | {
      ok: true;
      status: "approved" | "rejected";
      sendAllowed: false;
      update: { classification: string; was_sent: false };
    }
  | {
      ok: false;
      code:
        | "company_id_required"
        | "suggestion_not_found"
        | "cross_tenant"
        | "invalid_status"
        | "already_sent";
    };

function statusMarker(status: AssistedSuggestionStatus): string {
  return `${STATUS_PREFIX}${status}`;
}

export function buildPendingAssistedSuggestion(
  input: AssistedSuggestionInput,
): AssistedSuggestionInsert {
  if (!input.companyId.trim()) throw new Error("company_id_required");
  if (!input.conversationId.trim() || !input.leadId.trim() || !input.text.trim()) {
    throw new Error("assisted_suggestion_input_invalid");
  }
  return {
    company_id: input.companyId,
    conversation_id: input.conversationId,
    lead_id: input.leadId,
    generated_text: input.text,
    classification: statusMarker("pending"),
    was_sent: false,
    was_edited: false,
    sent_text: null,
  };
}

export function getAssistedSuggestionStatus(
  classification: string | null | undefined,
  wasSent: boolean,
): AssistedSuggestionStatus {
  if (wasSent) return "approved";
  if (classification === statusMarker("rejected")) return "rejected";
  if (classification === statusMarker("approved")) return "approved";
  return "pending";
}

export function transitionAssistedSuggestion(
  row: AssistedSuggestionRow | null,
  companyId: string,
  action: AssistedSuggestionAction,
): AssistedSuggestionTransition {
  if (!companyId.trim()) return { ok: false, code: "company_id_required" };
  if (!row) return { ok: false, code: "suggestion_not_found" };
  if (row.company_id !== companyId) return { ok: false, code: "cross_tenant" };
  if (row.was_sent) return { ok: false, code: "already_sent" };
  if (getAssistedSuggestionStatus(row.classification, row.was_sent) !== "pending") {
    return { ok: false, code: "invalid_status" };
  }
  const status = action === "approve" ? "approved" : "rejected";
  return {
    ok: true,
    status,
    sendAllowed: false,
    update: { classification: statusMarker(status), was_sent: false },
  };
}
