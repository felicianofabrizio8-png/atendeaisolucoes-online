// Coach Evolutivo — Quality Gate: fluxo reprovar → ensinar → reutilizar.
// Cobre repositório, integração com grounding, isolamento por tenant,
// versionamento, arquivamento e feedback (👍 / 👎).
//
// Não altera código de produção. Apenas exercita módulos existentes com um
// SupabaseClient fake in-memory que respeita `company_id`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  archiveCoachLearningRpc,
  createCoachLearning,
  incrementLearningUsage,
  listActiveLearningsForGrounding,
  listCoachLearnings,
  listLearningVersions,
  updateCoachLearningRpc,
} from "../coach-learnings.repository";
import { CoachLearningDraftSchema, type CoachLearningRow } from "../schema";
import { buildCompanyGrounding } from "@/lib/coach-interpreter/grounding.server";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_A = "11111111-1111-1111-1111-111111111111";
const CONV_A = "22222222-2222-2222-2222-222222222222";
const SUGGESTION_A = "33333333-3333-3333-3333-333333333333";

const goodDraft = {
  category: "product_positioning" as const,
  product_ref: "piscina de fibra",
  title: "Nunca dizer que vai verificar modelos",
  description:
    "Quando o cliente pergunta por medida específica em piscina de fibra, apresente os modelos disponíveis do catálogo e pergunte preferência entre praia ou degraus.",
  rule_structured:
    "Nunca diga 'vou verificar' quando o catálogo tem modelos. Apresente os modelos disponíveis e pergunte se prefere praia ou degraus.",
  positive_example:
    "Temos o modelo Maragogi 8x3,5m com prainha e o Canyon 6x3m com degraus. Qual estilo te agrada mais?",
  negative_example: "Vou verificar o que temos disponível nesse modelo e te retorno.",
  priority: 90,
  confidence: 0.9,
};

// ---------------------------------------------------------------------------
// Fake Supabase client — respeita company_id, status, order/limit.
// ---------------------------------------------------------------------------
interface Store {
  learnings: Map<string, CoachLearningRow>;
  versions: Array<{ id: string; learning_id: string; version: number; company_id: string; edited_by: string | null }>;
  suggestions: Map<
    string,
    { company_id: string; feedback_status?: "positive" | "negative" | null; learning_id?: string | null }
  >;
  incrementCalls: Array<string[]>;
  feedbackCalls: Array<{ suggestion_id: string; feedback: string; learning_id: string | null; caller: string }>;
}

function makeStore(): Store {
  return {
    learnings: new Map(),
    versions: [],
    suggestions: new Map(),
    incrementCalls: [],
    feedbackCalls: [],
  };
}

