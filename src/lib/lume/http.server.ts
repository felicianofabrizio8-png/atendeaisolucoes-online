import { createClient } from "@supabase/supabase-js";
import { safeTimeZone } from "@/lib/followup/calendar";
import { lumeReadiness, resolveLumeTranscribeConfig } from "./config.server";
import { findTool, riskOf, runLumeTurn } from "./agent.server";
import { agendaDomain } from "./domains/agenda.server";
import {
  LumeError,
  type LumeContext,
  type LumeDomain,
  type LumeTurn,
  type LumeUndo,
} from "./types";

/**
 * Rotas da Lume:
 *   POST /api/lume/chat    — texto ou áudio; devolve resposta e ações
 *   POST /api/lume/action  — confirmar, cancelar ou desfazer uma ação
 *   GET  /api/lume/status  — se a chave e o áudio estão configurados
 * A permissão de equipe ("Gerenciar agenda") é aplicada antes, pelo middleware de API.
 */

const DOMAINS: LumeDomain[] = [agendaDomain];
const MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const AUDIO_TYPES = /^audio\/(webm|ogg|mpeg|mp4|m4a|x-m4a|wav|x-wav|aac)(;.*)?$/;

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function fail(error: unknown) {
  if (error instanceof LumeError) return json({ error: error.message }, error.status);
  if (error instanceof Error && ["AbortError", "TimeoutError"].includes(error.name))
    return json({ error: "A Lume demorou demais. Tente de novo." }, 504);
  console.error("[lume]", error instanceof Error ? error.message : error);
  return json({ error: "A Lume não conseguiu concluir agora." }, 503);
}

async function contextFor(request: Request, timeZone?: string | null): Promise<LumeContext> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new LumeError("Entre na sua conta.", 401);
  // Cabeçalho x-lume-source: o histórico da Agenda registra que a mudança veio da Lume.
  const client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: authorization, "x-lume-source": "lume" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: identity, error } = await client.auth.getUser(authorization.slice(7));
  if (error || !identity.user) throw new LumeError("Sessão inválida.", 401);
  const { data: profile } = await client
    .from("profiles")
    .select("company_id, display_name")
    .eq("id", identity.user.id)
    .maybeSingle();
  if (!profile?.company_id) throw new LumeError("Empresa não encontrada.", 403);
  const { error: schemaError } = await client.from("agenda_event_types").select("id").limit(1);
  return {
    client,
    companyId: profile.company_id,
    userId: identity.user.id,
    userName: profile.display_name ?? null,
    timeZone: safeTimeZone(timeZone),
    now: new Date(),
    extended: !schemaError,
  };
}

/** Registro de auditoria em lume_actions (melhor esforço; nunca derruba o pedido). */
async function audit(ctx: LumeContext, rows: Array<Record<string, unknown>>) {
  if (!ctx.extended || !rows.length || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("lume_actions" as never).insert(
      rows.map((row) => ({
        company_id: ctx.companyId,
        user_id: ctx.userId,
        domain: "agenda",
        ...row,
      })) as never,
    );
  } catch {
    console.warn("[lume] auditoria indisponível");
  }
}

