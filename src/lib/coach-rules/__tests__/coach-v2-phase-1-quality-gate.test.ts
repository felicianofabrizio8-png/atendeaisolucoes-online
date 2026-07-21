// Coach V2 — Fase 1.1b Quality Gate.
// Cobertura em três camadas, todas READ-ONLY:
//   1) Contratos estáticos (arquivos: migrations, repository, rota, rollback).
//   2) Isolamento do agente (grep no src/).
//   3) Estado real do banco via psql (ACLs, RLS, schema, triggers) — sem escrita.
//
// Os testes de banco só rodam se PGHOST estiver disponível no ambiente
// (sandbox Lovable). Em qualquer outro ambiente, esses casos são marcados
// como skip para não falharem a suíte por ausência do bind PG.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const MIG_DIR = join(ROOT, "supabase/migrations");
const REPO_PATH = join(ROOT, "src/lib/coach-rules/coach-rules.repository.ts");
const ROUTE_PATH = join(ROOT, "src/routes/configuracoes_.regras-coach.tsx");
const ROLLBACK_PATH = join(ROOT, "docs/coach-v2-phase-1-rollback.md");

function findMigration(needle: RegExp): string {
  const file = readdirSync(MIG_DIR).find((f) => {
    if (!f.endsWith(".sql")) return false;
    return needle.test(readFileSync(join(MIG_DIR, f), "utf8"));
  });
  if (!file) throw new Error(`Migration não encontrada para ${needle}`);
  return readFileSync(join(MIG_DIR, file), "utf8");
}

function psql(sql: string): string {
  return execFileSync("psql", ["-A", "-t", "-F", "|", "-c", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

const HAS_PG = !!process.env.PGHOST;
const dbIt = HAS_PG ? it : it.skip;

const ADMIN_RPCS = [
  "create_coach_rule_draft",
  "create_coach_rule_version",
  "submit_coach_rule_version",
  "approve_coach_rule_version",
  "reject_coach_rule_version",
  "activate_coach_rule_version",
  "pause_coach_rule",
  "archive_coach_rule",
  "replace_coach_rule",
] as const;

const OWNER_ONLY_HELPERS = [
  "coach_assert_admin",
  "coach_content_hash",
  "coach_is_critical_category",
] as const;

const COACH_TABLES = [
  "coach_rules",
  "coach_rule_versions",
  "coach_rule_conflicts",
  "coach_rule_events",
] as const;

// ============================================================
// 1) MIGRATIONS — contratos estáticos
// ============================================================
describe("Coach V2 · Migrations · Fase 1 (fundação)", () => {
  const sql = findMigration(/CREATE TABLE public\.coach_rules/);

  it("cria as 4 tabelas coach_*", () => {
    for (const t of COACH_TABLES) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE public\\.${t}`));
    }
  });

  it("habilita RLS em cada tabela", () => {
    for (const t of COACH_TABLES) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`));
    }
  });

  it("apenas policies SELECT para authenticated (sem INSERT/UPDATE/DELETE de cliente)", () => {
    // Só policies SELECT devem existir; escritas passam por RPC.
    for (const t of COACH_TABLES) {
      const forInsert = new RegExp(`CREATE POLICY[^;]+ON public\\.${t}[^;]+FOR INSERT`, "i");
      const forUpdate = new RegExp(`CREATE POLICY[^;]+ON public\\.${t}[^;]+FOR UPDATE`, "i");
      const forDelete = new RegExp(`CREATE POLICY[^;]+ON public\\.${t}[^;]+FOR DELETE`, "i");
      expect(sql).not.toMatch(forInsert);
      expect(sql).not.toMatch(forUpdate);
      expect(sql).not.toMatch(forDelete);
    }
  });

  it("declara as 9 RPCs administrativas", () => {
    for (const rpc of ADMIN_RPCS) {
      expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${rpc}\\b`));
    }
  });
});

describe("Coach V2 · Migrations · Fase 1.1a (hardening)", () => {
  const sql = findMigration(/COACH V2 — FASE 1\.1 HARDENING/);

  it("REVOKE PUBLIC + REVOKE anon + GRANT authenticated para cada RPC admin", () => {
    for (const rpc of ADMIN_RPCS) {
      const rev = new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}\\b[^;]*FROM PUBLIC`, "i");
      const revAnon = new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}\\b[^;]*FROM anon`, "i");
      const grant = new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}\\b[^;]*TO authenticated`, "i");
      expect(sql, `REVOKE PUBLIC ${rpc}`).toMatch(rev);
      expect(sql, `REVOKE anon ${rpc}`).toMatch(revAnon);
      expect(sql, `GRANT authenticated ${rpc}`).toMatch(grant);
    }
  });

  it("adiciona UNIQUE (id, company_id) em coach_rules e (id, rule_id, company_id) em coach_rule_versions", () => {
    expect(sql).toMatch(/coach_rules_id_company_uniq[\s\S]*UNIQUE\s*\(\s*id\s*,\s*company_id\s*\)/i);
    expect(sql).toMatch(
      /coach_rule_versions_id_rule_company_uniq[\s\S]*UNIQUE\s*\(\s*id\s*,\s*rule_id\s*,\s*company_id\s*\)/i,
    );
  });

  it("substitui FK simples por FK composta rule_id+company_id", () => {
    expect(sql).toMatch(/coach_rule_versions_rule_company_fk[\s\S]*FOREIGN KEY \(rule_id, company_id\)/i);
    expect(sql).toMatch(/REFERENCES public\.coach_rules\(id, company_id\)/i);
  });

  it("FK composta de active_version_id impede apontar para versão de outra regra/empresa", () => {
    expect(sql).toMatch(/coach_rules_active_version_composite_fk/i);
    expect(sql).toMatch(/FOREIGN KEY \(active_version_id, id, company_id\)/i);
    expect(sql).toMatch(/REFERENCES public\.coach_rule_versions\(id, rule_id, company_id\)/i);
  });

  it("instala trigger de imutabilidade de company_id nas 3 tabelas mutáveis", () => {
    expect(sql).toMatch(/coach_prevent_company_change/);
    expect(sql).toMatch(/trg_coach_rules_company_immutable[\s\S]*coach_rules/i);
    expect(sql).toMatch(/trg_coach_rule_versions_company_immutable[\s\S]*coach_rule_versions/i);
    expect(sql).toMatch(/trg_coach_rule_conflicts_company_immutable[\s\S]*coach_rule_conflicts/i);
  });

  it("documenta coach_rule_conflicts como reservada via COMMENT ON", () => {
    expect(sql).toMatch(/COMMENT ON TABLE public\.coach_rule_conflicts/i);
  });

  it("bloco de validação defensiva aborta se dados existentes forem inconsistentes", () => {
    expect(sql).toMatch(/coach_hardening_abort/);
    expect(sql).toMatch(/company_id divergente/i);
    expect(sql).toMatch(/active_version_id inconsistente/i);
  });
});