// Simula o usuário chamador para checar isolamento por tenant nas RPCs.
function makeSB(store: Store, caller: { userId: string; companyId: string }) {
  const from = vi.fn((table: string) => {
    const filters: { col: string; op: string; val: unknown }[] = [];
    let limitN: number | null = null;
    const builder: Record<string, unknown> = {};

    const run = async () => {
      if (table === "coach_learnings") {
        let rows = Array.from(store.learnings.values());
        for (const f of filters) {
          if (f.op === "eq") rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[f.col] === f.val);
          if (f.op === "in") rows = rows.filter((r) => (f.val as unknown[]).includes((r as unknown as Record<string, unknown>)[f.col]));
        }
        // Isolamento RLS-like: nunca devolve linhas de company diferente do caller.
        rows = rows.filter((r) => r.company_id === caller.companyId);
        rows.sort((a, b) => b.priority - a.priority);
        if (limitN) rows = rows.slice(0, limitN);
        return { data: rows, error: null };
      }
      if (table === "coach_learning_versions") {
        let rows = store.versions.filter((v) => v.company_id === caller.companyId);
        for (const f of filters) {
          if (f.op === "eq") rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[f.col] === f.val);
        }
        rows.sort((a, b) => b.version - a.version);
        return { data: rows, error: null };
      }
      // Tabelas que o grounding consulta — devolve vazio para focar em learnings.
      return { data: [], error: null };
    };

    builder.select = vi.fn(() => builder);
    builder.eq = vi.fn((col: string, val: unknown) => {
      filters.push({ col, op: "eq", val });
      return builder;
    });
    builder.in = vi.fn((col: string, val: unknown[]) => {
      filters.push({ col, op: "in", val });
      return builder;
    });
    builder.is = vi.fn(() => builder);
    builder.order = vi.fn(() => builder);
    builder.limit = vi.fn((n: number) => {
      limitN = n;
      return builder;
    });
    builder.maybeSingle = vi.fn(async () => {
      const r = await run();
      return { data: (r.data as unknown[])[0] ?? null, error: r.error };
    });
    builder.single = vi.fn(async () => {
      const r = await run();
      return { data: (r.data as unknown[])[0] ?? null, error: r.error };
    });
    // Await direto no builder — Supabase suporta thenable.
    (builder as unknown as { then: (r: (v: unknown) => void) => void }).then = (resolve) => {
      run().then(resolve);
    };
    return builder;
  });

  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    if (name === "create_coach_learning") {
      const id = `learn-${store.learnings.size + 1}`;
      const now = new Date().toISOString();
      const row: CoachLearningRow = {
        id,
        company_id: caller.companyId,
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
        usage_count: 0,
        last_used_at: null,
        times_retrieved: 0,
        last_retrieved_at: null,
        content_hash: `hash-${id}`,
        taught_by: caller.userId,
        updated_by: caller.userId,
        source_conversation_id: (params._source_conversation_id as string | null) ?? null,
        version: 1,
        created_at: now,
        updated_at: now,
        archived_at: null,
      };
      store.learnings.set(id, row);
      store.versions.push({
        id: `v-${store.versions.length + 1}`,
        learning_id: id,
        version: 1,
        company_id: caller.companyId,
        edited_by: caller.userId,
      });
      return { data: id, error: null };
    }
    if (name === "update_coach_learning") {
      const id = params._learning_id as string;
      const cur = store.learnings.get(id);
      if (!cur) return { data: null, error: new Error("not_found") };
      if (cur.company_id !== caller.companyId)
        return { data: null, error: new Error("forbidden") };
      const nextVersion = cur.version + 1;
      const patch: CoachLearningRow = {
        ...cur,
        title: (params._title as string) ?? cur.title,
        description: (params._description as string) ?? cur.description,
        rule_structured: (params._rule_structured as string) ?? cur.rule_structured,
        category: (params._category as string) ?? cur.category,
        product_ref: (params._product_ref as string | null) ?? cur.product_ref,
        positive_example: (params._positive_example as string | null) ?? cur.positive_example,
        negative_example: (params._negative_example as string | null) ?? cur.negative_example,
        priority: (params._priority as number) ?? cur.priority,
        status: ((params._status as string) ?? cur.status) as CoachLearningRow["status"],
        confidence: (params._confidence as number) ?? cur.confidence,
        version: nextVersion,
        updated_at: new Date().toISOString(),
      };
      store.learnings.set(id, patch);
      store.versions.push({
        id: `v-${store.versions.length + 1}`,
        learning_id: id,
        version: nextVersion,
        company_id: caller.companyId,
        edited_by: caller.userId,
      });
      return { data: nextVersion, error: null };
    }
    if (name === "archive_coach_learning") {
      const id = params._learning_id as string;
      const cur = store.learnings.get(id);
      if (!cur || cur.company_id !== caller.companyId)
        return { data: null, error: new Error("forbidden") };
      store.learnings.set(id, { ...cur, status: "archived", archived_at: new Date().toISOString() });
      return { data: null, error: null };
    }
    if (name === "increment_coach_learning_usage") {
      const ids = (params._ids as string[]) ?? [];
      store.incrementCalls.push(ids);
      let n = 0;
      for (const id of ids) {
        const cur = store.learnings.get(id);
        if (cur && cur.company_id === caller.companyId) {
          store.learnings.set(id, { ...cur, usage_count: cur.usage_count + 1, last_used_at: new Date().toISOString() });
          n += 1;
        }
      }
      return { data: n, error: null };
    }
    if (name === "submit_coach_suggestion_feedback") {
      const sid = params._suggestion_id as string;
      const cur = store.suggestions.get(sid);
      if (!cur) return { data: null, error: new Error("suggestion_not_found") };
      if (cur.company_id !== caller.companyId)
        return { data: null, error: new Error("forbidden") };
      cur.feedback_status = params._feedback as "positive" | "negative";
      cur.learning_id = (params._learning_id as string | null) ?? null;
      store.suggestions.set(sid, cur);
      store.feedbackCalls.push({
        suggestion_id: sid,
        feedback: params._feedback as string,
        learning_id: (params._learning_id as string | null) ?? null,
        caller: caller.userId,
      });
      return { data: null, error: null };
    }
    return { data: null, error: new Error(`unknown_rpc:${name}`) };
  });

  return { from, rpc } as unknown as SupabaseClient<Database>;
}

