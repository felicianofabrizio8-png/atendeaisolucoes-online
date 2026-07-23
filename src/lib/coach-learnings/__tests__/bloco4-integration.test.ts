// BLOCO 4 — Integração das novas RPCs (similaridade, restore, telemetria,
// concorrência otimista). Fake SupabaseClient que espelha o contrato do banco.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  createCoachLearning,
  findSimilarCoachLearning,
  recordCoachLearningRetrieval,
  restoreCoachLearningVersion,
  updateCoachLearningRpc,
} from "../coach-learnings.repository";
import {
  classifyByScore,
  decideSaveGate,
  normalizeForHashPreview,
  SIMILARITY_THRESHOLDS,
  type SimilarCandidate,
} from "../similarity";

// ---------------------------------------------------------------------------
// Fake in-memory backend com RPCs necessárias ao BLOCO 4.
// ---------------------------------------------------------------------------
interface StoredLearning {
  id: string;
  company_id: string;
  category: string;
  product_ref: string | null;
  title: string;
  description: string;
  rule_structured: string;
  positive_example: string | null;
  negative_example: string | null;
  priority: number;
  status: string;
  confidence: number;
  version: number;
  content_hash: string;
  updated_at: string;
}

interface StoredVersion {
  id: string;
  learning_id: string;
  company_id: string;
  version: number;
  category: string;
  product_ref: string | null;
  title: string;
  description: string;
  rule_structured: string;
  positive_example: string | null;
  negative_example: string | null;
  priority: number;
  status: string;
  confidence: number;
  origin: string;
  change_reason: string | null;
  created_at: string;
}

interface RetrievalRow {
  learning_id: string;
  generation_ref: string;
  conversation_id: string | null;
}

interface Store {
  learnings: Map<string, StoredLearning>;
  versions: StoredVersion[];
  retrievals: RetrievalRow[];
}

function hashOf(input: {
  category: string;
  title: string;
  rule: string;
  desc: string | null;
  product: string | null;
}): string {
  const norm = normalizeForHashPreview(
    [input.category, input.title, input.rule, input.desc ?? "", input.product ?? ""]
      .join("|"),
  );
  // hash didático — não é sha256, apenas determinístico para os testes.
  let h = 0;
  for (const ch of norm) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return `hash-${h}`;
}

function similarityScore(
  a: StoredLearning,
  b: { category: string; title: string; rule: string; desc: string | null; product: string | null },
): number {
  const norm = (s: string) => normalizeForHashPreview(s);
  const jac = (x: string, y: string): number => {
    const A = new Set(norm(x).split(" ").filter(Boolean));
    const B = new Set(norm(y).split(" ").filter(Boolean));
    if (!A.size && !B.size) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter += 1;
    const union = new Set([...A, ...B]).size;
    return union === 0 ? 0 : inter / union;
  };
  return (
    jac(a.rule_structured, b.rule) * 0.45 +
    jac(a.title, b.title) * 0.3 +
    jac(a.description, b.desc ?? "") * 0.15 +
    (a.category === b.category ? 0.05 : 0) +
    ((a.product_ref ?? "") === (b.product ?? "") ? 0.05 : 0)
  );
}

function classify(score: number, exact: boolean): SimilarCandidate["classification"] {
  return classifyByScore(score, exact);
}

const CALLER_COMPANY = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const CALLER_USER = "dddddddd-dddd-dddd-dddd-dddddddddddd";

