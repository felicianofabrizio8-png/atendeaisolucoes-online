// Proteção contra publicação duplicada por cliques repetidos ou pedidos
// simultâneos em "Publicar agora" — sem impedir a republicação intencional.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DUPLICATE_WINDOW_MS, comesBefore, duplicateMessage, findDuplicateSchedule, type ScheduleSibling } from "../publish-dedupe";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: vi.fn() } }));

const NOW = new Date("2026-10-10T12:00:00.000Z");
const at = (seconds: number) => new Date(NOW.getTime() + seconds * 1000).toISOString();
const sib = (id: string, status: string, seconds: number, created = seconds): ScheduleSibling => ({ id, status, scheduled_at: at(seconds), created_at: at(created) });
const request = (candidate: Parameters<typeof findDuplicateSchedule>[0], siblings: ScheduleSibling[]) => findDuplicateSchedule(candidate, siblings, { mode: "request", now: NOW });
const materialize = (candidate: Parameters<typeof findDuplicateSchedule>[0], siblings: ScheduleSibling[]) => findDuplicateSchedule(candidate, siblings, { mode: "materialize", now: NOW });

describe("clique repetido em Publicar agora", () => {
  it("segundo pedido com o primeiro ainda pendente, na fila ou recém-publicado é recusado", () => {
    for (const status of ["planned", "queued", "published"]) {
      expect(request({ scheduled_at: at(1) }, [sib("a", status, -5)])?.id).toBe("a");
    }
  });

  it("envio anterior que falhou ou foi cancelado não bloqueia uma nova tentativa", () => {
    expect(request({ scheduled_at: at(1) }, [sib("a", "failed", -5), sib("b", "cancelled", -3)])).toBeNull();
  });

  it("'publicar agora' é recusado enquanto houver outro envio do mesmo conteúdo em andamento, mesmo antigo", () => {
    // Ex.: publicação presa em novas tentativas há 10 minutos.
    expect(request({ scheduled_at: at(1) }, [sib("a", "queued", -600)])?.id).toBe("a");
    expect(request({ scheduled_at: at(1) }, [sib("a", "planned", -600)])?.id).toBe("a");
  });
});

describe("republicação intencional continua possível", () => {
  it("depois de publicado e passada a janela, o mesmo conteúdo pode ser publicado de novo", () => {
    const afterWindow = -(DUPLICATE_WINDOW_MS / 1000) - 10;
    expect(request({ scheduled_at: at(1) }, [sib("a", "published", afterWindow)])).toBeNull();
    expect(request({ scheduled_at: at(1) }, [sib("a", "published", -86_400), sib("b", "published", -3_600)])).toBeNull();
  });

  it("agendar o mesmo conteúdo em horários diferentes continua permitido", () => {
    // Um agendamento futuro não bloqueia publicar agora, nem outro horário futuro.
    expect(request({ scheduled_at: at(1) }, [sib("a", "planned", 3_600)])).toBeNull();
    expect(request({ scheduled_at: at(7_200) }, [sib("a", "planned", 3_600), sib("b", "queued", -30)])).toBeNull();
    // Mas dois agendamentos para praticamente o mesmo horário são o mesmo pedido.
    expect(request({ scheduled_at: at(3_630) }, [sib("a", "planned", 3_600)])?.id).toBe("a");
  });
});

describe("pedidos simultâneos (os dois passam pela primeira conferência e gravam)", () => {
  const a = sib("aaa", "planned", 1, 0);
  const b = sib("bbb", "planned", 1.2, 0.2);

  it("depois de gravar, exatamente um dos dois desiste — o segundo da ordem", () => {
    expect(request({ id: a.id, scheduled_at: a.scheduled_at, created_at: a.created_at }, [a, b])).toBeNull();
    expect(request({ id: b.id, scheduled_at: b.scheduled_at, created_at: b.created_at }, [a, b])?.id).toBe("aaa");
  });

  it("empate total de horário é decidido pelo id: nunca os dois seguem, nunca os dois desistem", () => {
    const x = sib("111", "planned", 1, 0);
    const y = sib("222", "planned", 1, 0);
    const results = [x, y].map((self) => request({ id: self.id, scheduled_at: self.scheduled_at, created_at: self.created_at }, [x, y]));
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect(comesBefore(x, y)).toBe(true);
    expect(comesBefore(y, x)).toBe(false);
  });

  it("se um dos dois já avançou para a fila ou foi publicado, o outro desiste, qualquer que seja a ordem", () => {
    // `a` vem antes na ordem, mas `b` já está na fila: `a` é a repetição.
    expect(request({ id: a.id, scheduled_at: a.scheduled_at, created_at: a.created_at }, [a, { ...b, status: "queued" }])?.id).toBe("bbb");
    expect(materialize(a, [{ ...b, status: "published" }])?.id).toBe("bbb");
  });
});