async function transcribe(file: File, signal: AbortSignal): Promise<string> {
  const config = resolveLumeTranscribeConfig();
  if (!config)
    throw new LumeError(
      "O áudio ainda não está configurado. Escreva a mensagem por enquanto.",
      503,
    );
  if (file.size > MAX_AUDIO_BYTES)
    throw new LumeError("Áudio longo demais. Grave até uns 3 minutos.", 413);
  if (!AUDIO_TYPES.test(file.type)) throw new LumeError("Formato de áudio não suportado.");
  const body = new FormData();
  body.set("file", file, file.name || "audio.webm");
  body.set("model", config.model);
  body.set("language", "pt");
  const response = await fetch(config.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}` },
    body,
    signal,
  });
  if (!response.ok) throw new LumeError("Não consegui entender o áudio. Tente de novo.", 502);
  const result = (await response.json().catch(() => null)) as { text?: string } | null;
  const text = result?.text?.trim();
  if (!text) throw new LumeError("O áudio veio sem fala reconhecível.", 422);
  return text;
}

function parseHistory(raw: unknown): LumeTurn[] {
  try {
    const list = JSON.parse(typeof raw === "string" ? raw : "[]");
    if (!Array.isArray(list)) return [];
    return list
      .filter(
        (turn): turn is LumeTurn =>
          !!turn &&
          (turn.role === "user" || turn.role === "assistant") &&
          typeof turn.text === "string",
      )
      .slice(-12)
      .map((turn) => ({ role: turn.role, text: turn.text.slice(0, 4000) }));
  } catch {
    return [];
  }
}

export async function handleLumeChat(request: Request): Promise<Response> {
  try {
    if (!request.headers.get("content-type")?.startsWith("multipart/form-data"))
      throw new LumeError("Envie a mensagem pelo formulário da Lume.");
    const form = await request.formData();
    const ctx = await contextFor(request, String(form.get("timezone") ?? ""));
    const audio = form.get("audio");
    let message = String(form.get("message") ?? "")
      .trim()
      .slice(0, 4000);
    let transcript: string | null = null;
    if (audio instanceof File && audio.size > 0) {
      transcript = await transcribe(
        audio,
        AbortSignal.any([request.signal, AbortSignal.timeout(30_000)]),
      );
      message = message ? `${message}\n${transcript}` : transcript;
    }
    if (!message) throw new LumeError("Escreva ou grave o que você precisa.");
    const result = await runLumeTurn({
      ctx,
      domains: DOMAINS,
      message,
      history: parseHistory(form.get("history")),
      page: String(form.get("page") ?? "") || null,
      signal: request.signal,
    });
    await audit(
      ctx,
      result.actions.map((action) => ({
        id: action.id,
        tool: action.tool,
        summary: action.summary,
        input: action.args ?? {},
        status: action.status,
        undo: action.undo ?? null,
        error: action.error ?? null,
      })),
    );
    return json({ ...result, transcript });
  } catch (error) {
    return fail(error);
  }
}

const UNDO_OPS = new Set(["delete_events", "restore_events", "update_event", "delete_rows"]);

function validUndo(value: unknown): value is LumeUndo {
  if (!value || typeof value !== "object") return false;
  const undo = value as Record<string, unknown>;
  if (!UNDO_OPS.has(String(undo.op))) return false;
  if (undo.op === "delete_events")
    return Array.isArray(undo.ids) && undo.ids.every((id) => typeof id === "string");
  if (undo.op === "restore_events") return Array.isArray(undo.rows) && undo.rows.length <= 25;
  if (undo.op === "update_event")
    return typeof undo.id === "string" && !!undo.changes && typeof undo.changes === "object";
  return typeof undo.table === "string" && Array.isArray(undo.ids);
}

interface StoredAction {
  id: string;
  tool: string;
  summary: string;
  input: Record<string, unknown> | null;
  status: string;
  undo: unknown;
}

/** Com auditoria ativa, as ações ficam guardadas no servidor e são a única fonte de verdade. */
function auditEnabled(ctx: LumeContext) {
  return ctx.extended && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
}

async function storedAction(ctx: LumeContext, id: string): Promise<StoredAction | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("lume_actions" as never)
    .select("id,tool,summary,input,status,undo")
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  return (data as StoredAction | null) ?? null;
}

async function updateAction(ctx: LumeContext, id: string, patch: Record<string, unknown>) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin
    .from("lume_actions" as never)
    .update({ ...patch, decided_at: new Date().toISOString() } as never)
    .eq("id", id)
    .eq("company_id", ctx.companyId)
    .eq("user_id", ctx.userId);
}

export async function handleLumeAction(request: Request): Promise<Response> {
  try {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new LumeError("Pedido inválido.");
    const ctx = await contextFor(request, typeof body.timezone === "string" ? body.timezone : null);
    const decision = body.decision;
    if (decision !== "confirm" && decision !== "cancel" && decision !== "undo")
      throw new LumeError("Decisão inválida.");

    // Com auditoria: tudo vem da ação guardada (id + pessoa + empresa), nunca do pedido.
    // Sem auditoria (antes da migração), não há registro a forjar: a ação roda pelo pedido,
    // sempre com a sessão e as permissões de quem pede.
    const audited = auditEnabled(ctx);
    let tool = String(body.tool ?? "");
    let args =
      body.args && typeof body.args === "object" ? (body.args as Record<string, unknown>) : null;
    let undo: unknown = body.undo;
    let id: string = crypto.randomUUID();
    if (audited) {
      if (typeof body.id !== "string") throw new LumeError("Ação não encontrada.", 404);
      const stored = await storedAction(ctx, body.id);
      if (!stored) throw new LumeError("Ação não encontrada.", 404);
      const expected = decision === "undo" ? ["executada", "confirmada"] : ["pendente"];
      if (!expected.includes(stored.status)) throw new LumeError("Esta ação já foi decidida.", 409);
      id = stored.id;
      tool = stored.tool;
      args = stored.input;
      undo = stored.undo;
    }

    if (decision === "cancel") {
      if (audited) await updateAction(ctx, id, { status: "cancelada" });
      return json({ status: "cancelada" });
    }

    if (decision === "undo") {
      if (!validUndo(undo)) throw new LumeError("Não há o que desfazer.");
      const domain = DOMAINS.find((item) => item.id === "agenda")!;
      await domain.undo(undo, ctx);
      if (audited) await updateAction(ctx, id, { status: "desfeita" });
      return json({ status: "desfeita" });
    }

    const found = findTool(DOMAINS, tool);
    if (!found || !args) throw new LumeError("Ação desconhecida.");
    if (riskOf(found.tool, args) !== "confirm")
      throw new LumeError("Esta ação não precisa de confirmação.");
    const summary = await Promise.resolve(found.tool.summarize(args as never, ctx)).catch(
      () => found.tool.name,
    );
    const result = await found.tool.execute(args as never, ctx);
    const failure = (result.output as { erro?: string } | null)?.erro;
    if (audited)
      await updateAction(ctx, id, {
        status: failure ? "falhou" : "confirmada",
        undo: result.undo ?? null,
        result: result.output ?? null,
        error: failure ?? null,
      });
    if (failure) return json({ status: "falhou", error: failure }, 422);
    return json({
      status: "confirmada",
      summary,
      undo: result.undo ?? null,
      touched: result.touched ?? [],
      output: result.output,
    });
  } catch (error) {
    return fail(error);
  }
}

export async function handleLumeStatus(request: Request): Promise<Response> {
  try {
    const ctx = await contextFor(request);
    return json({ ...lumeReadiness(), agenda: { extended: ctx.extended } });
  } catch (error) {
    return fail(error);
  }
}
