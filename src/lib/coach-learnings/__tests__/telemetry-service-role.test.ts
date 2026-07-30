// ============================================================================
// SPRINT 4 · FASE 2 — Quality Gate da telemetria do Coach Evolutivo.
//
// Estes testes REPRODUZEM o bug real antes de validar a correção:
//   sob service role, `auth.uid()` é NULL → `current_company_id()` é NULL →
//   as RPCs públicas retornam 0 sem escrever nada.
//
// O fake de Supabase abaixo implementa a SEMÂNTICA SQL REAL das quatro RPCs
// (públicas e `_internal`), incluindo:
//   - resolução de tenant por `auth.uid()` nas públicas;
//   - `company_id` explícito nas internas;
//   - UNIQUE (learning_id, generation_ref);
//   - ledger `usage_counted` para idempotência;
//   - filtro de propriedade por company_id (anti cross-tenant).
// ============================================================================
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  incrementUsageInternal,
  recordRetrievalInternal,
  recordSuggestionTelemetry,
} from "../telemetry.server";

const COMPANY_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const USER_A = "11111111-1111-1111-1111-111111111111";
const CONV_A = "22222222-2222-2222-2222-222222222222";
const MSG_A = "44444444-4444-4444-4444-444444444444";
const SUGGESTION_A = "33333333-3333-3333-3333-333333333333";
const SUGGESTION_B = "55555555-5555-5555-5555-555555555555";

const LEARNING_A1 = "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1";
const LEARNING_A2 = "a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2";
const LEARNING_B1 = "b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1";

// ---------------------------------------------------------------------------
// Store + fake client com semântica SQL das RPCs reais
// ---------------------------------------------------------------------------
interface LearningRow {
  id: string;
  company_id: string;
  status: string;
  version: number;
  usage_count: number;
  last_used_at: string | null;
  times_retrieved: number;
  last_retrieved_at: string | null;
  rule_structured: string;
}

interface RetrievalRow {
  company_id: string;
  learning_id: string;
  version_number: number;
  generation_ref: string;
  conversation_id: string | null;
  message_id: string | null;
  rank: number | null;
  selection_reason: string | null;
  usage_counted: boolean;
}

interface Store {
  learnings: Map<string, LearningRow>;
  retrievals: RetrievalRow[];
}

function makeStore(): Store {
  const learnings = new Map<string, LearningRow>();
  const base = {
    status: "active",
    version: 1,
    usage_count: 0,
    last_used_at: null,
    times_retrieved: 0,
    last_retrieved_at: null,
    rule_structured: "Nunca prometa prazo sem confirmar com a produção.",
  };
  learnings.set(LEARNING_A1, { id: LEARNING_A1, company_id: COMPANY_A, ...base });
  learnings.set(LEARNING_A2, { id: LEARNING_A2, company_id: COMPANY_A, ...base });
  learnings.set(LEARNING_B1, { id: LEARNING_B1, company_id: COMPANY_B, ...base });
  return { learnings, retrievals: [] };
}

/**
 * `authUid` = null simula EXATAMENTE o cliente service-role (supabaseAdmin).
 * É esse cenário que quebrava a telemetria em produção.
 */