function makeSB(store: Store): SupabaseClient<Database> {
  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    if (name === "create_coach_learning") {
      const id = `learn-${store.learnings.size + 1}`;
      const now = new Date().toISOString();
      const hash = hashOf({
        category: params._category as string,
        title: params._title as string,
        rule: params._rule_structured as string,
        desc: (params._description as string) ?? null,
        product: (params._product_ref as string | null) ?? null,
      });
      const row: StoredLearning = {
        id,
        company_id: CALLER_COMPANY,
        category: params._category as string,
        product_ref: (params._product_ref as string | null) ?? null,
        title: params._title as string,
        description: params._description as string,
        rule_structured: params._rule_structured as string,
        positive_example: (params._positive_example as string | null) ?? null,
        negative_example: (params._negative_example as string | null) ?? null,
        priority: (params._priority as number) ?? 50,
        status: "active",
        confidence: (params._confidence as number) ?? 0.7,
        version: 1,
        content_hash: hash,
        updated_at: now,
      };
      store.learnings.set(id, row);
      store.versions.push({
        id: `v-${store.versions.length + 1}`,
        learning_id: id,
        company_id: CALLER_COMPANY,
        version: 1,
        category: row.category,
        product_ref: row.product_ref,
        title: row.title,
        description: row.description,
        rule_structured: row.rule_structured,
        positive_example: row.positive_example,
        negative_example: row.negative_example,
        priority: row.priority,
        status: row.status,
        confidence: row.confidence,
        origin: (params._origin as string) ?? "teach_mode",
        change_reason: null,
        created_at: now,
      });
      return { data: id, error: null };
    }

    if (name === "update_coach_learning") {
      const id = params._learning_id as string;
      const expected = params._expected_version as number;
      const cur = store.learnings.get(id);
      if (!cur) return { data: null, error: new Error("not_found") };
      if (cur.version !== expected) {
        return { data: null, error: new Error("learning_version_conflict") };
      }
      const next: StoredLearning = {
        ...cur,
        title: (params._title as string) ?? cur.title,
        description: (params._description as string) ?? cur.description,
        rule_structured: (params._rule_structured as string) ?? cur.rule_structured,
        category: (params._category as string) ?? cur.category,
        product_ref: (params._product_ref as string | null) ?? cur.product_ref,
        priority: (params._priority as number) ?? cur.priority,
        status: (params._status as string) ?? cur.status,
        confidence: (params._confidence as number) ?? cur.confidence,
        version: cur.version + 1,
        updated_at: new Date().toISOString(),
      };
      next.content_hash = hashOf({
        category: next.category,
        title: next.title,
        rule: next.rule_structured,
        desc: next.description,
        product: next.product_ref,
      });
      store.learnings.set(id, next);
      store.versions.push({
        id: `v-${store.versions.length + 1}`,
        learning_id: id,
        company_id: CALLER_COMPANY,
        version: next.version,
        category: next.category,
        product_ref: next.product_ref,
        title: next.title,
        description: next.description,
        rule_structured: next.rule_structured,
        positive_example: next.positive_example,
        negative_example: next.negative_example,
        priority: next.priority,
        status: next.status,
        confidence: next.confidence,
        origin: (params._origin as string) ?? "manual_edit",
        change_reason: (params._change_reason as string | null) ?? null,
        created_at: next.updated_at,
      });
      return { data: next.version, error: null };
    }

    if (name === "find_similar_coach_learning") {
      const probe = {
        category: params._category as string,
        title: params._title as string,
        rule: params._rule_structured as string,
        desc: (params._description as string) ?? null,
        product: (params._product_ref as string | null) ?? null,
      };
      const probeHash = hashOf(probe);
      const limit = (params._limit as number) ?? 5;
      const list: SimilarCandidate[] = [];
      for (const row of store.learnings.values()) {
        if (row.company_id !== CALLER_COMPANY) continue;
        if (row.status === "archived") continue;
        const isExact = row.content_hash === probeHash;
        const score = isExact ? 1 : similarityScore(row, probe);
        if (!isExact && score < SIMILARITY_THRESHOLDS.MIN_CANDIDATE) continue;
        list.push({
          id: row.id,
          version: row.version,
          status: row.status,
          category: row.category,
          title: row.title,
          description: row.description,
          rule_structured: row.rule_structured,
          product_ref: row.product_ref,
          priority: row.priority,
          updated_at: row.updated_at,
          content_hash: row.content_hash,
          score,
          classification: classify(score, isExact),
        });
      }
      list.sort((a, b) => b.score - a.score);
      return { data: list.slice(0, limit), error: null };
    }

    if (name === "restore_coach_learning_version") {
      const id = params._learning_id as string;
      const target = params._target_version as number;
      const expected = params._expected_version as number;
      const cur = store.learnings.get(id);
      if (!cur) return { data: null, error: new Error("not_found") };
      if (cur.version !== expected) {
        return { data: null, error: new Error("learning_version_conflict") };
      }
      const source = store.versions.find(
        (v) => v.learning_id === id && v.version === target,
      );
      if (!source) return { data: null, error: new Error("version_not_found") };
      const next: StoredLearning = {
        ...cur,
        title: source.title,
        description: source.description,
        rule_structured: source.rule_structured,
        category: source.category,
        product_ref: source.product_ref,
        priority: source.priority,
        status: source.status,
        confidence: source.confidence,
        version: cur.version + 1,
        updated_at: new Date().toISOString(),
      };
      next.content_hash = hashOf({
        category: next.category,
        title: next.title,
        rule: next.rule_structured,
        desc: next.description,
        product: next.product_ref,
      });
      store.learnings.set(id, next);
      store.versions.push({
        id: `v-${store.versions.length + 1}`,
        learning_id: id,
        company_id: CALLER_COMPANY,
        version: next.version,
        category: next.category,
        product_ref: next.product_ref,
        title: next.title,
        description: next.description,
        rule_structured: next.rule_structured,
        positive_example: next.positive_example,
        negative_example: next.negative_example,
        priority: next.priority,
        status: next.status,
        confidence: next.confidence,
        origin: "restore",
        change_reason:
          (params._change_reason as string | null) ??
          `restore-from-v${target}`,
        created_at: next.updated_at,
      });
      return { data: next.version, error: null };
    }

    if (name === "record_coach_learning_retrieval") {
      const ids = (params._ids as string[]) ?? [];
      const genRef = params._generation_ref as string;
      const conv = (params._conversation_id as string | null) ?? null;
      let inserted = 0;
      for (const id of ids) {
        const exists = store.retrievals.some(
          (r) => r.learning_id === id && r.generation_ref === genRef,
        );
        if (exists) continue;
        store.retrievals.push({ learning_id: id, generation_ref: genRef, conversation_id: conv });
        inserted += 1;
      }
      return { data: inserted, error: null };
    }

    return { data: null, error: new Error(`unknown_rpc:${name}`) };
  });
  return { rpc, from: vi.fn() } as unknown as SupabaseClient<Database>;
}

