// MetaPublisher — testes de:
// - Facebook: integração principal FB / fallback controlado via IG / bloqueios;
// - Instagram: mídia via marketing_media, via product_media_refs e sem mídia;
// - Não duplica arquivo: reuso de product_media_refs jamais escreve em marketing_media.
//
// Todos os I/O externos são mockados. postGraph nunca é chamado nos casos de
// bloqueio, e quando é chamado retornamos success/simulation para observar
// o resultado sem tocar na Meta.

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// ---- Mocks --------------------------------------------------------------

interface FakeMediaRow {
  id: string;
  company_id: string;
  storage_path: string;
  media_type: "image" | "video";
  active: boolean;
  deleted_at: string | null;
}
interface FakeContentRow {
  id: string;
  company_id: string;
  status: string;
  body: string;
  hashtags: string[];
  cta_destination: string | null;
  media_ids: string[];
  product_id: string | null;
  ai_prompt: unknown;
}
interface FakeProductRow {
  id: string;
  company_id: string;
  images: string[];
}
interface FakeIntegrationRow {
  id: string;
  company_id: string;
  channel: "facebook" | "instagram";
  active: boolean;
  is_primary_publisher: boolean;
  external_account_id: string | null;
  account_metadata: Record<string, unknown> | null;
  token_expires_at: string | null;
}
interface FakeMetaPageRow {
  company_id: string;
  page_id: string;
  page_access_token: string;
  ig_business_account_id: string | null;
  active: boolean;
  updated_at: string;
}

interface FakeVideoRow {
  id: string;
  company_id: string;
  file_path: string;
  is_active: boolean;
}

const state = {
  contents: [] as FakeContentRow[],
  media: [] as FakeMediaRow[],
  products: [] as FakeProductRow[],
  integrations: [] as FakeIntegrationRow[],
  metaPages: [] as FakeMetaPageRow[],
  videos: [] as FakeVideoRow[],
  mediaInserts: [] as unknown[],
  storageSigns: [] as Array<{ bucket: string; path: string }>,
};

function makeQuery(rows: any[]) {
  const filters: Array<(r: any) => boolean> = [];
  let order: { col: string; asc: boolean } | null = null;
  let limit: number | null = null;
  let single = false;
  let maybeSingle = false;

  const api: any = {
    select: () => api,
    eq: (col: string, val: unknown) => {
      filters.push((r) => r[col] === val);
      return api;
    },
    in: (col: string, vals: unknown[]) => {
      filters.push((r) => vals.includes(r[col]));
      return api;
    },
    is: (col: string, val: unknown) => {
      filters.push((r) => r[col] === val);
      return api;
    },
    order: (col: string, opts: { ascending: boolean }) => {
      order = { col, asc: opts.ascending };
      return api;
    },
    limit: (n: number) => {
      limit = n;
      return api;
    },
    single: () => {
      single = true;
      return exec();
    },
    maybeSingle: () => {
      maybeSingle = true;
      return exec();
    },
    then: (resolve: (v: any) => void) => resolve(exec()),
  };

  function exec() {
    let out = rows.filter((r) => filters.every((f) => f(r)));
    if (order) {
      const { col, asc } = order;
      out = [...out].sort((a, b) =>
        asc ? String(a[col]).localeCompare(String(b[col])) : String(b[col]).localeCompare(String(a[col])),
      );
    }
    if (limit !== null) out = out.slice(0, limit);
    if (single) return { data: out[0] ?? null, error: out[0] ? null : { message: "not found" } };
    if (maybeSingle) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
  return api;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      switch (table) {
        case "marketing_contents":
          return makeQuery(state.contents);
        case "marketing_media":
          return {
            ...makeQuery(state.media),
            insert: (v: unknown) => {
              state.mediaInserts.push(v);
              return Promise.resolve({ data: null, error: null });
            },
          };
        case "products":
          return makeQuery(state.products);
        case "integrations":
          return makeQuery(state.integrations);
        case "meta_pages":
          return makeQuery(state.metaPages);
        case "video_library":
          return makeQuery(state.videos);
        default:
          return makeQuery([]);
      }
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, _ttl: number) => {
          state.storageSigns.push({ bucket, path });
          return { data: { signedUrl: `https://signed.example/${bucket}/${path}` }, error: null };
        },
      }),
    },
  },
}));

// postGraph mock: sucesso "real" (não simulado) com externalId derivado.
vi.mock("@/lib/outbound/MetaOutbound.server", () => ({
  postGraph: vi.fn(async (opts: any) => {
    const raw = { id: "META_OK", post_id: "PAGE_POST" };
    const extract = opts.extractExternalId as ((j: unknown) => string | null) | undefined;
    return {
      success: true,
      simulated: false,
      environment: "production",
      externalRequestSent: true,
      externalId: extract ? extract(raw) : null,
      status: 200,
      raw,
    };
  }),
  deleteGraph: vi.fn(),
}));

