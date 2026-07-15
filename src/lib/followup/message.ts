// ============================================================================
// followup/message.ts
// Responsabilidade: renderizar o texto final da mensagem de follow-up,
// aplicando humanização opcional. Não envia — apenas gera o payload textual.
// ============================================================================

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { DEFAULT_TEMPLATES, firstName, renderTemplate } from "./defaults";
import { humanizeTemplate } from "./humanizer";
import type { Candidate, FollowupSettings } from "./types";

export async function buildMessage(
  c: Candidate,
  s: FollowupSettings,
  attempt: number,
  humanize: boolean,
): Promise<{ text: string; variant: number }> {
  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("name, product")
    .eq("id", c.leadId)
    .maybeSingle();
  const tpl = s.templates[c.rule] ?? DEFAULT_TEMPLATES[c.rule];
  const nome = firstName(lead?.name);
  const produto = lead?.product ?? "";
  const vars = { nome, produto, agente: s.agentName };
  const base = renderTemplate(tpl, vars);
  if (humanize) {
    const seed = Math.floor(Date.now() / 60000) + c.leadId.charCodeAt(0);
    return humanizeTemplate(base, attempt, seed, vars);
  }
  if (attempt > 1) {
    return {
      text: `${base}\n\nSe preferir, é só responder por aqui quando puder.`,
      variant: 0,
    };
  }
  return { text: base, variant: 0 };
}