describe("na fila (quando o agendamento vira publicação)", () => {
  it("dois agendamentos pendentes quase no mesmo horário: só o primeiro vira publicação", () => {
    const a = sib("aaa", "planned", -10);
    const b = sib("bbb", "planned", -9);
    expect(materialize(a, [b])).toBeNull();
    expect(materialize(b, [a])?.id).toBe("aaa");
    expect(materialize(b, [{ ...a, status: "queued" }])?.id).toBe("aaa");
  });

  it("agendamentos atrasados em horários distintos são todos publicados (nada de cancelar por atraso)", () => {
    const morning = sib("aaa", "planned", -6 * 3600);
    const noon = sib("bbb", "planned", -3600);
    expect(materialize(noon, [morning])).toBeNull();
    expect(materialize(noon, [{ ...morning, status: "queued" }])).toBeNull();
    expect(materialize(noon, [{ ...morning, status: "published" }])).toBeNull();
  });
});

describe("mensagens", () => {
  it("explicam o motivo e o que fazer", () => {
    expect(duplicateMessage("Facebook", { status: "queued" })).toContain("em andamento no Facebook");
    // Cancelar o agendamento não cancela um envio já na fila: orientar a
    // cancelar e publicar de novo poderia gerar dois posts.
    for (const status of ["planned", "queued", "published"]) expect(duplicateMessage("Instagram", { status })).not.toMatch(/cancel/i);
    expect(duplicateMessage("Instagram", { status: "planned" })).toContain("Aguarde a conclusão");
    expect(duplicateMessage("Instagram", { status: "published" })).toContain("acabou de ser publicado no Instagram");
  });
});

describe("'Publicar agora' usa o horário do servidor", () => {
  it("ignora qualquer horário enviado pelo navegador; 'Agendar' mantém o horário escolhido", async () => {
    const { resolveScheduledAt } = await import("@/lib/marketing/marketing.functions");
    const serverNow = new Date("2026-10-10T12:00:00.000Z");
    // Relógio do aparelho 3 horas adiantado ou 1 dia atrasado: tanto faz.
    for (const browser of ["2026-10-10T15:00:00.000Z", "2026-10-09T12:00:00.000Z", undefined]) {
      expect(resolveScheduledAt({ publish_now: true, scheduled_at: browser }, serverNow)).toBe("2026-10-10T12:00:01.000Z");
    }
    expect(resolveScheduledAt({ scheduled_at: "2026-11-01T09:30:00.000Z" }, serverNow)).toBe("2026-11-01T09:30:00.000Z");
    expect(resolveScheduledAt({ publish_now: false, scheduled_at: "2026-11-01T09:30:00.000Z" }, serverNow)).toBe("2026-11-01T09:30:00.000Z");
  });

  it("REGRESSÃO: dois aparelhos com relógios diferentes caem na mesma janela e o segundo é recusado", async () => {
    const { resolveScheduledAt } = await import("@/lib/marketing/marketing.functions");
    const first = resolveScheduledAt({ publish_now: true, scheduled_at: at(-3 * 3600) }, NOW);
    const second = resolveScheduledAt({ publish_now: true, scheduled_at: at(3 * 3600) }, new Date(NOW.getTime() + 400));
    expect(request({ scheduled_at: second }, [{ id: "a", status: "planned", scheduled_at: first, created_at: first }])?.id).toBe("a");
  });

  it("o servidor usa o horário resolvido na conferência e na gravação; o pedido sem horário só vale em 'publicar agora'", () => {
    const source = readFileSync(resolve(process.cwd(), "src/lib/marketing/marketing.functions.ts"), "utf8");
    const fn = source.slice(source.indexOf("export const scheduleMarketingContent"), source.indexOf("export async function carouselScheduleProblem"));
    expect(fn).toContain("const scheduledAt = resolveScheduledAt(data);");
    expect(fn).toContain("scheduled_at: scheduledAt,");
    expect(fn).not.toContain("data.scheduled_at");
    expect(source).toContain('.refine((v) => v.publish_now === true || typeof v.scheduled_at === "string"');
    const dialog = readFileSync(resolve(process.cwd(), "src/components/marketing/PublishNowDialog.tsx"), "utf8");
    expect(dialog).not.toMatch(/Date\.now\(\)|scheduled_at:/);
    // "Agendar" continua enviando o horário escolhido pelo usuário.
    const approvals = readFileSync(resolve(process.cwd(), "src/components/marketing/MarketingApprovals.tsx"), "utf8");
    expect(approvals).toContain("scheduled_at: result.iso,");
  });
});