// ============================================================
// 2) REPOSITORY — contrato de chamadas
// ============================================================
describe("Coach V2 · Repository · contrato", () => {
  const src = readFileSync(REPO_PATH, "utf8");

  it("nunca aceita company_id vindo da UI", () => {
    expect(src).not.toMatch(/company_id\s*[:?]/i);
    expect(src).not.toMatch(/_company_id\s*:/);
  });

  it("chama exatamente as 9 RPCs administrativas por nome", () => {
    for (const rpc of ADMIN_RPCS) {
      expect(src).toMatch(new RegExp(`\\.rpc\\("${rpc}"`));
    }
  });

  it("propaga erros do Supabase em toda RPC", () => {
    // heurística: cada chamada .rpc(...) tem um `if (error) throw error;` próximo.
    const rpcCalls = src.match(/\.rpc\("[a-z_]+"/g) ?? [];
    const throws = src.match(/if\s*\(\s*error\s*\)\s*throw\s+error/g) ?? [];
    expect(throws.length).toBeGreaterThanOrEqual(rpcCalls.length);
  });

  it("payload de aprovação transporta critical_confirmed", () => {
    expect(src).toMatch(/approve_coach_rule_version[\s\S]{0,400}_critical_confirmed:\s*criticalConfirmed/);
  });

  it("leitura de eventos aplica limite de 200", () => {
    expect(src).toMatch(/coach_rule_events[\s\S]{0,300}\.limit\(200\)/);
  });

  it("ordenação: regras por created_at desc, versões por version_number desc", () => {
    expect(src).toMatch(/coach_rules[\s\S]{0,300}order\("created_at",\s*\{\s*ascending:\s*false\s*\}\)/);
    expect(src).toMatch(/coach_rule_versions[\s\S]{0,300}order\("version_number",\s*\{\s*ascending:\s*false\s*\}\)/);
  });
});

// ============================================================
// 3) ROTA ADMINISTRATIVA — garantias de superfície
// ============================================================
describe("Coach V2 · Rota administrativa", () => {
  const src = readFileSync(ROUTE_PATH, "utf8");

  it("define errorComponent no createFileRoute", () => {
    expect(src).toMatch(/errorComponent\s*:\s*\(/);
  });

  it("marca noindex/nofollow para não ser indexada", () => {
    expect(src).toMatch(/noindex\s*,\s*nofollow/);
  });

  it("não é referenciada pelo CoachPanel do inbox", () => {
    const panel = readFileSync(join(ROOT, "src/components/coach/CoachPanel.tsx"), "utf8");
    expect(panel).not.toMatch(/regras-coach/);
    expect(panel).not.toMatch(/coach_rules/);
  });
});

// ============================================================
// 4) ISOLAMENTO DO AGENTE — grep-based
// ============================================================
describe("Coach V2 · Isolamento do agente (dark implementation)", () => {
  it("nenhum consumidor fora do repository e da rota admin", () => {
    const out = execFileSync(
      "bash",
      [
        "-lc",
        "grep -rn -E 'coach_rules|coach_rule_versions|coach_rule_events|coach_rule_conflicts' src/ --include='*.ts' --include='*.tsx' | grep -v '__tests__' | grep -v 'integrations/supabase/types' | awk -F: '{print $1}' | sort -u || true",
      ],
      { encoding: "utf8" },
    ).trim();
    const files = out.split("\n").filter(Boolean);
    const allowed = new Set([
      "src/lib/coach-rules/coach-rules.repository.ts",
      "src/routes/configuracoes_.regras-coach.tsx",
    ]);
    for (const f of files) {
      expect(allowed.has(f), `consumidor não autorizado: ${f}`).toBe(true);
    }
  });

  it("ai-agent.server.ts não lê tabelas coach_*", () => {
    const p = join(ROOT, "src/lib/ai-agent.server.ts");
    if (!existsSync(p)) return;
    const s = readFileSync(p, "utf8");
    expect(s).not.toMatch(/coach_rules|coach_rule_versions|coach_rule_events|coach_rule_conflicts/);
  });
});

// ============================================================
// 5) ROLLBACK DOC
// ============================================================
describe("Coach V2 · Rollback documentado", () => {
  const doc = readFileSync(ROLLBACK_PATH, "utf8");

  it("cita as duas migrations envolvidas", () => {
    expect(doc).toMatch(/20260721105324/);
    expect(doc).toMatch(/Fase 1\.1/);
  });

  it("inclui bloco de pré-condição de backup", () => {
    expect(doc).toMatch(/pg_dump/i);
  });

  it("orienta remoção sem CASCADE e menciona ordem triggers→funções→tabelas→types", () => {
    // Documento é humano — checamos palavras-chave estruturantes.
    expect(doc).toMatch(/trigger/i);
    expect(doc).toMatch(/DROP FUNCTION|DROP TRIGGER|DROP TABLE/);
  });
});

// ============================================================
// 6) ACLs REAIS via psql (read-only)
// ============================================================
describe("Coach V2 · ACLs efetivas no banco", () => {
  dbIt("cada RPC admin: anon=false, authenticated=true, service_role=true", () => {
    const rows = psql(
      `SELECT p.proname,
              has_function_privilege('anon', p.oid, 'EXECUTE'),
              has_function_privilege('authenticated', p.oid, 'EXECUTE'),
              has_function_privilege('service_role', p.oid, 'EXECUTE')
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname = ANY(ARRAY[${ADMIN_RPCS.map((r) => `'${r}'`).join(",")}])
        ORDER BY p.proname`,
    );
    const parsed = rows.split("\n").map((l) => l.split("|"));
    const seen = new Set<string>();
    for (const [name, anonExec, authExec, srvExec] of parsed) {
      seen.add(name);
      expect(anonExec, `${name}: anon deveria ser false`).toBe("f");
      expect(authExec, `${name}: authenticated deveria ser true`).toBe("t");
      expect(srvExec, `${name}: service_role deveria ser true`).toBe("t");
    }
    for (const rpc of ADMIN_RPCS) expect(seen.has(rpc), `RPC ausente: ${rpc}`).toBe(true);
  });

  dbIt("helpers internos: anon=false, authenticated=false, service_role=true", () => {
    const rows = psql(
      `SELECT p.proname,
              has_function_privilege('anon', p.oid, 'EXECUTE'),
              has_function_privilege('authenticated', p.oid, 'EXECUTE'),
              has_function_privilege('service_role', p.oid, 'EXECUTE')
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname = ANY(ARRAY[${OWNER_ONLY_HELPERS.map((r) => `'${r}'`).join(",")}])
        ORDER BY p.proname`,
    );
    for (const line of rows.split("\n")) {
      const [name, a, au, sv] = line.split("|");
      expect(a, `${name}: anon`).toBe("f");
      expect(au, `${name}: authenticated`).toBe("f");
      expect(sv, `${name}: service_role`).toBe("t");
    }
  });

  dbIt("coach_validate_scope_ref: authenticated=true (necessário para CHECK constraint)", () => {
    const row = psql(
      `SELECT has_function_privilege('authenticated', 'public.coach_validate_scope_ref(public.coach_rule_scope_kind, jsonb)', 'EXECUTE')`,
    );
    expect(row).toBe("t");
  });
});

// ============================================================
// 7) SCHEMA / RLS / CONSTRAINTS / TRIGGERS reais
// ============================================================
describe("Coach V2 · Estado real do schema", () => {
  dbIt("as 4 tabelas existem com RLS habilitada", () => {
    const rows = psql(
      `SELECT tablename, rowsecurity FROM pg_tables
        WHERE schemaname='public' AND tablename IN (${COACH_TABLES.map((t) => `'${t}'`).join(",")})`,
    );
    const map = new Map(rows.split("\n").map((l) => l.split("|") as [string, string]));
    for (const t of COACH_TABLES) {
      expect(map.get(t), `${t} deveria existir`).toBeDefined();
      expect(map.get(t), `${t} sem RLS`).toBe("t");
    }
  });

  dbIt("apenas policies SELECT para authenticated nas 4 tabelas", () => {
    const rows = psql(
      `SELECT tablename, cmd FROM pg_policies
        WHERE schemaname='public' AND tablename IN (${COACH_TABLES.map((t) => `'${t}'`).join(",")})`,
    );
    for (const line of rows.split("\n").filter(Boolean)) {
      const [, cmd] = line.split("|");
      expect(cmd, `policy não-SELECT detectada: ${line}`).toBe("SELECT");
    }
  });

  dbIt("constraints UNIQUE compostas presentes", () => {
    const out = psql(
      `SELECT conname FROM pg_constraint
        WHERE conname IN ('coach_rules_id_company_uniq','coach_rule_versions_id_rule_company_uniq')
        ORDER BY conname`,
    );
    expect(out).toContain("coach_rules_id_company_uniq");
    expect(out).toContain("coach_rule_versions_id_rule_company_uniq");
  });

  dbIt("FKs compostas presentes com definições exatas", () => {
    const out = psql(
      `SELECT conname||'::'||pg_get_constraintdef(oid) FROM pg_constraint
        WHERE conname IN ('coach_rule_versions_rule_company_fk','coach_rules_active_version_composite_fk')`,
    );
    expect(out).toMatch(/coach_rule_versions_rule_company_fk::FOREIGN KEY \(rule_id, company_id\) REFERENCES coach_rules\(id, company_id\)/);
    expect(out).toMatch(/coach_rules_active_version_composite_fk::FOREIGN KEY \(active_version_id, id, company_id\) REFERENCES coach_rule_versions\(id, rule_id, company_id\)/);
  });

  dbIt("triggers de imutabilidade de company_id nas 3 tabelas", () => {
    const out = psql(
      `SELECT event_object_table||'::'||trigger_name FROM information_schema.triggers
        WHERE event_object_schema='public'
          AND trigger_name IN ('trg_coach_rules_company_immutable','trg_coach_rule_versions_company_immutable','trg_coach_rule_conflicts_company_immutable')`,
    );
    expect(out).toContain("coach_rules::trg_coach_rules_company_immutable");
    expect(out).toContain("coach_rule_versions::trg_coach_rule_versions_company_immutable");
    expect(out).toContain("coach_rule_conflicts::trg_coach_rule_conflicts_company_immutable");
  });

  dbIt("triggers append-only bloqueiam UPDATE e DELETE em coach_rule_events", () => {
    const out = psql(
      `SELECT trigger_name||'::'||event_manipulation FROM information_schema.triggers
        WHERE event_object_schema='public' AND event_object_table='coach_rule_events'`,
    );
    expect(out).toContain("trg_coach_rule_events_no_update::UPDATE");
    expect(out).toContain("trg_coach_rule_events_no_delete::DELETE");
  });
});
