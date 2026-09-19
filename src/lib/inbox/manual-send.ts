import { supabase } from "@/integrations/supabase/client";

export type ManualSendInput = {
  conversationId: string;
  leadId: string;
  channel: string;
  origin: string;
  text: string;
  replyToMessageId?: string | null;
};

export type ManualSendResult =
  | {
      ok: true;
      kind: "success";
      delivery: "sent" | "simulated";
      messageId: string | null;
      conversationId: string;
    }
  | {
      ok: false;
      kind: "error";
      error: string;
      retryable: boolean;
      status: number | null;
    };

function retryableStatus(status: number | null): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryableTransportException(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (typeof DOMException !== "undefined" && error instanceof DOMException) {
    return error.name === "AbortError" || error.name === "TimeoutError";
  }
  return false;
}

function errorResult(error: string, status: number | null, retryable = retryableStatus(status)): ManualSendResult {
  return { ok: false, kind: "error", error, retryable, status };
}

function metaRoute(origin: string): { providerType: string; subtype: "dm" | "comment" } {
  const providerType =
    origin === "instagram_comment"
      ? "instagram_comment"
      : origin === "instagram_direct"
        ? "instagram_direct"
        : origin;
  const subtype =
    origin === "instagram_comment" ||
    origin === "facebook_comment" ||
    origin === "comment"
      ? "comment"
      : "dm";
  return { providerType, subtype };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json().catch(() => ({}));
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export async function sendManualText(input: ManualSendInput): Promise<ManualSendResult> {
  const text = input.text.trim();
  if (!text) return errorResult("Mensagem vazia", 400);
  if (!["whatsapp", "instagram", "facebook", "messenger"].includes(input.channel)) {
    return errorResult("Canal não suportado para envio manual", 400);
  }

  let session: Awaited<ReturnType<typeof supabase.auth.getSession>>;
  try {
    session = await supabase.auth.getSession();
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "Falha ao validar sessão", null);
  }
  const token = session.data.session?.access_token;
  if (!token) return errorResult("Sessão expirada. Faça login novamente.", 401);

  if (input.channel === "whatsapp") {
    const endpoint = input.replyToMessageId
      ? "/api/whatsapp/send-reply"
      : "/api/whatsapp/send";
    const body = input.replyToMessageId
      ? {
          conversationId: input.conversationId,
          text,
          replyToMessageId: input.replyToMessageId,
        }
      : { conversationId: input.conversationId, text };
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const payload = await readJson(response);
      if (!response.ok) {
        return errorResult(String(payload.error ?? `HTTP ${response.status}`), response.status);
      }
      if (payload.simulated === true) {
        if (typeof payload.simulationId !== "string" || payload.externalRequestSent !== false) {
          return errorResult("Resposta simulada sem confirmação válida", response.status);
        }
        return { ok: true, kind: "success", delivery: "simulated", messageId: null, conversationId: input.conversationId };
      }
      if (typeof payload.id !== "string" || payload.id.length === 0) {
        return errorResult("Envio sem confirmação de persistência", response.status);
      }
      return { ok: true, kind: "success", delivery: "sent", messageId: payload.id, conversationId: input.conversationId };
    } catch (error) {
      return errorResult(
        error instanceof Error ? error.message : "Erro de rede",
        null,
        retryableTransportException(error),
      );
    }
  }

  const { providerType, subtype } = metaRoute(input.origin);
  let data: unknown;
  let error: { message?: string } | null;
  try {
    ({ data, error } = await supabase.functions.invoke("meta-send", {
      body: {
        conversationId: input.conversationId,
        leadId: input.leadId,
        text,
        subtype,
        origin: input.origin,
        provider_type: providerType,
      },
    }));
  } catch (caught) {
    return errorResult(caught instanceof Error ? caught.message : "Falha ao chamar transporte Meta", null);
  }
  const payload = data && typeof data === "object" ? data as Record<string, unknown> : {};
  const ok = !error && payload.ok === true;
  if (!ok) {
    const metaError = payload.metaError && typeof payload.metaError === "object"
      ? payload.metaError as Record<string, unknown>
      : null;
    const message = String(metaError?.message ?? payload.error ?? error?.message ?? "Falha ao enviar");
    const status = typeof payload.status === "number" ? payload.status : null;
    return errorResult(message, status);
  }
  if (payload.simulated === true) {
    if (typeof payload.simulationId !== "string" || payload.externalRequestSent !== false) {
      return errorResult("Resposta simulada sem confirmação válida", null);
    }
    return { ok: true, kind: "success", delivery: "simulated", messageId: null, conversationId: input.conversationId };
  }
  if (typeof payload.id !== "string" || payload.id.length === 0) {
    return errorResult("Envio sem confirmação de persistência", null);
  }
  return { ok: true, kind: "success", delivery: "sent", messageId: payload.id, conversationId: input.conversationId };
}