describe("ligação no servidor", () => {
  const source = readFileSync(resolve(process.cwd(), "src/lib/marketing/marketing.functions.ts"), "utf8");
  const fn = source.slice(source.indexOf("export const scheduleMarketingContent"), source.indexOf("export async function carouselScheduleProblem"));

  it("confere antes de gravar e de novo depois; quem perde cancela só o PRÓPRIO agendamento", () => {
    const order = [
      'findDuplicateSchedule({ scheduled_at: scheduledAt }, await siblings(), { mode: "request" })',
      ".insert({",
      'findDuplicateSchedule({ id: row.id, scheduled_at: row.scheduled_at, created_at: row.created_at }, await siblings(), { mode: "request" })',
      '.update({ status: "cancelled" }).eq("id", row.id).eq("company_id", companyId).eq("status", "planned")',
    ].map((s) => fn.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
  });

  it("a busca de repetições é restrita à empresa da sessão, ao conteúdo e ao canal", () => {
    const query = fn.slice(fn.indexOf("const siblings = async"), fn.indexOf("const before ="));
    for (const filter of ['.eq("company_id", companyId)', '.eq("content_id", data.content_id)', '.eq("channel", data.channel)', '.in("status", ["planned", "queued", "published"])']) {
      expect(query).toContain(filter);
    }
  });
});

describe("fila: PublisherPlanner", () => {
  it("REGRESSÃO: dois agendamentos do mesmo conteúdo e canal viram UMA publicação; o outro é cancelado", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { PublisherPlanner } = await import("../PublisherPlanner.server");
    const content = { id: "c1", status: "approved", format: "feed", channel: "instagram", campaign_id: null, ai_prompt: { formats: ["feed"] } };
    const schedule = [
      { id: "s1", company_id: "co-A", content_id: "c1", channel: "instagram", scheduled_at: at(-10), created_at: at(-11), status: "planned", created_by: null, marketing_contents: content },
      { id: "s2", company_id: "co-A", content_id: "c1", channel: "instagram", scheduled_at: at(-9.5), created_at: at(-10.5), status: "planned", created_by: null, marketing_contents: content },
      // Mesmo conteúdo em OUTRO canal e conteúdo de OUTRA empresa: não são repetição.
      { id: "s3", company_id: "co-A", content_id: "c1", channel: "facebook", scheduled_at: at(-9), created_at: at(-10), status: "planned", created_by: null, marketing_contents: content },
      { id: "s4", company_id: "co-B", content_id: "c9", channel: "instagram", scheduled_at: at(-8), created_at: at(-9), status: "planned", created_by: null, marketing_contents: { ...content, id: "c9" } },
    ];
    const updates: Array<{ id: string; status: string }> = [];
    const siblingFilters: Array<Record<string, unknown>> = [];
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
      const filters: Record<string, unknown> = {};
      let patch: { status?: string } | null = null;
      const q: Record<string, unknown> = {};
      const result = () => {
        if (table !== "marketing_schedule") return { data: [], error: null };
        if (patch) {
          const row = schedule.find((s) => s.id === filters.id && (!filters.status || s.status === filters.status));
          if (row && patch.status) {
            row.status = patch.status;
            updates.push({ id: row.id, status: patch.status });
          }
          return { data: null, error: null };
        }
        if ("content_id" in filters) {
          siblingFilters.push({ ...filters });
          const statuses = filters.in_status as string[];
          return { data: schedule.filter((s) => s.company_id === filters.company_id && s.content_id === filters.content_id && s.channel === filters.channel && statuses.includes(s.status) && s.id !== filters.neq_id), error: null };
        }
        return { data: schedule.filter((s) => s.status === "planned"), error: null };
      };
      Object.assign(q, {
        select: () => q,
        update: (p: { status?: string }) => ((patch = p), q),
        eq: (k: string, v: unknown) => ((filters[k] = v), q),
        neq: (k: string, v: unknown) => ((filters[`neq_${k}`] = v), q),
        in: (k: string, v: unknown) => ((filters[`in_${k}`] = v), q),
        lte: () => q,
        order: () => q,
        limit: () => q,
        then: (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok),
      });
      return q;
    });
    const materialized: string[] = [];
    const repo = { materialize: vi.fn(async (input: { scheduleId: string }) => (materialized.push(input.scheduleId), { id: `pub-${input.scheduleId}` })) };
    const created = await new PublisherPlanner(repo as never).materializeDue(NOW);

    expect(materialized).toEqual(["s1", "s3", "s4"]);
    expect(created).toBe(3);
    expect(updates).toContainEqual({ id: "s2", status: "cancelled" });
    expect(schedule.map((s) => s.status)).toEqual(["queued", "cancelled", "queued", "queued"]);
    // Cada busca de repetição fica dentro da empresa do próprio agendamento.
    expect(siblingFilters.every((f) => typeof f.company_id === "string" && f.content_id && f.channel)).toBe(true);
    expect(siblingFilters.find((f) => f.neq_id === "s4")!.company_id).toBe("co-B");
  });
});
