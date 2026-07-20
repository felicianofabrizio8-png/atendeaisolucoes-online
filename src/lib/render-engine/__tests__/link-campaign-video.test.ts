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
          if (this._op === "select") {
            const matched = rows.filter((r) =>
              this._filters.every(([c, v]) => r[c] === v),
            );
            const cols = (this._cols ?? "").split(",").map((s) => s.trim());
            const projected = matched.map((r) => {
              const out: Record<string, unknown> = {};
              for (const c of cols) out[c] = r[c] ?? null;
              return out;
            });
            return Promise.resolve({ data: projected, error: null });
          }
          if (this._op === "update") {
            for (const r of rows) {
              if (this._filters.every(([c, v]) => r[c] === v)) {
                Object.assign(r, this._updatePatch);
              }
            }
            return Promise.resolve({ data: null, error: null });
          }
          return Promise.resolve({ data: null, error: null });
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

  it("é idempotente — não sobrescreve video_id já preenchido", async () => {
    const admin = makeFakeAdmin([
      { id: "f", feed_render_job_id: "j", story_render_job_id: "j", feed_video_id: "old", story_video_id: null },
    ]);
    const res = await linkVideoToMarketingCampaign(admin, "j", "new");
    expect(res.feedUpdated).toEqual([]);
    expect(res.storyUpdated).toEqual(["f"]);
    const rows = admin._dump();
    expect(rows[0].feed_video_id).toBe("old");
    expect(rows[0].story_video_id).toBe("new");
  });
});