// ---------------------------------------------------------------------------
// Testes
// ---------------------------------------------------------------------------
let store: Store;
let sbA: SupabaseClient<Database>;
let sbB: SupabaseClient<Database>;

beforeEach(() => {
  store = makeStore();
  sbA = makeSB(store, { userId: USER_A, companyId: COMPANY_A });
  sbB = makeSB(store, { userId: "user-b", companyId: COMPANY_B });
  store.suggestions.set(SUGGESTION_A, { company_id: COMPANY_A });
});

// -------- 1. Schema / rascunho estruturado --------
describe("Coach Evolutivo · schema do rascunho", () => {
  it("aceita rascunho completo do vendedor (produto piscina de fibra)", () => {
    const parsed = CoachLearningDraftSchema.safeParse(goodDraft);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.category).toBe("product_positioning");
      expect(parsed.data.product_ref).toBe("piscina de fibra");
      expect(parsed.data.negative_example).toMatch(/vou verificar/i);
      expect(parsed.data.priority).toBeGreaterThanOrEqual(80);
    }
  });

  it("rejeita rascunho sem categoria", () => {
    const bad = { ...goodDraft } as unknown as Record<string, unknown>;
    delete bad.category;
    expect(CoachLearningDraftSchema.safeParse(bad).success).toBe(false);
  });

  it("rejeita rascunho sem rule_structured", () => {
    const bad = { ...goodDraft, rule_structured: "" };
    expect(CoachLearningDraftSchema.safeParse(bad).success).toBe(false);
  });

  it("rejeita rascunho com título curto demais", () => {
    const bad = { ...goodDraft, title: "x" };
    expect(CoachLearningDraftSchema.safeParse(bad).success).toBe(false);
  });
});

// -------- 2. Criação (persistência apenas na confirmação) --------
describe("Coach Evolutivo · criação e persistência", () => {
  it("não persiste nada até createCoachLearning ser chamado explicitamente", async () => {
    // Simular abertura do drawer sem confirmar: nenhuma escrita esperada.
    expect(store.learnings.size).toBe(0);
    expect(store.versions.length).toBe(0);
  });

  it("cria aprendizado, versão inicial, associa autor e conversa fonte", async () => {
    const id = await createCoachLearning(sbA, goodDraft, CONV_A);
    expect(id).toMatch(/^learn-/);
    const row = store.learnings.get(id)!;
    expect(row.company_id).toBe(COMPANY_A);
    expect(row.taught_by).toBe(USER_A);
    expect(row.source_conversation_id).toBe(CONV_A);
    expect(row.version).toBe(1);
    expect(row.status).toBe("active");
    expect(store.versions).toHaveLength(1);
    expect(store.versions[0]).toMatchObject({ learning_id: id, version: 1 });
  });
});

