import { describe, expect, it } from "vitest";
import { linkVideoToMarketingCampaign } from "../link-campaign-video";

// Mini fake do supabase-admin com a API mínima usada pelo linker.
function makeFakeAdmin(initial: Array<Record<string, unknown>>) {
  const rows = initial.map((r) => ({ ...r }));
  const admin = {
    from(_t: string) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      void _t;
      return {
        _op: null as null | "select" | "update",
        _cols: null as null | string,
        _updatePatch: null as null | Record<string, unknown>,
        _filters: [] as Array<[string, unknown]>,
        select(cols: string) {
          this._op = "select";
          this._cols = cols;
          return this;
        },
        update(patch: Record<string, unknown>) {
          this._op = "update";
          this._updatePatch = patch;
          return this;
        },
        eq(col: string, val: unknown) {
          this._filters.push([col, val]);
          return this;
        },
        // O builder do supabase é "thenable": a operação só roda no await,
        // com todos os filtros encadeados.
        then(resolve: (v: { data: unknown; error: null }) => void) {
          const matched = rows.filter((r) => this._filters.every(([c, v]) => r[c] === v));
          if (this._op === "select") {
            const cols = (this._cols ?? "").split(",").map((s) => s.trim());
            resolve({
              data: matched.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null]))),
              error: null,
            });
            return;
          }
          if (this._op === "update") for (const r of matched) Object.assign(r, this._updatePatch);
          resolve({ data: null, error: null });
        },
      };
    },
    _dump: () => rows,
  };
  return admin;
}

describe("Fase M3 — linkVideoToMarketingCampaign", () => {
  it("preenche feed_video_id e story_video_id quando o MESMO job serve ambos", async () => {
    const admin = makeFakeAdmin([
      {
        id: "feed-content",
        campaign_role: "feed",
        feed_render_job_id: "master-job",
        story_render_job_id: null,
        feed_video_id: null,
        story_video_id: null,
      },
      {
        id: "story-content",
        campaign_role: "story",
        feed_render_job_id: null,
        story_render_job_id: "master-job",
        feed_video_id: null,
        story_video_id: null,
      },
    ]);
    const res = await linkVideoToMarketingCampaign(admin, "master-job", "vid-1");
    expect(res.feedUpdated).toEqual(["feed-content"]);
    expect(res.storyUpdated).toEqual(["story-content"]);
    const rows = admin._dump();
    expect(rows.find((r) => r.id === "feed-content")?.feed_video_id).toBe("vid-1");
    expect(rows.find((r) => r.id === "story-content")?.story_video_id).toBe("vid-1");
  });

  it("preserva campanhas antigas com 2 jobs distintos (compat)", async () => {
    const admin = makeFakeAdmin([
      { id: "f", campaign_role: "feed", feed_render_job_id: "job-A", story_render_job_id: null, feed_video_id: null, story_video_id: null },
      { id: "s", campaign_role: "story", feed_render_job_id: null, story_render_job_id: "job-B", feed_video_id: null, story_video_id: null },
    ]);
    await linkVideoToMarketingCampaign(admin, "job-A", "vid-feed");
    await linkVideoToMarketingCampaign(admin, "job-B", "vid-story");
    const rows = admin._dump();
    expect(rows.find((r) => r.id === "f")?.feed_video_id).toBe("vid-feed");
    expect(rows.find((r) => r.id === "s")?.story_video_id).toBe("vid-story");
  });

  it("é idempotente — repetir a conclusão com o mesmo vídeo não altera nada", async () => {
    const admin = makeFakeAdmin([
      { id: "f", feed_render_job_id: "j", story_render_job_id: "j", feed_video_id: "vid", story_video_id: null },
    ]);
    const res = await linkVideoToMarketingCampaign(admin, "j", "vid");
    expect(res.feedUpdated).toEqual([]);
    expect(res.storyUpdated).toEqual(["f"]);
    const again = await linkVideoToMarketingCampaign(admin, "j", "vid");
    expect(again).toEqual({ feedUpdated: [], storyUpdated: [] });
    expect(admin._dump()[0]).toMatchObject({ feed_video_id: "vid", story_video_id: "vid" });
  });

  it("REGRESSÃO: gerar de novo troca o vídeo antigo pelo do job novo (feed e story)", async () => {
    // Estado real observado: as linhas já apontam para o job novo (4181e901),
    // mas guardavam o vídeo do job anterior (406843cd).
    const admin = makeFakeAdmin([
      { id: "feed", feed_render_job_id: "job-novo", story_render_job_id: null, feed_video_id: "video-antigo", story_video_id: null },
      { id: "story", feed_render_job_id: null, story_render_job_id: "job-novo", feed_video_id: null, story_video_id: "video-antigo" },
    ]);
    const res = await linkVideoToMarketingCampaign(admin, "job-novo", "video-novo");
    expect(res).toEqual({ feedUpdated: ["feed"], storyUpdated: ["story"] });
    const rows = admin._dump();
    expect(rows.find((r) => r.id === "feed")?.feed_video_id).toBe("video-novo");
    expect(rows.find((r) => r.id === "story")?.story_video_id).toBe("video-novo");
  });

  it("job antigo que conclui atrasado não sobrescreve o vídeo do job atual", async () => {
    const admin = makeFakeAdmin([
      { id: "story", feed_render_job_id: null, story_render_job_id: "job-novo", feed_video_id: null, story_video_id: "video-novo" },
    ]);
    const res = await linkVideoToMarketingCampaign(admin, "job-antigo", "video-antigo");
    expect(res).toEqual({ feedUpdated: [], storyUpdated: [] });
    expect(admin._dump()[0].story_video_id).toBe("video-novo");
  });

  it("a gravação é condicional ao vínculo: linha que mudou de job no meio do caminho não é alterada", async () => {
    const rows = [{ id: "s", feed_render_job_id: null, story_render_job_id: "job-1", feed_video_id: null, story_video_id: null as string | null }];
    const admin = makeFakeAdmin(rows);
    // Simula a corrida: depois da leitura, a linha passa a apontar para outro job.
    const original = admin.from.bind(admin);
    let reads = 0;
    admin.from = (t: string) => {
      const builder = original(t);
      const select = builder.select.bind(builder);
      builder.select = (cols: string) => {
        const out = select(cols);
        if (cols.includes("story_video_id") && ++reads === 1) {
          const then = out.then.bind(out);
          out.then = (resolve) => then((v) => {
            admin._dump()[0].story_render_job_id = "job-2";
            resolve(v);
          });
        }
        return out;
      };
      return builder;
    };
    const res = await linkVideoToMarketingCampaign(admin, "job-1", "vid-1");
    expect(res.storyUpdated).toEqual(["s"]);
    expect(admin._dump()[0].story_video_id).toBeNull();
  });

  it("não toca em conteúdos de outros jobs", async () => {
    const admin = makeFakeAdmin([
      { id: "a", feed_render_job_id: "job-A", story_render_job_id: null, feed_video_id: "vid-A", story_video_id: null },
      { id: "b", feed_render_job_id: "job-B", story_render_job_id: null, feed_video_id: "vid-antigo", story_video_id: null },
    ]);
    await linkVideoToMarketingCampaign(admin, "job-B", "vid-B");
    const rows = admin._dump();
    expect(rows.find((r) => r.id === "a")?.feed_video_id).toBe("vid-A");
    expect(rows.find((r) => r.id === "b")?.feed_video_id).toBe("vid-B");
  });
});