const BASE_DRAFT = {
  category: "objection" as const,
  product_ref: "piscina de fibra",
  title: "Nunca prometer prazo sem confirmar",
  description:
    "Quando o cliente perguntar prazo de entrega, jamais prometa sem confirmar com o time.",
  rule_structured:
    "Nunca prometa prazo de entrega sem confirmar com a operação. Diga que vai confirmar e retorna em breve.",
  positive_example: "Vou confirmar o prazo com o time e te retorno hoje.",
  negative_example: "Entregamos em 3 dias.",
  priority: 80,
  confidence: 0.85,
};

let store: Store;
let sb: SupabaseClient<Database>;

beforeEach(() => {
  store = { learnings: new Map(), versions: [], retrievals: [] };
  sb = makeSB(store);
});

describe("BLOCO 4 — find_similar_coach_learning", () => {
  it("classifica hash idêntico como 'exact' e bloqueia via decideSaveGate", async () => {
    await createCoachLearning(sb, BASE_DRAFT, null, { origin: "teach_mode" });
    const candidates = await findSimilarCoachLearning(sb, {
      category: BASE_DRAFT.category,
      title: BASE_DRAFT.title,
      rule_structured: BASE_DRAFT.rule_structured,
      description: BASE_DRAFT.description,
      product_ref: BASE_DRAFT.product_ref,
      limit: 5,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].classification).toBe("exact");
    const gate = decideSaveGate(candidates);
    expect(gate.gate).toBe("block_exact");
    expect(gate.exact?.id).toBe(candidates[0].id);
  });

  it("retorna 'proceed' quando não há semelhança relevante", async () => {
    await createCoachLearning(sb, BASE_DRAFT, null, { origin: "teach_mode" });
    const candidates = await findSimilarCoachLearning(sb, {
      category: "closing",
      title: "Fechar por urgência de estoque",
      rule_structured: "Use gatilho de escassez apenas se realmente restar poucas unidades.",
      description: "Regra de fechamento por escassez.",
      product_ref: null,
    });
    expect(decideSaveGate(candidates).gate).toBe("proceed");
  });

  it("classifica variações leves como similar/related e permite forçar salvamento", async () => {
    await createCoachLearning(sb, BASE_DRAFT, null, { origin: "teach_mode" });
    const candidates = await findSimilarCoachLearning(sb, {
      category: BASE_DRAFT.category,
      title: BASE_DRAFT.title + " (variação)",
      // Regra praticamente idêntica — apenas 1 palavra alterada — deve pontuar alto.
      rule_structured:
        "Nunca prometa prazo de entrega sem confirmar com a operação. Diga que vai confirmar e retorna logo.",
      description: BASE_DRAFT.description,
      product_ref: BASE_DRAFT.product_ref,
    });
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0].classification).not.toBe("exact");
    expect(["highly_similar", "related"]).toContain(candidates[0].classification);
    const gate = decideSaveGate(candidates);
    expect(gate.gate).toBe("confirm_similar");
    expect(gate.similar.length).toBeGreaterThan(0);
  });
});