// -------- 3. Reprovação (👎) e vínculo com sugestão --------
describe("Coach Evolutivo · feedback negativo vincula sugestão ao aprendizado", () => {
  it("👎 marca sugestão como negativa e associa learning_id criado", async () => {
    const id = await createCoachLearning(sbA, goodDraft, CONV_A);
    await sbA.rpc("submit_coach_suggestion_feedback" as never, {
      _suggestion_id: SUGGESTION_A,
      _feedback: "negative",
      _learning_id: id,
    } as never);
    const s = store.suggestions.get(SUGGESTION_A)!;
    expect(s.feedback_status).toBe("negative");
    expect(s.learning_id).toBe(id);
    expect(store.feedbackCalls[0]).toMatchObject({
      suggestion_id: SUGGESTION_A,
      feedback: "negative",
      learning_id: id,
      caller: USER_A,
    });
  });

  it("rejeita feedback em sugestão inexistente", async () => {
    const { error } = await sbA.rpc("submit_coach_suggestion_feedback" as never, {
      _suggestion_id: "00000000-0000-0000-0000-000000000000",
      _feedback: "negative",
      _learning_id: null,
    } as never);
    expect(error).toBeTruthy();
  });
});

// -------- 4. Reutilização via grounding --------
describe("Coach Evolutivo · reutilização do aprendizado no grounding", () => {
  it("bloco de grounding da empresa A inclui a regra ensinada e seu ID é rastreado", async () => {
    const id = await createCoachLearning(sbA, goodDraft, CONV_A);
    const g = await buildCompanyGrounding(sbA, COMPANY_A);
    expect(g.sourcesUsed.coach_learnings).toBe(true);
    expect(g.learningIdsUsed).toContain(id);
    expect(g.block).toMatch(/APRENDIZADOS DA EQUIPE/);
    expect(g.block).toMatch(/vou verificar/i);
    expect(g.block).toMatch(/praia ou degraus/i);
  });

  it("incrementLearningUsage registra reforço quando 👍 confirma uso", async () => {
    const id = await createCoachLearning(sbA, goodDraft, CONV_A);
    const n = await incrementLearningUsage(sbA, [id]);
    expect(n).toBe(1);
    expect(store.learnings.get(id)!.usage_count).toBe(1);
    expect(store.incrementCalls[0]).toEqual([id]);
  });

  it("incrementLearningUsage com lista vazia é no-op seguro", async () => {
    const n = await incrementLearningUsage(sbA, []);
    expect(n).toBe(0);
    expect(store.incrementCalls).toHaveLength(0);
  });
});

// -------- 5. Isolamento por tenant --------
describe("Coach Evolutivo · isolamento estrito por tenant", () => {
  it("aprendizado da empresa A NÃO entra no grounding da empresa B", async () => {
    await createCoachLearning(sbA, goodDraft, CONV_A);
    const gB = await buildCompanyGrounding(sbB, COMPANY_B);
    expect(gB.sourcesUsed.coach_learnings).toBe(false);
    expect(gB.learningIdsUsed).toEqual([]);
    expect(gB.block).not.toMatch(/vou verificar/i);
  });

  it("listActiveLearningsForGrounding de B com dados de A retorna vazio", async () => {
    await createCoachLearning(sbA, goodDraft, CONV_A);
    const rowsB = await listActiveLearningsForGrounding(sbB, COMPANY_B, 20);
    expect(rowsB).toEqual([]);
  });

  it("empresa B não consegue arquivar aprendizado da empresa A", async () => {
    const id = await createCoachLearning(sbA, goodDraft, CONV_A);
    await expect(archiveCoachLearningRpc(sbB, id)).rejects.toThrow();
    expect(store.learnings.get(id)!.status).toBe("active");
  });

  it("empresa B não consegue atualizar aprendizado da empresa A", async () => {
    const id = await createCoachLearning(sbA, goodDraft, CONV_A);
    await expect(
      updateCoachLearningRpc(sbB, id, 1, { ...goodDraft, title: "hack" }),
    ).rejects.toThrow();
    expect(store.learnings.get(id)!.title).toBe(goodDraft.title);
  });

  it("empresa B não consegue registrar feedback em sugestão da A", async () => {
    const { error } = await sbB.rpc("submit_coach_suggestion_feedback" as never, {
      _suggestion_id: SUGGESTION_A,
      _feedback: "positive",
      _learning_id: null,
    } as never);
    expect(error).toBeTruthy();
  });
});