function makeSB(store: Store, opts: { authUid: string | null; failInternal?: boolean }) {
  // Espelha public.profiles: só um usuário autenticado resolve empresa.
  const companyOfUser = (uid: string | null): string | null =>
    uid === USER_A ? COMPANY_A : null;

  // current_company_id() → NULL sob service role.
  const currentCompanyId = (): string | null => companyOfUser(opts.authUid);

  const rpc = vi.fn(async (name: string, params: Record<string, unknown>) => {
    // ---- RPC PÚBLICA: increment_coach_learning_usage -----------------------
    if (name === "increment_coach_learning_usage") {
      const company = currentCompanyId();
      const ids = (params._ids as string[] | null) ?? [];
      if (!company || ids.length === 0) return { data: 0, error: null };
      let n = 0;
      for (const id of ids) {
        const l = store.learnings.get(id);
        if (l && l.company_id === company && l.status === "active") {
          l.usage_count += 1;
          l.last_used_at = new Date().toISOString();
          n += 1;
        }
      }
      return { data: n, error: null };
    }

    // ---- RPC PÚBLICA: record_coach_learning_retrieval ----------------------
    if (name === "record_coach_learning_retrieval") {
      const company = currentCompanyId();
      const ids = (params._ids as string[] | null) ?? [];
      const ref = params._generation_ref as string | null;
      if (!company || ids.length === 0 || !ref) return { data: 0, error: null };
      let n = 0;
      for (const id of ids) {
        const l = store.learnings.get(id);
        if (!l || l.company_id !== company) continue;
        if (store.retrievals.some((r) => r.learning_id === id && r.generation_ref === ref)) continue;
        store.retrievals.push({
          company_id: company,
          learning_id: id,
          version_number: l.version,
          generation_ref: ref,
          conversation_id: (params._conversation_id as string) ?? null,
          message_id: null,
          rank: null,
          selection_reason: null,
          usage_counted: false,
        });
        l.times_retrieved += 1;
        l.last_retrieved_at = new Date().toISOString();
        n += 1;
      }
      return { data: n, error: null };
    }

    if (opts.failInternal && name.endsWith("_internal")) {
      return { data: null, error: { code: "42501", message: "permission denied" } };
    }

    // ---- RPC INTERNA: record_coach_learning_retrieval_internal -------------
    if (name === "record_coach_learning_retrieval_internal") {
      const company = params._company_id as string | null;
      const ids = (params._ids as string[] | null) ?? [];
      const ref = params._generation_ref as string | null;
      if (!company || ids.length === 0 || !ref) return { data: 0, error: null };
      let n = 0;
      ids.forEach((id, idx) => {
        const l = store.learnings.get(id);
        // Isolamento: aprendizado de outra empresa é IGNORADO, sem erro.
        if (!l || l.company_id !== company) return;
        if (store.retrievals.some((r) => r.learning_id === id && r.generation_ref === ref)) return;
        store.retrievals.push({
          company_id: company,
          learning_id: id,
          version_number: l.version,
          generation_ref: ref,
          conversation_id: (params._conversation_id as string) ?? null,
          message_id: (params._message_id as string) ?? null,
          rank: idx + 1,
          selection_reason: (params._selection_reason as string) ?? "priority_static",
          usage_counted: false,
        });
        l.times_retrieved += 1;
        l.last_retrieved_at = new Date().toISOString();
        n += 1;
      });
      return { data: n, error: null };
    }

    // ---- RPC INTERNA: increment_coach_learning_usage_internal --------------
    if (name === "increment_coach_learning_usage_internal") {
      const company = params._company_id as string | null;
      const ids = (params._ids as string[] | null) ?? [];
      const ref = (params._generation_ref as string | null) ?? null;
      if (!company || ids.length === 0) return { data: 0, error: null };

      let claimed: string[];
      if (ref) {
        // Ledger de idempotência: só reivindica retrievals ainda não contadas.
        const rows = store.retrievals.filter(
          (r) =>
            r.generation_ref === ref &&
            r.company_id === company &&
            ids.includes(r.learning_id) &&
            r.usage_counted === false,
        );
        rows.forEach((r) => (r.usage_counted = true));
        claimed = rows.map((r) => r.learning_id);
      } else {
        claimed = ids;
      }

      let n = 0;
      for (const id of claimed) {
        const l = store.learnings.get(id);
        if (l && l.company_id === company && l.status === "active") {
          l.usage_count += 1;
          l.last_used_at = new Date().toISOString();
          n += 1;
        }
      }
      return { data: n, error: null };
    }

    return { data: null, error: { code: "PGRST202", message: "not found" } };
  });

  return { rpc } as unknown as SupabaseClient<Database>;
}

