// ============================================================================
// Sprint 7 — Fase 7.2
// Testes de equivalência das primitivas consolidadas e de não-regressão
// estrutural (órfãos removidos, fachadas preservadas, sem ciclos).
// ============================================================================

import { describe, it, expect } from "vitest";
import { timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { correlationId } from "@/lib/shared/correlation";
import { safeEqualSecret } from "@/lib/shared/secure-compare.server";
import * as hookSecurity from "@/lib/runtime/HookSecurity.server";
import * as renderApiAuth from "@/lib/render-engine/RenderApiAuth.server";

// Implementação de referência: cópia literal do código que existia
// duplicado antes da consolidação. Serve de oráculo de equivalência.
function legacySafeEqualSecret(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

describe("primitiva compartilhada: safeEqualSecret", () => {
  const cases: Array<[string, string]> = [
    ["", ""],
    ["", "b"],
    ["a", ""],
    ["a", "b"],
    ["abc", "abcd"],
    ["s".repeat(64), "s".repeat(64)],
    ["ç-acentuado-ü", "ç-acentuado-ü"],
    ["ç-acentuado-ü", "c-acentuado-u"],
  ];

  it("é equivalente à implementação legada em todos os casos", () => {
    for (const [a, b] of cases) {
      expect(safeEqualSecret(a, b)).toBe(legacySafeEqualSecret(a, b));
    }
  });

  it("mantém o contrato: true apenas para valores idênticos e não vazios", () => {
    expect(safeEqualSecret("segredo-muito-longo-123456", "segredo-muito-longo-123456")).toBe(true);
    expect(safeEqualSecret("segredo-muito-longo-123456", "segredo-muito-longo-123457")).toBe(false);
    expect(safeEqualSecret("", "")).toBe(false);
  });

  it("fachadas legadas reexportam exatamente a mesma função", () => {
    expect(hookSecurity.safeEqualSecret).toBe(safeEqualSecret);
    expect(renderApiAuth.safeEqualSecret).toBe(safeEqualSecret);
  });
});

describe("primitiva compartilhada: correlationId", () => {
  it("preserva o formato <base36>-<8 chars>", () => {
    for (let i = 0; i < 50; i++) {
      const id = correlationId();
      expect(id).toMatch(/^[0-9a-z]+-[0-9a-z]{1,8}$/);
      expect(id.split("-")).toHaveLength(2);
    }
  });

  it("é razoavelmente único", () => {
    const set = new Set(Array.from({ length: 500 }, () => correlationId()));
    expect(set.size).toBeGreaterThan(495);
  });

  it("fachadas legadas reexportam exatamente a mesma função", () => {
    expect(hookSecurity.correlationId).toBe(correlationId);
    expect(renderApiAuth.correlationId).toBe(correlationId);
  });
});

// ---------------------------------------------------------------------------
// Quality gate: impede reintrodução acidental de módulos já substituídos e
// re-duplicação das primitivas consolidadas.
// ---------------------------------------------------------------------------

const SRC = path.resolve(process.cwd(), "src");

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

describe("quality gate estrutural", () => {
  const files = walk(SRC).filter((f) => !/__tests__/.test(f.replace(/\\/g, "/")));

  it("o módulo órfão src/lib/meta-sync.ts não existe mais", () => {
    expect(fs.existsSync(path.join(SRC, "lib", "meta-sync.ts"))).toBe(false);
  });

  it("nenhum arquivo importa o módulo removido @/lib/meta-sync", () => {
    const offenders = files.filter((f) =>
      /from\s+["'](@\/lib\/meta-sync|\.\.?\/meta-sync)["']/.test(fs.readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("safeEqualSecret tem uma única implementação em src/", () => {
    const impls = files.filter((f) =>
      /export function safeEqualSecret/.test(fs.readFileSync(f, "utf8")),
    );
    expect(impls.map((f) => path.relative(SRC, f))).toEqual(["lib/shared/secure-compare.server.ts"]);
  });

  it("correlationId tem uma única implementação em src/", () => {
    const impls = files.filter((f) =>
      /function correlationId\(\): string/.test(fs.readFileSync(f, "utf8")),
    );
    expect(impls.map((f) => path.relative(SRC, f))).toEqual(["lib/shared/correlation.ts"]);
  });

  it("o módulo client-safe de correlação não importa nada server-only", () => {
    const source = fs.readFileSync(path.join(SRC, "lib", "shared", "correlation.ts"), "utf8");
    expect(source).not.toMatch(/from\s+["'](node:|crypto|fs|@\/integrations)/);
  });

  it("componentes extraídos nunca importam a rota (sem dependência reversa)", () => {
    const extracted = files.filter((f) =>
      /src\/components\/(orcamentos|configuracoes)\//.test(f.replace(/\\/g, "/")),
    );
    expect(extracted.length).toBeGreaterThan(0);
    for (const f of extracted) {
      expect(fs.readFileSync(f, "utf8")).not.toMatch(/from\s+["'][^"']*routes\//);
    }
  });
});