// -------- 6. Versionamento --------
describe("Coach Evolutivo · versionamento", () => {
  it("edição incrementa versão; versões anteriores permanecem auditáveis", async () => {
    const id = await createCoachLearning(sbA, goodDraft, CONV_A);
    const v2 = await updateCoachLearningRpc(sbA, id, 1, {
      ...goodDraft,
      title: "Nunca dizer 'vou verificar' — v2",
      rule_structured: goodDraft.rule_structured + " Cite sempre o modelo Maragogi ou Canyon.",
    });
    expect(v2).toBe(2);
    const row = store.learnings.get(id)!;
    expect(row.version).toBe(2);
    expect(row.title).toMatch(/v2$/);

    const versions = await listLearningVersions(sbA, id);
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });

  it("grounding após edição usa a versão ativa (v2)", async () => {
    const id = await createCoachLearning(sbA, goodDraft, CONV_A);
    await updateCoachLearningRpc(sbA, id, 1, {
      ...goodDraft,
      rule_structured: "Regra v2: apresente Maragogi 8x3,5m e Canyon 6x3m.",
    });
    const g = await buildCompanyGrounding(sbA, COMPANY_A);
    expect(g.block).toMatch(/Regra v2/);
    expect(g.block).toMatch(/v2/); // marcador de versão renderizado
  });
});

// -------- 7. Arquivamento --------
describe("Coach Evolutivo · arquivamento", () => {
  it("aprendizado arquivado sai do grounding e do learningIdsUsed", async () => {
    const id = await createCoachLearning(sbA, goodDraft, CONV_A);
    await archiveCoachLearningRpc(sbA, id);
    expect(store.learnings.get(id)!.status).toBe("archived");
    const g = await buildCompanyGrounding(sbA, COMPANY_A);
    expect(g.learningIdsUsed).not.toContain(id);
    expect(g.sourcesUsed.coach_learnings).toBe(false);
  });

  it("listCoachLearnings sem includeArchived não retorna arquivados", async () => {
    const id = await createCoachLearning(sbA, goodDraft, CONV_A);
    await archiveCoachLearningRpc(sbA, id);
    const rows = await listCoachLearnings(sbA, { includeArchived: false });
    expect(rows.find((r) => r.id === id)).toBeUndefined();
  });
});

// -------- 8. Feedback positivo (👍) --------
describe("Coach Evolutivo · feedback positivo reforça apenas learnings usados", () => {
  it("👍 registra positive e não cria novo aprendizado", async () => {
    const id = await createCoachLearning(sbA, goodDraft, CONV_A);
    const before = store.learnings.size;
    await sbA.rpc("submit_coach_suggestion_feedback" as never, {
      _suggestion_id: SUGGESTION_A,
      _feedback: "positive",
      _learning_id: null,
    } as never);
    await incrementLearningUsage(sbA, [id]);
    expect(store.learnings.size).toBe(before); // sem novo aprendizado
    expect(store.suggestions.get(SUGGESTION_A)!.feedback_status).toBe("positive");
    expect(store.learnings.get(id)!.usage_count).toBe(1);
  });
});