describe("BLOCO 4 — update_coach_learning (concorrência otimista)", () => {
  it("aceita update com expectedVersion correto e incrementa versão", async () => {
    const id = await createCoachLearning(sb, BASE_DRAFT, null, { origin: "teach_mode" });
    const nextV = await updateCoachLearningRpc(
      sb,
      id,
      1,
      { title: "Nunca prometer prazo", description: BASE_DRAFT.description, rule_structured: BASE_DRAFT.rule_structured, category: BASE_DRAFT.category, priority: 90 },
      { origin: "manual_edit", changeReason: "ajuste manual" },
    );
    expect(nextV).toBe(2);
  });

  it("rejeita update com expectedVersion desatualizado (learning_version_conflict)", async () => {
    const id = await createCoachLearning(sb, BASE_DRAFT, null, { origin: "teach_mode" });
    await updateCoachLearningRpc(
      sb,
      id,
      1,
      { title: "v2", description: BASE_DRAFT.description, rule_structured: BASE_DRAFT.rule_structured, category: BASE_DRAFT.category },
      { origin: "manual_edit" },
    );
    await expect(
      updateCoachLearningRpc(
        sb,
        id,
        1,
        { title: "colisão", description: BASE_DRAFT.description, rule_structured: BASE_DRAFT.rule_structured, category: BASE_DRAFT.category },
        { origin: "manual_edit" },
      ),
    ).rejects.toThrow(/learning_version_conflict/);
  });
});

describe("BLOCO 4 — restore_coach_learning_version", () => {
  it("cria NOVA versão restaurando conteúdo antigo e registra origin=restore", async () => {
    const id = await createCoachLearning(sb, BASE_DRAFT, null, { origin: "teach_mode" });
    await updateCoachLearningRpc(
      sb,
      id,
      1,
      { title: "título alterado", description: "descrição nova longa suficiente.", rule_structured: "regra completamente diferente aqui.", category: BASE_DRAFT.category },
      { origin: "manual_edit" },
    );
    const restoredVersion = await restoreCoachLearningVersion(sb, id, 1, 2, "voltar ao original");
    expect(restoredVersion).toBe(3);
    const finalRow = store.learnings.get(id)!;
    expect(finalRow.title).toBe(BASE_DRAFT.title);
    expect(finalRow.rule_structured).toBe(BASE_DRAFT.rule_structured);
    const v3 = store.versions.find((v) => v.learning_id === id && v.version === 3)!;
    expect(v3.origin).toBe("restore");
    expect(v3.change_reason).toContain("original");
  });

  it("rejeita restore se expectedVersion desatualizado", async () => {
    const id = await createCoachLearning(sb, BASE_DRAFT, null, { origin: "teach_mode" });
    await updateCoachLearningRpc(
      sb,
      id,
      1,
      { title: "v2", description: BASE_DRAFT.description, rule_structured: BASE_DRAFT.rule_structured, category: BASE_DRAFT.category },
      { origin: "manual_edit" },
    );
    await expect(
      restoreCoachLearningVersion(sb, id, 1, 1, null),
    ).rejects.toThrow(/learning_version_conflict/);
  });
});

describe("BLOCO 4 — record_coach_learning_retrieval (telemetria idempotente)", () => {
  it("insere na primeira chamada e ignora duplicatas do mesmo generation_ref", async () => {
    const id = await createCoachLearning(sb, BASE_DRAFT, null, { origin: "teach_mode" });
    const first = await recordCoachLearningRetrieval(sb, [id], "gen-abc", null);
    const second = await recordCoachLearningRetrieval(sb, [id], "gen-abc", null);
    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(store.retrievals).toHaveLength(1);
  });

  it("nunca lança em falha — retorna 0 para input vazio", async () => {
    const n = await recordCoachLearningRetrieval(sb, [], "gen-x", null);
    expect(n).toBe(0);
  });
});
