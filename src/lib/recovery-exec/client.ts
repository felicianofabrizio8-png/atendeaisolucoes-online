// Cliente do endpoint de execução assistida (Fase 6.3).
// Concentra o bearer e a normalização de erro para a UI não repetir isso.

import { supabase } from "@/integrations/supabase/client";
import type { RecoveryAttempt, RecoveryAttemptEvent } from "./types";
import type { TimelineEntry } from "./timeline";

export interface ExecResponse {
  attempt: RecoveryAttempt | null;
  events: RecoveryAttemptEvent[];
  timeline: TimelineEntry[];
  queueState?: string;
  inCooldown?: boolean;
  canStart?: boolean;
  reused?: boolean;
  error?: string;
  failureCode?: string;
}

export class RecoveryExecError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: Partial<ExecResponse> = {},
  ) {
    super(message);
    this.name = "RecoveryExecError";
  }
}

export async function recoveryExec(
  action: string,
  payload: Record<string, unknown>,
): Promise<ExecResponse> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new RecoveryExecError("Sessão expirada. Entre novamente.", 401);

  const res = await fetch("/api/recovery/execute", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = (await res.json().catch(() => ({}))) as ExecResponse;
  if (!res.ok) {
    throw new RecoveryExecError(
      json.error ?? "Não foi possível concluir esta ação.",
      res.status,
      json,
    );
  }
  return json;
}

export interface WhatsappTemplateOption {
  id: string;
  name: string;
  language: string;
  status: string;
  variables: string[] | null;
}

export async function listApprovedTemplates(): Promise<WhatsappTemplateOption[]> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return [];
  const res = await fetch("/api/whatsapp/templates/list", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const json = (await res.json().catch(() => ({}))) as { templates?: WhatsappTemplateOption[] };
  return (json.templates ?? []).filter((t) => t.status === "approved");
}
