import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  detectAlerts,
  type ConversationSnapshot,
  type MessageLite,
} from "@/lib/coach/detectors";

interface AnalyzeBody {
  scope: "conversation" | "company";
  conversation_id?: string;
  limit?: number; // max conversations to scan when scope=company
}

async function authenticate(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return { error: "não autenticado", status: 401 as const };
  const { data: userRes, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userRes.user) return { error: "sessão inválida", status: 401 as const };
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("company_id")
    .eq("id", userRes.user.id)
    .maybeSingle();
  if (!profile?.company_id) return { error: "perfil sem empresa", status: 403 as const };
  return { userId: userRes.user.id, companyId: profile.company_id as string };
}

async function loadSnapshot(
  companyId: string,
  conversationId: string,
): Promise<ConversationSnapshot | null> {
  const { data: conv } = await supabaseAdmin
    .from("conversations")
    .select("id, lead_id, awaiting_reply, ai_status, human_takeover_at, lead_temperature")
    .eq("company_id", companyId)
    .eq("id", conversationId)
    .maybeSingle();
  if (!conv) return null;

  const { data: lead } = await supabaseAdmin
    .from("leads")
    .select("status, next_action_due_at")
    .eq("id", conv.lead_id)
    .maybeSingle();

  const { data: quotes } = await supabaseAdmin
    .from("quotes")
    .select("sent_at, sent")
    .eq("company_id", companyId)
    .eq("lead_id", conv.lead_id)
    .eq("sent", true)
    .order("sent_at", { ascending: false })
    .limit(1);
  const lastQuote = quotes?.[0];

  const { data: msgs } = await supabaseAdmin
    .from("messages")
    .select("id, role, text, at, source_subtype")
    .eq("company_id", companyId)
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("at", { ascending: false })
    .limit(20);

  const messages: MessageLite[] = ((msgs ?? []) as MessageLite[])
    .slice()
    .reverse()
    .map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text ?? "",
      at: m.at,
      source_subtype: m.source_subtype ?? null,
    }));

  return {
    conversation_id: conv.id,
    lead_id: conv.lead_id,
    lead_status: lead?.status ?? null,
    lead_temperature: conv.lead_temperature ?? null,
    awaiting_reply: !!conv.awaiting_reply,
    ai_status: conv.ai_status ?? null,
    human_takeover_at: conv.human_takeover_at ?? null,
    next_action_due_at: lead?.next_action_due_at ?? null,
    last_quote_sent_at: lastQuote?.sent_at ?? null,
    has_quote: !!lastQuote?.sent_at,
    messages,
  };
}

async function persistAlerts(
  companyId: string,
  snap: ConversationSnapshot,
) {
  const detected = detectAlerts(snap);
  const detectedTypes = new Set(detected.map((d) => d.alert_type));

  // Fecha alertas abertos cujo tipo não foi mais detectado (auto-resolução).
  const { data: openExisting } = await supabaseAdmin
    .from("coach_alerts")
    .select("id, alert_type")
    .eq("company_id", companyId)
    .eq("conversation_id", snap.conversation_id)
    .eq("status", "open");

  const toResolve = (openExisting ?? []).filter(
    (a) => !detectedTypes.has(a.alert_type as never),
  );
  if (toResolve.length > 0) {
    await supabaseAdmin
      .from("coach_alerts")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .in(
        "id",
        toResolve.map((a) => a.id),
      );
  }

  if (detected.length === 0) return { created: 0, resolved: toResolve.length, alerts: [] };

  // Upsert: usa o índice único parcial (conversation_id, alert_type) WHERE status='open'.
  // Como o ON CONFLICT precisa de índice/constraint sem WHERE, fazemos manual.
  const existingOpenByType = new Map(
    (openExisting ?? []).map((a) => [a.alert_type, a.id]),
  );

  const created: string[] = [];
  for (const d of detected) {
    const existingId = existingOpenByType.get(d.alert_type);
    const payloadJson = d.payload as never;
    if (existingId) {
      await supabaseAdmin
        .from("coach_alerts")
        .update({
          severity: d.severity,
          urgency_minutes: d.urgency_minutes ?? null,
          risk_score: d.risk_score,
          payload: payloadJson,
        } as never)
        .eq("id", existingId);
    } else {
      const { data: ins } = await supabaseAdmin
        .from("coach_alerts")
        .insert({
          company_id: companyId,
          conversation_id: snap.conversation_id,
          lead_id: snap.lead_id,
          alert_type: d.alert_type,
          severity: d.severity,
          urgency_minutes: d.urgency_minutes ?? null,
          risk_score: d.risk_score,
          payload: payloadJson,
        } as never)
        .select("id")
        .single();
      if (ins?.id) created.push(ins.id);
    }
  }

  return { created: created.length, resolved: toResolve.length, alerts: detected };
}

export const Route = createFileRoute("/api/coach/analyze")({
  server: {
    handlers: {
      POST: async ({ request }: { request: Request }) => {
        const auth = await authenticate(request);
        if ("error" in auth) return Response.json({ error: auth.error }, { status: auth.status });
        const { companyId } = auth;

        let body: AnalyzeBody;
        try {
          body = await request.json();
        } catch {
          return Response.json({ error: "JSON inválido" }, { status: 400 });
        }

        if (body.scope === "conversation") {
          if (!body.conversation_id)
            return Response.json({ error: "conversation_id obrigatório" }, { status: 400 });
          const snap = await loadSnapshot(companyId, body.conversation_id);
          if (!snap)
            return Response.json({ error: "conversa não encontrada" }, { status: 404 });
          const result = await persistAlerts(companyId, snap);
          return Response.json({ ok: true, scope: "conversation", ...result });
        }

        // scope = company: pega conversas ativas das últimas 7 dias, limitado.
        const limit = Math.min(Math.max(body.limit ?? 50, 1), 200);
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        const { data: convs } = await supabaseAdmin
          .from("conversations")
          .select("id")
          .eq("company_id", companyId)
          .gte("last_message_at", sevenDaysAgo)
          .order("last_message_at", { ascending: false })
          .limit(limit);

        let totalCreated = 0;
        let totalResolved = 0;
        let scanned = 0;
        for (const c of convs ?? []) {
          const snap = await loadSnapshot(companyId, c.id);
          if (!snap) continue;
          const r = await persistAlerts(companyId, snap);
          totalCreated += r.created;
          totalResolved += r.resolved;
          scanned += 1;
        }
        return Response.json({
          ok: true,
          scope: "company",
          scanned,
          created: totalCreated,
          resolved: totalResolved,
        });
      },
    },
  },
});
