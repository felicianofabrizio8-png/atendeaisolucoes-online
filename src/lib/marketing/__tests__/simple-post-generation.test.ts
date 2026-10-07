// Modos "Foto" e "Vídeo pronto": roda o handler real contra um Supabase em
// memória e um gateway de IA falso. Sem rede e sem render.
import { beforeEach, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({ context: null as unknown }));

vi.mock("@tanstack/react-start", () => {
  const createServerFn = () => {
    let validate = (x: unknown) => x;
    const b: Record<string, unknown> = {};
    b.middleware = () => b;
    b.inputValidator = (f: (x: unknown) => unknown) => {
      validate = f;
      return b;
    };
    // Chamadas aninhadas entre server functions reutilizam a sessão da requisição.
    b.handler =
      (h: (a: { data: unknown; context: unknown }) => unknown) =>
      (opts: { data: unknown; context?: unknown }) => {
        if (opts.context) current.context = opts.context;
        return h({ data: validate(opts.data), context: opts.context ?? current.context });
      };
    return b;
  };
  return { createServerFn, createMiddleware: () => ({ server: () => ({}) }) };
});
vi.mock("@/integrations/supabase/auth-middleware", () => ({ requireSupabaseAuth: {} }));

import { SimpleMarketingPostInputSchema, generateSimpleMarketingPost } from "../marketing-ai.functions";

type Row = Record<string, unknown>;
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_A = "a0000000-0000-4000-8000-000000000001";
const PHOTO = "a1111111-1111-4111-8111-111111111111";
const VIDEO = "a1111111-1111-4111-8111-222222222222";
const PHOTO_B = "b1111111-1111-4111-8111-111111111111";

function seed(): Record<string, Row[]> {
  return {
    profiles: [{ id: USER_A, company_id: A }],
    companies: [{ id: A, name: "Empresa A" }, { id: B, name: "Empresa B" }],
    marketing_media: [
      { id: PHOTO, company_id: A, media_type: "image", title: "foto vitrine", description: null, tags: [] },
      { id: VIDEO, company_id: A, media_type: "video", title: "video depoimento", description: null, tags: [] },
      { id: PHOTO_B, company_id: B, media_type: "image", title: "foto da outra empresa", description: null, tags: [] },
    ],
  };
}

function fakeSupabase(db: Record<string, Row[]>) {
  const from = (table: string) => {
    const preds: Array<(r: Row) => boolean> = [];
    let inserted: Row[] | null = null;
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
    chain("is", ((c: string, v: unknown) => { preds.push((r) => (r[c] ?? null) === v); }) as never);
    chain("not", (() => {}) as never);
    chain("or", (() => {}) as never);
    chain("order", (() => {}) as never);
    chain("limit", (() => {}) as never);
    chain("insert", ((p: Row | Row[]) => {
      inserted = (Array.isArray(p) ? p : [p]).map((r, i) => ({ id: `new-${table}-${i}`, ...r }));
      (db[table] ??= []).push(...inserted);
    }) as never);
    const resolve = () => ({ data: inserted ?? (db[table] ?? []).filter((r) => preds.every((p) => p(r))), error: null });
    q.maybeSingle = async () => ({ data: resolve().data[0] ?? null, error: null });
    q.single = async () => ({ data: resolve().data[0] ?? null, error: null });
    q.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(resolve()).then(ok, fail);
    return q;
  };
  return { from, storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: { message: "no" } }) }) } };
}

const bundle = {
  strategy: { angle: "custo-benefício", objective: "o", audience: "a", benefit: "b", differential: "d", objection_broken: "x", objections: [], emotion: "e", cta: "Fale conosco", intent: "venda" },
  image_texts: { headline: "Chegou a novidade", subheadline: "", cta: "Fale conosco" },
  story: { title: "s", body: "legenda story", hashtags: [] },
  feed: { title: "f", body: "legenda feed", hashtags: [] },
  reel: { title: "r", body: "corpo reel", hashtags: [], script: { format: "slideshow", total_duration_seconds: 20, hook_summary: "h", music_suggestion: "m", scenes: [1, 2, 3].map((n) => ({ scene: n, duration_seconds: 5, media_reference: "foto", framing: "close", camera_movement: "static", cut_style: "corte seco", on_screen_text: "", voiceover: "", silence: false })), final_cta_overlay: "cta" } },
  whatsapp: { title: "w", body: "corpo whats", cta_text: "Fale conosco" },
};

type Simple = (o: { data: unknown; context: unknown }) => Promise<{ contents: Row[] }>;
const generate = generateSimpleMarketingPost as unknown as Simple;
let db: Record<string, Row[]>;
let fetchMock: ReturnType<typeof vi.fn>;
const run = (data: Row) => generate({ data, context: { supabase: fakeSupabase(db), userId: USER_A } });

beforeEach(() => {
  db = seed();
  current.context = null;
  process.env.LOVABLE_API_KEY = "chave-de-teste";
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { tool_calls: [{ function: { arguments: JSON.stringify(bundle) } }] } }] }) }));
  vi.stubGlobal("fetch", fetchMock);
});

describe("geração nos modos Foto e Vídeo pronto", () => {
  it("o tom usa os mesmos valores acentuados da tela e do gerador", () => {
    for (const tone of ["amigável", "profissional", "descontraído", "urgente"]) {
      expect(SimpleMarketingPostInputSchema.parse({ media_mode: "photo", media_ids: [PHOTO], tone }).tone).toBe(tone);
    }
    expect(SimpleMarketingPostInputSchema.parse({ media_mode: "photo", media_ids: [PHOTO] }).tone).toBe("amigável");
  });

  it("Foto: cria só as legendas de Feed e Story, com a mídia escolhida e sem render", async () => {
    const res = await run({ media_mode: "photo", media_ids: [PHOTO], tone: "amigável" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.contents.map((r) => r.format).sort()).toEqual(["feed", "story"]);
    for (const row of res.contents) {
      expect(row.company_id).toBe(A);
      expect(row.status).toBe("draft");
      expect(row.media_ids).toEqual([PHOTO]);
      expect((row.ai_prompt as Row).media_mode).toBe("photo");
      expect(row.campaign_id ?? null).toBeNull();
    }
    expect(db.video_render_jobs ?? []).toHaveLength(0);
  });

  it("respeita o formato escolhido", async () => {
    const res = await run({ media_mode: "photo", media_ids: [PHOTO], campaign_formats: "feed" });
    expect(res.contents.map((r) => r.format)).toEqual(["feed"]);
  });

  it("Vídeo pronto: aceita um vídeo do acervo", async () => {
    const res = await run({ media_mode: "uploaded_video", media_ids: [VIDEO] });
    expect(res.contents.length).toBe(2);
    expect((res.contents[0].ai_prompt as Row).media_mode).toBe("uploaded_video");
    expect(res.contents[0].media_ids).toEqual([VIDEO]);
  });

  it("recusa mídia do tipo errado antes de chamar a IA", async () => {
    await expect(run({ media_mode: "photo", media_ids: [VIDEO] })).rejects.toThrow(/Selecione uma imagem/);
    await expect(run({ media_mode: "uploaded_video", media_ids: [PHOTO] })).rejects.toThrow(/Selecione um vídeo/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.marketing_contents ?? []).toHaveLength(0);
  });

  it("recusa mídia de outra empresa antes de chamar a IA", async () => {
    await expect(run({ media_mode: "photo", media_ids: [PHOTO_B] })).rejects.toThrow(/não pertence à empresa/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
