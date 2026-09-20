import { createClient } from "@supabase/supabase-js";

const MODES = new Set(["off", "silent", "assisted", "automatic"]);
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

function usageError(message) {
  throw new Error(
    `${message}. Uso: npm run audit:vendedora -- --company-id <id> [--mode off|silent|assisted|automatic] [--conversation-id <id>] [--errors] [--limit <n>] [--follow]`,
  );
}

function parseArgs(argv) {
  const out = {
    mode: null,
    companyId: null,
    conversationId: null,
    errors: false,
    limit: DEFAULT_LIMIT,
    follow: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--errors" || arg === "--follow") {
      out[arg.slice(2)] = true;
      continue;
    }
    const key = arg.startsWith("--") ? arg.slice(2) : "";
    if (!["mode", "company-id", "conversation-id", "limit"].includes(key))
      usageError(`filtro desconhecido: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) usageError(`valor ausente para ${arg}`);
    index += 1;
    if (key === "mode") out.mode = value;
    else if (key === "company-id") out.companyId = value;
    else if (key === "conversation-id") out.conversationId = value;
    else out.limit = Number(value);
  }
  if (!out.companyId?.trim()) usageError("--company-id é obrigatório");
  if (out.mode !== null && !MODES.has(out.mode)) usageError(`modo inválido: ${out.mode}`);
  if (!Number.isInteger(out.limit) || out.limit < 1 || out.limit > MAX_LIMIT)
    usageError(`--limit deve estar entre 1 e ${MAX_LIMIT}`);
  return out;
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`variável obrigatória ausente: ${name}`);
  return value;
}

function mask(value) {
  const text = String(value ?? "");
  if (text.length <= 8) return "***";
  return `${text.slice(0, 4)}…${text.slice(-4)}`;
}

function safeValue(value, fallback = "-") {
  const text = String(value ?? "")
    .replace(/[^a-zA-Z0-9_.:\/-]/g, "_")
    .slice(0, 120);
  return text || fallback;
}

function auditPayload(row) {
  const payload = row?.payload;
  if (!payload || typeof payload !== "object" || payload.audit_kind !== "sales_agent_v2")
    return null;
  return payload;
}

function isError(payload) {
  return payload.decision === "error" || Boolean(payload.blocked);
}

function formatRow(row) {
  const payload = auditPayload(row);
  if (!payload) return null;
  const products = Array.isArray(payload.product_ids)
    ? payload.product_ids.map((id) => safeValue(id)).join(",")
    : "-";
  const tools = Array.isArray(payload.tools)
    ? payload.tools.map((tool) => safeValue(tool)).join(",")
    : "-";
  return [
    row.created_at ?? "-",
    `mode=${safeValue(payload.mode)}`,
    `decision=${safeValue(payload.decision)}`,
    `product=${products || "-"}`,
    `tools=${tools || "-"}`,
    `result=${safeValue(payload.result)}`,
    `blocked=${safeValue(payload.blocked)}`,
    `latency_ms=${safeValue(payload.latency_ms)}`,
    `tokens_available=${payload.tokens_available === null || payload.tokens_available === undefined ? "unknown" : safeValue(payload.tokens_available)}`,
    `conversation=${mask(row.conversation_id)}`,
  ].join(" | ");
}

async function readRows(sb, filters) {
  let query = sb
    .from("ai_flow_events")
    .select("created_at, conversation_id, payload")
    .eq("company_id", filters.companyId)
    .eq("event_type", "ai_flow_step")
    .order("created_at", { ascending: false })
    .limit(Math.min(MAX_LIMIT, filters.limit * 4));
  if (filters.conversationId) query = query.eq("conversation_id", filters.conversationId);
  const { data, error } = await query;
  if (error)
    throw new Error(`consulta de auditoria falhou: ${safeValue(error.code, "query_error")}`);
  return (data ?? [])
    .filter((row) => auditPayload(row))
    .filter((row) => filters.mode === null || auditPayload(row).mode === filters.mode)
    .filter((row) => !filters.errors || isError(auditPayload(row)))
    .slice(0, filters.limit);
}

function printRows(rows, seen) {
  for (const row of [...rows].reverse()) {
    const key = `${row.created_at}:${row.conversation_id ?? ""}:${JSON.stringify(row.payload)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const line = formatRow(row);
    if (line) console.log(line);
  }
}

const filters = parseArgs(process.argv.slice(2));
const sb = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});
const seen = new Set();

async function run() {
  do {
    const rows = await readRows(sb, filters);
    printRows(rows, seen);
    if (!filters.follow) break;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } while (true);
}

run().catch((error) => {
  console.error(
    `[sales-agent:audit] ${error instanceof Error ? error.message : "erro desconhecido"}`,
  );
  process.exitCode = 1;
});
