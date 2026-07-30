// ============================================================================
// Scientific Knowledge Engine — Testes de garantia (Fase 3)
// Valida: regras determinísticas de validação, ausência de LLM, ausência de
// escrita (INSERT/UPDATE/DELETE/UPSERT), ausência de acesso ao CRM/mensagens
// e ausência de PII nos modelos públicos.
// ============================================================================

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  SCIENCE_THRESHOLDS,
  buildProvenanceKey,
  type ScientificEvidence,
  type ScientificHypothesis,
} from "../ScientificKnowledgeTypes";
import { ScientificValidationEngine } from "../ScientificValidationEngine.server";

const LAYER_DIR = join(process.cwd(), "src/lib/scientific-knowledge");

function layerFiles(): { name: string; src: string }[] {
  return readdirSync(LAYER_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((name) => ({ name, src: readFileSync(join(LAYER_DIR, name), "utf8") }));
}

function makeHypothesis(
  over: Partial<ScientificHypothesis> & { title: string },
): ScientificHypothesis {
  const pk = over.provenanceKey ?? buildProvenanceKey("objection", over.title);
  return {
    id: `hy-${pk}`,
    category: "objection",
    title: over.title,
    description: `desc ${over.title}`,
    confidence: 0.8,
    occurrences: 6,
    firstObserved: "2026-07-01T00:00:00.000Z",
    lastObserved: "2026-07-10T00:00:00.000Z",
    distinctDays: 4,
    supportingEvidence: [`ev-${pk}`],
    status: "observed",
    provenanceKey: pk,
    contradictionDetected: false,
    ...over,
  };
}

function makeEvidence(
  h: ScientificHypothesis,
  over: Partial<ScientificEvidence> = {},
): ScientificEvidence {
  return {
    id: `ev-${h.provenanceKey}`,
    hypothesisId: h.id,
    provenanceKey: h.provenanceKey,
    sourceFingerprint: `sf-${h.provenanceKey}`,
    metrics: ["occurrences"],
    sources: ["business_brain:pattern"],
    sampleSize: h.occurrences,
    distinctDays: h.distinctDays,
    confidence: h.confidence,
    ...over,
  };
}

const NOW = "2026-07-30T00:00:00.000Z";

describe("ScientificValidationEngine — regras determinísticas", () => {
  it("não promove hipótese a validated sem histórico de snapshots suficiente", () => {
    const h = makeHypothesis({ title: "Preco alto trava fechamento" });
    const res = ScientificValidationEngine.run({
      hypotheses: [h],
      evidence: [makeEvidence(h)],
      distinctSnapshotDays: 1,
      now: NOW,
    });
    expect(res.hypotheses[0].status).not.toBe("validated");
    expect(res.validatedKnowledge).toHaveLength(0);
  });

  it("não promove a validated com ocorrência única", () => {
    const h = makeHypothesis({
      title: "Sinal isolado",
      occurrences: 1,
      distinctDays: 1,
    });
    const res = ScientificValidationEngine.run({
      hypotheses: [h],
      evidence: [makeEvidence(h)],
      distinctSnapshotDays: 10,
      now: NOW,
    });
    expect(res.hypotheses[0].status).toBe("observed");
    expect(res.validatedKnowledge).toHaveLength(0);
  });

  it("promove a validated apenas com recorrência + dias distintos + confiança + histórico", () => {
    const h = makeHypothesis({ title: "Objecao de prazo recorrente" });
    const res = ScientificValidationEngine.run({
      hypotheses: [h],
      evidence: [makeEvidence(h)],
      distinctSnapshotDays: SCIENCE_THRESHOLDS.MIN_HISTORY_SNAPSHOT_DAYS_FOR_VALIDATED,
      now: NOW,
    });
    expect(res.hypotheses[0].status).toBe("validated");
    expect(res.validatedKnowledge).toHaveLength(1);
    const k = res.validatedKnowledge[0];
    expect(k.status).toBe("validated");
    expect(k.scientificScore).toBeGreaterThan(0);
    expect(k.supportingHypotheses).toEqual([h.id]);
  });

  it("marca weakening quando a confiança agregada cai", () => {
    const h = makeHypothesis({ title: "Hipotese enfraquecendo" });
    const res = ScientificValidationEngine.run({
      hypotheses: [h],
      evidence: [makeEvidence(h, { confidence: 0.15 })],
      distinctSnapshotDays: 10,
      now: NOW,
    });
    expect(res.hypotheses[0].status).toBe("weakening");
  });

  it("é determinístico: mesma entrada → mesma saída", () => {
    const h = makeHypothesis({ title: "Determinismo" });
    const input = {
      hypotheses: [h],
      evidence: [makeEvidence(h)],
      distinctSnapshotDays: 5,
      now: NOW,
    };
    expect(ScientificValidationEngine.run(input)).toEqual(
      ScientificValidationEngine.run(input),
    );
  });
});

describe("Garantias estruturais da camada científica", () => {
  it("não executa nenhuma escrita no banco", () => {
    for (const { name, src } of layerFiles()) {
      expect(src, name).not.toMatch(/\.(insert|update|delete|upsert)\s*\(/);
    }
  });

  it("não utiliza LLM nem gateways de IA generativa", () => {
    for (const { name, src } of layerFiles()) {
      expect(src, name).not.toMatch(/openai|gemini|anthropic|ai\.gateway|generateText/i);
    }
  });

  it("não acessa tabelas operacionais (CRM, mensagens, campanhas)", () => {
    const forbidden = [
      "leads",
      "messages",
      "conversations",
      "conversation_facts",
      "quotes",
      "campaigns",
      "follow_ups",
      "whatsapp_messages",
    ];
    for (const { name, src } of layerFiles()) {
      for (const t of forbidden) {
        expect(src, `${name} → from("${t}")`).not.toContain(`from("${t}")`);
      }
    }
  });

  it("consome apenas Business Brain, Business Learning e Executive Knowledge", () => {
    const service = readFileSync(
      join(LAYER_DIR, "ScientificKnowledgeService.server.ts"),
      "utf8",
    );
    const imports = [...service.matchAll(/from "(@\/lib\/[^"]+)"/g)].map((m) => m[1]);
    for (const imp of imports) {
      expect(imp).toMatch(
        /^@\/lib\/(business-brain|business-learning|executive-knowledge|executive-ai)\//,
      );
    }
  });

  it("nenhum agente operacional consome a camada científica nesta fase", () => {
    // Apenas o próprio módulo, a persistência científica e as rotas de leitura.
    const src = readdirSync(join(process.cwd(), "src/lib"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .filter(
        (d) =>
          !d.startsWith("scientific-") &&
          ["coach", "inbox", "marketing", "outbound", "runtime", "followup"].includes(d),
      );
    for (const dir of src) {
      const base = join(process.cwd(), "src/lib", dir);
      const walk = (p: string): string[] =>
        readdirSync(p, { withFileTypes: true }).flatMap((d) =>
          d.isDirectory()
            ? walk(join(p, d.name))
            : d.name.endsWith(".ts") || d.name.endsWith(".tsx")
              ? [join(p, d.name)]
              : [],
        );
      for (const file of walk(base)) {
        expect(readFileSync(file, "utf8"), file).not.toContain(
          "@/lib/scientific-knowledge/",
        );
      }
    }
  });

  it("modelos públicos não expõem PII", () => {
    const types = readFileSync(join(LAYER_DIR, "ScientificKnowledgeTypes.ts"), "utf8");
    for (const field of [
      "phone",
      "email",
      "customerName",
      "leadId",
      "messageId",
      "conversationId",
    ]) {
      expect(types).not.toContain(field);
    }
  });
});
