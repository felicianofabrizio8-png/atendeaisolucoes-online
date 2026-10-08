// Criação manual e aprovação respeitam os CHECKs do banco para o texto sobre
// o vídeo (overlay_headline ≤ 40, overlay_subheadline ≤ 60, overlay_cta ≤ 40).
// O banco em memória abaixo aplica as mesmas regras e devolve o mesmo erro.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", () => {
  const createServerFn = () => {
    let validate = (x: unknown) => x;
    const b: Record<string, unknown> = {};
    b.middleware = () => b;
    b.inputValidator = (f: (x: unknown) => unknown) => {
      validate = f;
      return b;
    };
    b.handler =
      (h: (a: { data: unknown; context: unknown }) => unknown) =>
      (opts: { data: unknown; context: unknown }) =>
        h({ data: validate(opts.data), context: opts.context });
    return b;
  };
  return { createServerFn, createMiddleware: () => ({ server: () => ({}) }) };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { approveCampaignAndRender, generateManualCampaign } from "../marketing-campaign.functions";
import { OVERLAY_LIMITS, buildManualOverlay, composeManualCaption, fitOverlayText } from "../manual-campaign";

type Row = Record<string, unknown>;
type Fn = (o: { data: unknown; context: unknown }) => Promise<Row>;
const manual = generateManualCampaign as unknown as Fn;
const approve = approveCampaignAndRender as unknown as Fn;

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UA = "a0000000-0000-4000-8000-000000000001";
const M1 = "a1111111-1111-4111-8111-111111111111";
const MB = "b1111111-1111-4111-8111-111111111111";
const AUDIO = "a3333333-3333-4333-8333-333333333333";

const len = (v: unknown) => Array.from(String(v ?? "")).length;
/** Mesmos CHECKs de supabase/migrations/20260720010907 (Fase M1). */
function checkOverlay(row: Row): string | null {
  for (const [col, max] of [["overlay_headline", 40], ["overlay_subheadline", 60], ["overlay_cta", 40]] as const) {
    if (row[col] != null && len(row[col]) > max) {
      return `new row for relation "marketing_contents" violates check constraint "marketing_contents_${col}_len"`;
    }
  }
  return null;
}

let db: Record<string, Row[]>;
function fake() {
  let n = 0;
  const from = (table: string) => {
    const preds: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let inserted: Row[] | null = null;
    let error: { message: string } | null = null;
    const q: Record<string, unknown> = {};
    const chain = (name: string, fn: (...a: never[]) => void) => {
      q[name] = (...a: never[]) => {
        fn(...a);
        return q;
      };
    };
    chain("select", () => {});
    chain("eq", ((c: string, v: unknown) => { preds.push((r) => r[c] === v); }) as never);
    chain("in", ((c: string, v: unknown[]) => { preds.push((r) => v.includes(r[c])); }) as never);
    chain("order", (() => {}) as never);
    chain("limit", (() => {}) as never);
    chain("update", ((p: Row) => { patch = p; }) as never);
    chain("insert", ((p: Row | Row[]) => {
      const rows = (Array.isArray(p) ? p : [p]).map((r) => ({ id: `new-${table}-${++n}`, status: table === "video_render_jobs" ? "queued" : r.status, ...r }));
      const violation = table === "marketing_contents" ? rows.map(checkOverlay).find(Boolean) : null;
      if (violation) {
        error = { message: violation };
        return;
      }
      inserted = rows;
      (db[table] ??= []).push(...rows);
    }) as never);
    const resolve = () => {
      if (error) return { data: null, error };
      if (inserted) return { data: inserted, error: null };
      const rows = (db[table] ?? []).filter((r) => preds.every((p) => p(r)));
      if (patch) {
        const violation = table === "marketing_contents" ? rows.map((r) => checkOverlay({ ...r, ...patch })).find(Boolean) : null;
        if (violation) return { data: null, error: { message: violation } };
        for (const r of rows) Object.assign(r, patch);
      }
      return { data: rows, error: null };
    };
    q.maybeSingle = async () => { const r = resolve(); return { data: r.data?.[0] ?? null, error: r.error }; };
    q.single = async () => { const r = resolve(); return { data: r.data?.[0] ?? null, error: r.error }; };
    q.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, fail);
    return q;
  };
  return { from, storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "no" } }) }) } };
}
const ctx = () => ({ supabase: fake(), userId: UA });
const created = () => db.marketing_contents ?? [];

