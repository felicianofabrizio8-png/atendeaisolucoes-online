// Guarda: todo event_type que o follow-up grava em ai_flow_events precisa
// estar no CHECK da tabela. Sem isso o insert falha em silêncio (o código não
// trata o erro) e a trilha operacional some — foi o que aconteceu até a
// migration 20260928120000.
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

/** Lista do CHECK na migration mais recente que o (re)define. */
function allowedEventTypes(): string[] {
  const dir = resolve(ROOT, "supabase/migrations");
  const latest = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) =>
      /ADD CONSTRAINT ai_flow_events_event_type_check|CONSTRAINT ai_flow_events_event_type_check CHECK/.test(
        read(`supabase/migrations/${f}`),
      ),
    )
    .at(-1)!;
  const sql = read(`supabase/migrations/${latest}`);
  const check = sql.slice(sql.lastIndexOf("ai_flow_events_event_type_check"));
  return [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

/** Literais do bloco que calcula o event_type em dispatch.ts. */
function dispatchEvents(): string[] {
  const src = read("src/lib/followup/dispatch.ts");
  const block = src.slice(
    src.indexOf("const eventType ="),
    src.indexOf('await supabaseAdmin.from("ai_flow_events")'),
  );
  return [...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).filter((v) => v.includes("_"));
}

function reconcileEvents(): string[] {
  // `event_type: status === "recovered" ? "lead_recovered" : "followup_responded"`
  // — só os resultados do ternário são eventos.
  const line = read("src/lib/followup/reconcile.ts").match(/event_type:[^\n]+/)![0];
  return [...line.matchAll(/[?:]\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

/** Definição vigente (a última migration que recria) da função do trigger. */
function triggerEvents(): string[] {
  const latest = readdirSync(resolve(ROOT, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) =>
      /CREATE OR REPLACE FUNCTION public\.cancel_pending_followups_on_reply/.test(
        read(`supabase/migrations/${f}`),
      ),
    )
    .at(-1)!;
  const sql = read(`supabase/migrations/${latest}`);
  const fn = sql.slice(sql.indexOf("cancel_pending_followups_on_reply()"));
  return [...fn.matchAll(/INSERT INTO public\.ai_flow_events[\s\S]*?'([a-z_]+)'/g)].map(
    (m) => m[1],
  );
}

describe("ai_flow_events.event_type × eventos do follow-up", () => {
  it("o código emite exatamente os eventos esperados", () => {
    expect(dispatchEvents().sort()).toEqual(
      ["followup_failed", "followup_sent", "followup_simulated", "template_missing"].sort(),
    );
    expect(reconcileEvents().sort()).toEqual(["followup_responded", "lead_recovered"]);
    expect(triggerEvents()).toEqual(["followup_auto_cancelled"]);
  });

  it("todos estão liberados no CHECK vigente", () => {
    const allowed = allowedEventTypes();
    for (const e of [...dispatchEvents(), ...reconcileEvents(), ...triggerEvents()]) {
      expect(allowed, e).toContain(e);
    }
  });

  it("a ampliação não removeu nenhum tipo que já era aceito", () => {
    const allowed = allowedEventTypes();
    for (const e of [
      "auto_reply_sent",
      "handoff_human",
      "detected_city",
      "detected_pool_size",
      "detected_intent",
      "ai_flow_step",
      "safety_block",
      "skipped_business_hours",
      "skipped_human_active",
      "skipped_disabled",
      "skipped_rate_limit",
      "agent_error",
      "trigger_enqueued",
    ]) {
      expect(allowed, e).toContain(e);
    }
    expect(allowed).toHaveLength(20);
  });
});