// ---------------------------------------------------------------------------
describe("SPRINT 4 · FASE 2 — telemetria do Coach sob service role", () => {
  let store: Store;

  beforeEach(() => {
    store = makeStore();
    vi.restoreAllMocks();
  });

  // -- REPRODUÇÃO DO BUG ----------------------------------------------------
  it("BUG REPRODUZIDO: RPC pública com service role (auth.uid()=NULL) não incrementa nada", async () => {
    const admin = makeSB(store, { authUid: null });
    const { data } = await (admin as unknown as {
      rpc: (n: string, p: unknown) => Promise<{ data: number }>;
    }).rpc("increment_coach_learning_usage", { _ids: [LEARNING_A1] });

    expect(data).toBe(0);
    expect(store.learnings.get(LEARNING_A1)!.usage_count).toBe(0);
    expect(store.retrievals).toHaveLength(0);
  });

  it("BUG REPRODUZIDO: retrieval público com service role não insere linha", async () => {
    const admin = makeSB(store, { authUid: null });
    const { data } = await (admin as unknown as {
      rpc: (n: string, p: unknown) => Promise<{ data: number }>;
    }).rpc("record_coach_learning_retrieval", {
      _ids: [LEARNING_A1],
      _generation_ref: SUGGESTION_A,
      _conversation_id: CONV_A,
    });

    expect(data).toBe(0);
    expect(store.retrievals).toHaveLength(0);
  });

  // -- CORREÇÃO -------------------------------------------------------------
  it("service role com company_id explícito incrementa usage_count e last_used_at", async () => {
    const admin = makeSB(store, { authUid: null });

    await recordRetrievalInternal(admin, {
      companyId: COMPANY_A,
      learningIds: [LEARNING_A1],
      generationRef: SUGGESTION_A,
    });
    const res = await incrementUsageInternal(admin, {
      companyId: COMPANY_A,
      learningIds: [LEARNING_A1],
      generationRef: SUGGESTION_A,
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.updatedCount).toBe(1);
    const row = store.learnings.get(LEARNING_A1)!;
    expect(row.usage_count).toBe(1);
    expect(row.last_used_at).not.toBeNull();
  });

  it("service role registra retrieval com rank, motivo, conversa e mensagem", async () => {
    const admin = makeSB(store, { authUid: null });

    const res = await recordRetrievalInternal(admin, {
      companyId: COMPANY_A,
      learningIds: [LEARNING_A1, LEARNING_A2],
      generationRef: SUGGESTION_A,
      conversationId: CONV_A,
      messageId: MSG_A,
    });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.insertedCount).toBe(2);
    expect(store.retrievals).toHaveLength(2);
    const first = store.retrievals[0];
    expect(first.company_id).toBe(COMPANY_A);
    expect(first.rank).toBe(1);
    expect(first.selection_reason).toBe("priority_static");
    expect(first.conversation_id).toBe(CONV_A);
    expect(first.message_id).toBe(MSG_A);
    expect(store.retrievals[1].rank).toBe(2);
    expect(store.learnings.get(LEARNING_A1)!.times_retrieved).toBe(1);
  });

  // -- ISOLAMENTO POR TENANT ------------------------------------------------
  it("aprendizado de outra empresa NÃO é incrementado", async () => {
    const admin = makeSB(store, { authUid: null });

    await recordRetrievalInternal(admin, {
      companyId: COMPANY_A,
      learningIds: [LEARNING_A1, LEARNING_B1],
      generationRef: SUGGESTION_A,
    });
    const res = await incrementUsageInternal(admin, {
      companyId: COMPANY_A,
      learningIds: [LEARNING_A1, LEARNING_B1],
      generationRef: SUGGESTION_A,
    });

    if (res.ok) expect(res.updatedCount).toBe(1);
    expect(store.learnings.get(LEARNING_A1)!.usage_count).toBe(1);
    expect(store.learnings.get(LEARNING_B1)!.usage_count).toBe(0);
    expect(store.learnings.get(LEARNING_B1)!.last_used_at).toBeNull();
  });

  it("retrieval cross-tenant não é inserido", async () => {
    const admin = makeSB(store, { authUid: null });

    const res = await recordRetrievalInternal(admin, {
      companyId: COMPANY_A,
      learningIds: [LEARNING_B1],
      generationRef: SUGGESTION_A,
    });

    if (res.ok) expect(res.insertedCount).toBe(0);
    expect(store.retrievals).toHaveLength(0);
    expect(store.learnings.get(LEARNING_B1)!.times_retrieved).toBe(0);
  });

  // -- BORDAS ---------------------------------------------------------------
  it("lista vazia não falha e não escreve", async () => {
    const admin = makeSB(store, { authUid: null });

    const r1 = await recordRetrievalInternal(admin, {
      companyId: COMPANY_A,
      learningIds: [],
      generationRef: SUGGESTION_A,
    });
    const r2 = await incrementUsageInternal(admin, {
      companyId: COMPANY_A,
      learningIds: [],
      generationRef: SUGGESTION_A,
    });

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(store.retrievals).toHaveLength(0);
  });

  // -- IDEMPOTÊNCIA ---------------------------------------------------------
  it("retry da MESMA sugestão não duplica contagem nem linhas", async () => {
    const admin = makeSB(store, { authUid: null });
    const input = {
      companyId: COMPANY_A,
      suggestionId: SUGGESTION_A,
      learningIds: [LEARNING_A1, LEARNING_A2],
      conversationId: CONV_A,
      messageId: MSG_A,
    };

    const first = await recordSuggestionTelemetry(admin, input);
    const second = await recordSuggestionTelemetry(admin, input);
    const third = await recordSuggestionTelemetry(admin, input);

    expect(first.insertedCount).toBe(2);
    expect(first.updatedCount).toBe(2);
    expect(second.insertedCount).toBe(0);
    expect(second.updatedCount).toBe(0);
    expect(third.updatedCount).toBe(0);
    expect(store.retrievals).toHaveLength(2);
    expect(store.learnings.get(LEARNING_A1)!.usage_count).toBe(1);
    expect(store.learnings.get(LEARNING_A2)!.usage_count).toBe(1);
  });

  it("sugestões DIFERENTES contam usos separados para o mesmo aprendizado", async () => {
    const admin = makeSB(store, { authUid: null });
    const base = { companyId: COMPANY_A, learningIds: [LEARNING_A1], conversationId: CONV_A };

    await recordSuggestionTelemetry(admin, { ...base, suggestionId: SUGGESTION_A });
    await recordSuggestionTelemetry(admin, { ...base, suggestionId: SUGGESTION_B });

    expect(store.learnings.get(LEARNING_A1)!.usage_count).toBe(2);
    expect(store.retrievals).toHaveLength(2);
  });

  // -- RESILIÊNCIA E OBSERVABILIDADE ---------------------------------------
  it("falha de telemetria retorna resultado observável e nunca lança", async () => {
    const admin = makeSB(store, { authUid: null, failInternal: true });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await recordRetrievalInternal(admin, {
      companyId: COMPANY_A,
      learningIds: [LEARNING_A1],
      generationRef: SUGGESTION_A,
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("permission_denied");
      expect(res.pgCode).toBe("42501");
    }
    // Falha NÃO é silenciosa.
    expect(errSpy).toHaveBeenCalled();
  });

  it("orquestrador não lança mesmo com telemetria totalmente indisponível", async () => {
    const admin = makeSB(store, { authUid: null, failInternal: true });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const out = await recordSuggestionTelemetry(admin, {
      companyId: COMPANY_A,
      suggestionId: SUGGESTION_A,
      learningIds: [LEARNING_A1],
      conversationId: CONV_A,
    });

    expect(out.ok).toBe(false);
    expect(out.insertedCount).toBe(0);
    expect(out.updatedCount).toBe(0);
  });

  it("logs não expõem conteúdo sensível: sem regra, sem prompt, IDs mascarados", async () => {
    const admin = makeSB(store, { authUid: null });
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await recordSuggestionTelemetry(admin, {
      companyId: COMPANY_A,
      suggestionId: SUGGESTION_A,
      learningIds: [LEARNING_A1],
      conversationId: CONV_A,
      messageId: MSG_A,
    });

    const dump = JSON.stringify(infoSpy.mock.calls);
    expect(dump).not.toContain("Nunca prometa prazo");
    expect(dump).not.toContain(COMPANY_A); // UUID completo nunca aparece
    expect(dump).not.toContain(SUGGESTION_A);
    expect(dump).toContain("coach_learning_retrieval_recorded");
    expect(dump).toContain("coach_learning_usage_recorded");
    expect(dump).toContain(COMPANY_A.slice(0, 8)); // correlação preservada
  });

  // -- NÃO REGRESSÃO --------------------------------------------------------
  it("RPC pública continua funcionando com usuário autenticado (auth.uid() presente)", async () => {
    const authed = makeSB(store, { authUid: USER_A });
    const { data } = await (authed as unknown as {
      rpc: (n: string, p: unknown) => Promise<{ data: number }>;
    }).rpc("increment_coach_learning_usage", { _ids: [LEARNING_A1, LEARNING_B1] });

    expect(data).toBe(1);
    expect(store.learnings.get(LEARNING_A1)!.usage_count).toBe(1);
    expect(store.learnings.get(LEARNING_B1)!.usage_count).toBe(0);
  });

  it("companyId ausente é tratado como no-op seguro (nunca escreve sem tenant)", async () => {
    const admin = makeSB(store, { authUid: null });

    const res = await incrementUsageInternal(admin, {
      companyId: "",
      learningIds: [LEARNING_A1],
      generationRef: SUGGESTION_A,
    });

    expect(res.ok).toBe(true);
    expect(store.learnings.get(LEARNING_A1)!.usage_count).toBe(0);
  });
});