// Simulate URL accessibility: any URL is reachable in these tests.
const originalFetch = globalThis.fetch;
beforeEach(() => {
  state.contents = [];
  state.media = [];
  state.products = [];
  state.integrations = [];
  state.metaPages = [];
  state.videos = [];
  state.mediaInserts = [];
  state.storageSigns = [];
  globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as any;
});

import { MetaPublisher } from "../MetaPublisher.server";

// ---- Test helpers -------------------------------------------------------

const COMPANY = "company-solario";

function seedIntegrationFb(overrides: Partial<FakeIntegrationRow> = {}) {
  state.integrations.push({
    id: "int-fb",
    company_id: COMPANY,
    channel: "facebook",
    active: true,
    is_primary_publisher: true,
    external_account_id: "PAGE-FB-DIRECT",
    account_metadata: { fb_page_id: "PAGE-FB-DIRECT" },
    token_expires_at: null,
    ...overrides,
  });
}
function seedIntegrationIg(overrides: Partial<FakeIntegrationRow> = {}) {
  state.integrations.push({
    id: "int-ig",
    company_id: COMPANY,
    channel: "instagram",
    active: true,
    is_primary_publisher: true,
    external_account_id: "IG-USER-1",
    account_metadata: { ig_business_account_id: "IG-USER-1", fb_page_id: "PAGE-VIA-IG" },
    token_expires_at: null,
    ...overrides,
  });
}
function seedMetaPage(pageId: string, ig: string | null = null) {
  state.metaPages.push({
    company_id: COMPANY,
    page_id: pageId,
    page_access_token: `TOKEN-${pageId}`,
    ig_business_account_id: ig,
    active: true,
    updated_at: new Date().toISOString(),
  });
}
function seedApprovedContent(over: Partial<FakeContentRow> = {}) {
  state.contents.push({
    id: "content-1",
    company_id: COMPANY,
    status: "approved",
    body: "Texto",
    hashtags: [],
    cta_destination: null,
    media_ids: [],
    product_id: null,
    ai_prompt: null,
    ...over,
  });
}

// ---- Facebook ----------------------------------------------------------

describe("MetaPublisher — Facebook integration selection", () => {
  it("usa integração principal Facebook quando existir", async () => {
    seedIntegrationFb();
    seedMetaPage("PAGE-FB-DIRECT");
    seedApprovedContent();
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "facebook",
      format: "feed",
    });
    expect(r.success).toBe(true);
    expect(r.errorCode).toBeUndefined();
  });

  it("faz fallback para integração principal Instagram quando não há FB", async () => {
    // Nenhuma integração FB. IG principal traz fb_page_id.
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    seedApprovedContent();
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "facebook",
      format: "feed",
    });
    expect(r.success).toBe(true);
  });

  it("bloqueia quando IG fallback não tem fb_page_id", async () => {
    seedIntegrationIg({ account_metadata: { ig_business_account_id: "IG-USER-1" } });
    seedApprovedContent();
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "facebook",
      format: "feed",
    });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("fb_page_missing");
  });

  it("bloqueia quando não existe página ativa em meta_pages", async () => {
    seedIntegrationFb();
    // sem seedMetaPage
    seedApprovedContent();
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "facebook",
      format: "feed",
    });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("meta_page_not_found");
  });

  it("não usa integração secundária Instagram (is_primary_publisher=false)", async () => {
    // IG existe mas NÃO é principal.
    state.integrations.push({
      id: "int-ig-secondary",
      company_id: COMPANY,
      channel: "instagram",
      active: true,
      is_primary_publisher: false,
      external_account_id: "IG-USER-X",
      account_metadata: { fb_page_id: "PAGE-VIA-IG" },
      token_expires_at: null,
    });
    seedMetaPage("PAGE-VIA-IG");
    seedApprovedContent();
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "facebook",
      format: "feed",
    });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("no_primary_integration");
  });
});

// ---- Instagram / mídia -------------------------------------------------

