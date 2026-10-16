import { supabase } from "@/integrations/supabase/client";

/** Contrato entre a tela e /api/lume/*. */

export interface LumeAction {
  id: string;
  tool: string;
  summary: string;
  status: "executada" | "pendente" | "confirmada" | "cancelada" | "desfeita" | "falhou";
  args?: Record<string, unknown>;
  undo?: unknown;
  touched: string[];
  error?: string;
}

export interface LumeChatResult {
  reply: string;
  actions: LumeAction[];
  transcript: string | null;
}

export interface LumeStatus {
  chat: boolean;
  origin: "lume" | "vendedora" | null;
  voice: boolean;
  agenda: { extended: boolean };
}

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

async function authHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("Sua sessão expirou. Entre novamente.");
  return `Bearer ${data.session.access_token}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || "A Lume não respondeu. Tente de novo.");
  return body as T;
}

export async function askLume(params: {
  message: string;
  audio?: Blob | null;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  page: string;
  signal?: AbortSignal;
}): Promise<LumeChatResult> {
  const body = new FormData();
  body.set("message", params.message);
  body.set("history", JSON.stringify(params.history.slice(-12)));
  body.set("page", params.page);
  body.set("timezone", timeZone());
  if (params.audio) {
    const extension = params.audio.type.includes("mp4")
      ? "m4a"
      : params.audio.type.includes("ogg")
        ? "ogg"
        : "webm";
    body.set(
      "audio",
      new File([params.audio], `lume.${extension}`, { type: params.audio.type.split(";")[0] }),
    );
  }
  const response = await fetch("/api/lume/chat", {
    method: "POST",
    headers: { Authorization: await authHeader() },
    body,
    signal: params.signal,
  });
  return readJson<LumeChatResult>(response);
}

export async function decideLumeAction(
  action: LumeAction,
  decision: "confirm" | "cancel" | "undo",
): Promise<{ status: LumeAction["status"]; undo?: unknown; touched?: string[]; error?: string }> {
  const response = await fetch("/api/lume/action", {
    method: "POST",
    headers: { Authorization: await authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      decision,
      id: action.id,
      tool: action.tool,
      args: action.args,
      undo: action.undo,
      summary: action.summary,
      timezone: timeZone(),
    }),
  });
  return readJson(response);
}

export async function lumeStatus(): Promise<LumeStatus> {
  const response = await fetch("/api/lume/status", {
    headers: { Authorization: await authHeader() },
  });
  return readJson<LumeStatus>(response);
}
