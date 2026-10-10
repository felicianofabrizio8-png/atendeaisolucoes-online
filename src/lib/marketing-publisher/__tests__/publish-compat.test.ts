// REGRESSÃO (produção): um conteúdo `whatsapp_cta` foi aceito em "Publicar
// agora"/"Agendar" para Instagram e Facebook; a fila marcou os agendamentos
// como falhos, sem criar publicação e sem registrar o motivo.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatChannelProblem, isPublishableFormat, noPublishTargetHint, publishChannelsFor, scheduleRejectionReason } from "../publish-compat";

vi.mock("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { from: vi.fn() } }));

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("formato × canal", () => {
  it("Feed, Story, Reel e Carrossel podem ir para Instagram e Facebook", () => {
    for (const format of ["feed", "story", "reel", "carousel"]) {
      expect(isPublishableFormat(format)).toBe(true);
      expect(publishChannelsFor(format)).toEqual(["instagram", "facebook"]);
      expect(formatChannelProblem(format, "instagram")).toBeNull();
      expect(formatChannelProblem(format, "facebook")).toBeNull();
    }
  });

  it("REGRESSÃO: conteúdo de WhatsApp não tem destino no Instagram nem no Facebook, com mensagem clara", () => {
    expect(publishChannelsFor("whatsapp_cta")).toEqual([]);
    const instagram = formatChannelProblem("whatsapp_cta", "instagram")!;
    expect(instagram).toContain("mensagem para WhatsApp");
    expect(instagram).toContain("não pode ser publicado no Instagram");
    expect(instagram).toContain("Feed, Story, Reel ou Carrossel");
    expect(formatChannelProblem("whatsapp_cta", "facebook")).toContain("não pode ser publicado no Facebook");
    expect(noPublishTargetHint("whatsapp_cta")).toContain("Mensagem para WhatsApp");
  });

  it("formato desconhecido ou ausente também é recusado em Instagram/Facebook", () => {
    for (const format of ["banner", "", null, undefined, 42]) {
      expect(publishChannelsFor(format)).toEqual([]);
      expect(formatChannelProblem(format, "instagram")).toContain("não pode ser publicado no Instagram");
    }
    expect(formatChannelProblem("banner", "facebook")).toContain("(banner)");
  });

  it("o canal WhatsApp segue como sempre: nenhum formato é recusado por esta regra", () => {
    for (const format of ["whatsapp_cta", "feed", "story", "reel", "carousel"]) expect(formatChannelProblem(format, "whatsapp")).toBeNull();
  });

  it("motivo da fila: carrossel é a chave desligada; o resto é formato não publicável", () => {
    expect(scheduleRejectionReason("carousel")).toBe("carousel_publish_disabled");
    expect(scheduleRejectionReason("whatsapp_cta")).toBe("format_not_publishable");
    expect(scheduleRejectionReason(null)).toBe("format_not_publishable");
  });
});

describe("servidor: recusa antes de gravar", () => {
  const source = read("src/lib/marketing/marketing.functions.ts");
  const fn = source.slice(source.indexOf("export const scheduleMarketingContent"), source.indexOf("export async function carouselScheduleProblem"));

  it("a conferência de formato vem depois da posse/aprovação e antes de qualquer gravação", () => {
    const order = ["content.company_id !== companyId", 'content.status !== "approved"', "formatChannelProblem(content.format, data.channel)", "!isCarouselPublishEnabled(companyId)", ".insert({"].map((s) => fn.indexOf(s));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(fn).toContain("if (incompatible) throw new Error(incompatible);");
  });

  it("o formato conferido é o do conteúdo no banco, nunca um valor enviado pelo navegador", () => {
    const schema = source.slice(source.indexOf("const ScheduleSchema"), source.indexOf("export function resolveScheduledAt"));
    expect(schema).not.toContain("format");
    expect(fn).toContain('.select("id, company_id, status, media_ids, ai_prompt, campaign_id, format,');
  });
});

describe("tela: só destinos compatíveis", () => {
  const approvals = read("src/components/marketing/MarketingApprovals.tsx");

  it("conteúdo sem destino não mostra Publicar agora nem Agendar: mostra o aviso e Copiar texto", () => {
    const actions = approvals.slice(approvals.indexOf('data-testid="no-publish-target"') - 200, approvals.indexOf("<DropdownMenu>"));
    const blocked = actions.indexOf('row.status === "approved" && publishChannelsFor(row.format).length === 0 ? (');
    const normal = actions.indexOf('row.status === "approved" ? (');
    expect(blocked).toBeGreaterThan(-1);
    expect(blocked).toBeLessThan(normal);
    expect(actions.slice(blocked, normal)).toContain("Copiar texto");
    expect(actions.slice(blocked, normal)).not.toContain("onPublishNow");
    expect(actions.slice(blocked, normal)).not.toContain("onSchedule");
    expect(actions).toContain("{noPublishTargetHint(row.format)}");
  });

  it("os atalhos de publicar e agendar recusam o formato incompatível com a mesma mensagem do servidor", () => {
    for (const name of ["function publishNow(", "function openSchedule("]) {
      const body = approvals.slice(approvals.indexOf(name), approvals.indexOf(name) + 900);
      expect(body).toContain("publishChannelsFor(row.format)");
      expect(body).toContain('formatChannelProblem(row.format, "instagram")');
    }
    // As opções de canal do agendamento saem da mesma regra.
    expect(approvals).toContain("publishChannelsFor(rows.find((r) => r.id === scheduleFor)?.format).map((channel) => (");
    expect(approvals).not.toContain('<option value="facebook">Facebook</option>');
  });
});

describe("fila: registra o motivo ao rejeitar", () => {
  afterEach(() => vi.restoreAllMocks());

  it("REGRESSÃO: agendamento de conteúdo WhatsApp para Instagram vira 'failed' COM o motivo no log; os válidos seguem", async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { PublisherPlanner } = await import("../PublisherPlanner.server");
    const content = (id: string, format: string, status = "approved") => ({ id, status, format, channel: "instagram", campaign_id: null, ai_prompt: { formats: ["feed", "story"] } });
    const at = (s: number) => new Date(Date.parse("2026-10-10T12:00:00.000Z") + s * 1000).toISOString();
    const row = (id: string, company: string, channel: string, c: ReturnType<typeof content>, s: number) => ({ id, company_id: company, content_id: c.id, channel, scheduled_at: at(s), created_at: at(s - 1), status: "planned", created_by: null, marketing_contents: c });
    const schedule = [
      row("s-wa-ig", "co-A", "instagram", content("c-wa", "whatsapp_cta"), -60),
      row("s-wa-fb", "co-A", "facebook", content("c-wa", "whatsapp_cta"), -50),
      row("s-car", "co-B", "instagram", content("c-car", "carousel"), -40),
      row("s-feed", "co-A", "instagram", content("c-feed", "feed"), -30),
      row("s-story", "co-A", "facebook", content("c-story", "story"), -20),
      // Fora do caminho de rejeição: ficam como estão, sem log.
      row("s-draft", "co-A", "instagram", content("c-draft", "feed", "draft"), -10),
      row("s-wa-wa", "co-A", "whatsapp", content("c-wa", "whatsapp_cta"), -5),
    ];
    (supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const filters: Record<string, unknown> = {};
      let patch: { status?: string } | null = null;
      const q: Record<string, unknown> = {};
      const result = () => {
        if (patch) {
          const target = schedule.find((s) => s.id === filters.id && (!filters.status || s.status === filters.status));
          if (target && patch.status) target.status = patch.status;
          return { data: null, error: null };
        }
        if ("content_id" in filters) return { data: [], error: null };
        return { data: schedule.filter((s) => s.status === "planned"), error: null };
      };
      Object.assign(q, {
        select: () => q,
        update: (p: { status?: string }) => ((patch = p), q),
        eq: (k: string, v: unknown) => ((filters[k] = v), q),
        neq: () => q,
        in: () => q,
        lte: () => q,
        order: () => q,
        limit: () => q,
        then: (ok: (v: unknown) => unknown) => Promise.resolve(result()).then(ok),
      });
      return q;
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    const materialized: string[] = [];
    const repo = { materialize: vi.fn(async (input: { scheduleId: string }) => (materialized.push(input.scheduleId), { id: `pub-${input.scheduleId}` })) };

    await new PublisherPlanner(repo as never).materializeDue(new Date("2026-10-10T12:00:00.000Z"));

    const status = Object.fromEntries(schedule.map((s) => [s.id, s.status]));
    expect(status).toEqual({ "s-wa-ig": "failed", "s-wa-fb": "failed", "s-car": "failed", "s-feed": "queued", "s-story": "queued", "s-draft": "planned", "s-wa-wa": "planned" });
    expect(materialized).toEqual(["s-feed", "s-story"]);

    const rejected = warn.mock.calls.filter((c) => c[0] === "[marketing-publisher] schedule_rejected").map((c) => c[1]);
    expect(rejected).toEqual([
      { schedule_id: "s-wa-ig", company_id: "co-A", content_id: "c-wa", channel: "instagram", format: "whatsapp_cta", reason: "format_not_publishable" },
      { schedule_id: "s-wa-fb", company_id: "co-A", content_id: "c-wa", channel: "facebook", format: "whatsapp_cta", reason: "format_not_publishable" },
      { schedule_id: "s-car", company_id: "co-B", content_id: "c-car", channel: "instagram", format: "carousel", reason: "carousel_publish_disabled" },
    ]);
    // O log não leva texto do conteúdo nem dados de cliente.
    expect(JSON.stringify(rejected)).not.toMatch(/body|caption|token/i);
  });
});