describe("MetaPublisher — Instagram media resolution", () => {
  it("publica com marketing_media quando media_ids está presente", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    state.media.push({
      id: "m1",
      company_id: COMPANY,
      storage_path: `${COMPANY}/foo.jpg`,
      media_type: "image",
      active: true,
      deleted_at: null,
    });
    seedApprovedContent({ media_ids: ["m1"] });
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "feed",
    });
    expect(r.success).toBe(true);
    expect(state.storageSigns.some((s) => s.bucket === "marketing-media")).toBe(true);
    expect(state.mediaInserts).toHaveLength(0); // não duplica
  });

  it("publica com product_media_refs sem duplicar arquivo em marketing_media", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    state.products.push({
      id: "prod-1",
      company_id: COMPANY,
      images: [`${COMPANY}/prod-1/foto.jpg`],
    });
    seedApprovedContent({
      ai_prompt: {
        product_media_refs: [{ product_id: "prod-1", image_path: `${COMPANY}/prod-1/foto.jpg` }],
      },
    });
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "feed",
    });
    expect(r.success).toBe(true);
    const signs = state.storageSigns;
    expect(signs.some((s) => s.bucket === "product-images")).toBe(true);
    expect(signs.some((s) => s.bucket === "marketing-media")).toBe(false);
    expect(state.mediaInserts).toHaveLength(0);
  });

  it("bloqueia com no_media quando não há nenhuma mídia", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    seedApprovedContent(); // sem media_ids nem product_media_refs
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "feed",
    });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("no_media");
  });

  it("falha com no_media quando a URL assinada não é acessível", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    state.media.push({
      id: "m-broken",
      company_id: COMPANY,
      storage_path: `${COMPANY}/broken.jpg`,
      media_type: "image",
      active: true,
      deleted_at: null,
    });
    seedApprovedContent({ media_ids: ["m-broken"] });
    // HEAD e GET retornam 404.
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 404 })) as any;
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "feed",
    });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("no_media");
  });
});

// ---- Instagram / product_media_refs: URL vs path relativo --------------

describe("MetaPublisher — product_media_refs path/URL handling", () => {
  const PUBLIC_URL = `https://ubnlvxkjemzhvmulowhj.supabase.co/storage/v1/object/public/product-images/${COMPANY}/prod-1/foto.jpg`;

  it("publica quando image_path é URL pública absoluta e products.images guarda URL", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    state.products.push({ id: "prod-1", company_id: COMPANY, images: [PUBLIC_URL] });
    seedApprovedContent({
      ai_prompt: { product_media_refs: [{ product_id: "prod-1", image_path: PUBLIC_URL }] },
    });
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "feed",
    });
    expect(r.success).toBe(true);
    const sign = state.storageSigns.find((s) => s.bucket === "product-images");
    expect(sign).toBeDefined();
    // Regra crítica: createSignedUrl recebe apenas path relativo, não URL absoluta.
    expect(sign!.path).toBe(`${COMPANY}/prod-1/foto.jpg`);
    expect(sign!.path.startsWith("http")).toBe(false);
    expect(state.mediaInserts).toHaveLength(0);
  });

  it("publica quando image_path é URL com caracteres codificados", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    const encoded = `https://ubnlvxkjemzhvmulowhj.supabase.co/storage/v1/object/public/product-images/${COMPANY}/prod-1/foto%20com%20espa%C3%A7o.jpg`;
    state.products.push({ id: "prod-1", company_id: COMPANY, images: [encoded] });
    seedApprovedContent({
      ai_prompt: { product_media_refs: [{ product_id: "prod-1", image_path: encoded }] },
    });
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "feed",
    });
    expect(r.success).toBe(true);
    const sign = state.storageSigns.find((s) => s.bucket === "product-images");
    expect(sign!.path).toBe(`${COMPANY}/prod-1/foto com espaço.jpg`);
  });

  it("bloqueia URL de outro bucket como no_media", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    const badBucket = `https://ubnlvxkjemzhvmulowhj.supabase.co/storage/v1/object/public/marketing-media/${COMPANY}/x.jpg`;
    state.products.push({ id: "prod-1", company_id: COMPANY, images: [badBucket] });
    seedApprovedContent({
      ai_prompt: { product_media_refs: [{ product_id: "prod-1", image_path: badBucket }] },
    });
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "feed",
    });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("no_media");
    expect(state.storageSigns.some((s) => s.bucket === "product-images")).toBe(false);
  });

  it("bloqueia URL de host inesperado como no_media", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    const evil = `https://evil.example.com/storage/v1/object/public/product-images/${COMPANY}/x.jpg`;
    state.products.push({ id: "prod-1", company_id: COMPANY, images: [evil] });
    seedApprovedContent({
      ai_prompt: { product_media_refs: [{ product_id: "prod-1", image_path: evil }] },
    });
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "feed",
    });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("no_media");
  });

  it("bloqueia quando path pertence a outro company_id (guard multi-tenant)", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    const otherTenant = "outra-empresa/prod-1/foto.jpg";
    // O produto existe no tenant correto, mas o path aponta para outro tenant.
    state.products.push({ id: "prod-1", company_id: COMPANY, images: [otherTenant] });
    seedApprovedContent({
      ai_prompt: { product_media_refs: [{ product_id: "prod-1", image_path: otherTenant }] },
    });
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "feed",
    });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("no_media");
    expect(state.storageSigns.some((s) => s.bucket === "product-images")).toBe(false);
  });

  it("continua funcionando com path relativo (retrocompat)", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    state.products.push({
      id: "prod-1",
      company_id: COMPANY,
      images: [`${COMPANY}/prod-1/foto.jpg`],
    });
    seedApprovedContent({
      ai_prompt: {
        product_media_refs: [{ product_id: "prod-1", image_path: `${COMPANY}/prod-1/foto.jpg` }],
      },
    });
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "feed",
    });
    expect(r.success).toBe(true);
    const sign = state.storageSigns.find((s) => s.bucket === "product-images");
    expect(sign!.path).toBe(`${COMPANY}/prod-1/foto.jpg`);
    expect(state.mediaInserts).toHaveLength(0);
  });

  it("retorna no_media quando signed URL é inacessível", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    state.products.push({ id: "prod-1", company_id: COMPANY, images: [PUBLIC_URL] });
    seedApprovedContent({
      ai_prompt: { product_media_refs: [{ product_id: "prod-1", image_path: PUBLIC_URL }] },
    });
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 404 })) as any;
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "feed",
    });
    expect(r.success).toBe(false);
    expect(r.errorCode).toBe("no_media");
  });
});