beforeEach(() => {
  db = {
    profiles: [{ id: UA, company_id: A }],
    companies: [{ id: A, name: "Empresa A" }, { id: B, name: "Empresa B" }],
    audio_library: [{ id: AUDIO, company_id: A, is_active: true, duration_seconds: 120 }],
    marketing_media: [
      { id: M1, company_id: A, active: true, media_type: "image" },
      { id: MB, company_id: B, active: true, media_type: "image" },
    ],
    marketing_contents: [],
    video_render_jobs: [],
  };
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const TITLES: Array<[string, string]> = [
  ["curto", "Oferta da semana"],
  ["exatamente 40", "1234567890123456789012345678901234567890"],
  ["41 caracteres", "12345678901234567890 12345678901234567890"],
  ["longo, 80 caracteres", "Promoção especial de fim de ano com condições exclusivas para clientes antigos!!"],
  ["longo sem espaços", "x".repeat(80)],
  ["acentos e emoji", "Atenção: condições únicas só até amanhã às 18h 🎉 não perca esta chance"],
];

describe("texto sobre o vídeo cabe nos limites do banco", () => {
  it("fitOverlayText corta em fim de palavra, sem reticências, e nunca passa do limite", () => {
    for (const [, title] of TITLES) {
      const fitted = fitOverlayText(title, OVERLAY_LIMITS.headline);
      expect(len(fitted)).toBeLessThanOrEqual(40);
      expect(fitted.length).toBeGreaterThan(0);
      expect(fitted).not.toMatch(/…$/);
      expect(title.replace(/\s+/g, " ").startsWith(fitted)).toBe(true);
    }
    expect(fitOverlayText("Oferta da semana", 40)).toBe("Oferta da semana");
    expect(fitOverlayText("Promoção especial de fim de ano com condições exclusivas", 40)).toBe("Promoção especial de fim de ano com");
    expect(fitOverlayText("  muitos   espaços  ", 40)).toBe("muitos espaços");
  });

  it("subtítulo e botão também são ajustados; o título completo continua na legenda", () => {
    const long = "palavra ".repeat(30).trim();
    const o = buildManualOverlay({ title: long, subtitle: long, cta_text: long });
    expect(len(o.overlay_headline)).toBeLessThanOrEqual(OVERLAY_LIMITS.headline);
    expect(len(o.overlay_subheadline)).toBeLessThanOrEqual(OVERLAY_LIMITS.subheadline);
    expect(len(o.overlay_cta)).toBeLessThanOrEqual(OVERLAY_LIMITS.cta);
    expect(composeManualCaption({ title: TITLES[3][1] })).toContain(TITLES[3][1]);
  });
});

describe("criação manual", () => {
  for (const formats of ["feed", "story", "feed_story"] as const) {
    for (const [label, title] of TITLES) {
      it(`${formats} · título ${label}`, async () => {
        await manual({ data: { images: [{ origin: "marketing", media_id: M1 }], primary_audio_id: AUDIO, formats, fields: { title, subtitle: "s".repeat(120), cta_text: "c".repeat(60) } }, context: ctx() });
        const rows = created();
        expect(rows.map((r) => r.format).sort()).toEqual(formats === "feed_story" ? ["feed", "story"] : [formats]);
        for (const r of rows) {
          expect(checkOverlay(r)).toBeNull();
          expect(len(r.overlay_headline)).toBeLessThanOrEqual(40);
          expect(len(r.overlay_original_headline)).toBeLessThanOrEqual(40);
          expect(r.title).toBe(title.trim()); // título completo preservado
          expect(String(r.body)).toContain(title.trim());
          expect(r.company_id).toBe(A);
        }
      });
    }
  }

  it("antes da correção este payload era recusado pelo banco (controle do teste)", () => {
    const old = TITLES[3][1].slice(0, 79) + "…"; // truncamento antigo: até 80
    expect(checkOverlay({ overlay_headline: old })).toContain("marketing_contents_overlay_headline_len");
  });

  it("mídia de outra empresa continua recusada", async () => {
    await expect(manual({ data: { images: [{ origin: "marketing", media_id: MB }], primary_audio_id: AUDIO, fields: { title: "Oferta" } }, context: ctx() })).rejects.toThrow("image_cross_tenant");
    expect(created()).toHaveLength(0);
  });
});

describe("aprovação no editor", () => {
  async function campaign() {
    await manual({ data: { images: [{ origin: "marketing", media_id: M1 }], primary_audio_id: AUDIO, fields: { title: TITLES[3][1] } }, context: ctx() });
    return created()[0].campaign_id as string;
  }

  it("aceita textos no limite e cria o render", async () => {
    const id = await campaign();
    await approve({ data: { campaign_id: id, headline: "h".repeat(40), subheadline: "s".repeat(60), cta: "c".repeat(40) }, context: ctx() });
    expect(db.video_render_jobs).toHaveLength(1);
    for (const r of created()) expect(checkOverlay(r)).toBeNull();
  });

  it("recusa texto acima do limite antes de chegar ao banco", async () => {
    const id = await campaign();
    expect(() => approve({ data: { campaign_id: id, headline: "h".repeat(41) }, context: ctx() })).toThrow(/overlay_headline_too_long/);
    expect(() => approve({ data: { campaign_id: id, headline: "ok", subheadline: "s".repeat(61) }, context: ctx() })).toThrow(/overlay_subheadline_too_long/);
    expect(() => approve({ data: { campaign_id: id, headline: "ok", cta: "c".repeat(41) }, context: ctx() })).toThrow(/overlay_cta_too_long/);
    expect(db.video_render_jobs).toHaveLength(0);
  });
});