// ---- Campanha: preferir vídeo renderizado (com áudio incorporado) --------

describe("MetaPublisher — campaign rendered video preference", () => {
  it("Instagram Feed usa feed_video_id (video-library) e não a imagem original", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    state.media.push({
      id: "img-1",
      company_id: COMPANY,
      storage_path: `${COMPANY}/img-1.jpg`,
      media_type: "image",
      active: true,
      deleted_at: null,
    });
    state.videos.push({
      id: "vid-feed",
      company_id: COMPANY,
      file_path: `${COMPANY}/vid-feed/video.mp4`,
      is_active: true,
    });
    seedApprovedContent({
      media_ids: ["img-1"],
      campaign_role: "feed",
      feed_video_id: "vid-feed",
    } as Partial<FakeContentRow> as any);
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "feed",
    });
    expect(r.success).toBe(true);
    expect(state.storageSigns.some((s) => s.bucket === "video-library" && s.path === `${COMPANY}/vid-feed/video.mp4`)).toBe(true);
    expect(state.storageSigns.some((s) => s.bucket === "marketing-media")).toBe(false);
  });

  it("Story usa story_video_id do formato correspondente", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    state.videos.push({
      id: "vid-story",
      company_id: COMPANY,
      file_path: `${COMPANY}/vid-story/video.mp4`,
      is_active: true,
    });
    seedApprovedContent({
      media_ids: [],
      campaign_role: "story",
      story_video_id: "vid-story",
    } as Partial<FakeContentRow> as any);
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "story",
    });
    expect(r.success).toBe(true);
    expect(state.storageSigns.some((s) => s.bucket === "video-library" && s.path === `${COMPANY}/vid-story/video.mp4`)).toBe(true);
  });

  it("Ignora vídeo com file_path fora do tenant (guard multi-tenant)", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    state.media.push({
      id: "img-1",
      company_id: COMPANY,
      storage_path: `${COMPANY}/img-1.jpg`,
      media_type: "image",
      active: true,
      deleted_at: null,
    });
    state.videos.push({
      id: "vid-evil",
      company_id: COMPANY,
      file_path: `other-company/vid/video.mp4`,
      is_active: true,
    });
    seedApprovedContent({
      media_ids: ["img-1"],
      campaign_role: "feed",
      feed_video_id: "vid-evil",
    } as Partial<FakeContentRow> as any);
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "feed",
    });
    expect(r.success).toBe(true);
    // Fallback deve ter usado a imagem (marketing-media), não o vídeo comprometido.
    expect(state.storageSigns.some((s) => s.bucket === "video-library")).toBe(false);
    expect(state.storageSigns.some((s) => s.bucket === "marketing-media")).toBe(true);
  });

  it("Sem feed_video_id/story_video_id, campanhas antigas continuam usando imagem", async () => {
    seedIntegrationIg();
    seedMetaPage("PAGE-VIA-IG", "IG-USER-1");
    state.media.push({
      id: "img-1",
      company_id: COMPANY,
      storage_path: `${COMPANY}/img-1.jpg`,
      media_type: "image",
      active: true,
      deleted_at: null,
    });
    seedApprovedContent({ media_ids: ["img-1"] });
    const r = await new MetaPublisher().publish({
      companyId: COMPANY,
      contentId: "content-1",
      channel: "instagram",
      format: "feed",
    });
    expect(r.success).toBe(true);
    expect(state.storageSigns.some((s) => s.bucket === "video-library")).toBe(false);
    expect(state.storageSigns.some((s) => s.bucket === "marketing-media")).toBe(true);
  });
});

// Restaura fetch ao final do módulo.
afterAll(() => {
  globalThis.fetch = originalFetch;
});



