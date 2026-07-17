import { describe, it, expect } from "vitest";
import {
  evaluateFacebookPageReadiness,
  formatMissingScopesMessage,
  FB_PAGE_REQUIRED_SCOPES,
} from "../facebookPageReadiness";

describe("evaluateFacebookPageReadiness", () => {
  it("intent=default sempre passa", () => {
    expect(evaluateFacebookPageReadiness([], "default")).toEqual({ ok: true, missing: [] });
    expect(evaluateFacebookPageReadiness(["public_profile"], "default")).toEqual({
      ok: true,
      missing: [],
    });
  });

  it("intent=facebook_page com todos os scopes exigidos → ok, chamaria /me/accounts", () => {
    const scopes = [...FB_PAGE_REQUIRED_SCOPES, "public_profile"];
    const r = evaluateFacebookPageReadiness(scopes, "facebook_page");
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("intent=facebook_page sem pages_show_list → bloqueia com missing específico", () => {
    const scopes = ["pages_read_engagement", "pages_manage_posts"];
    const r = evaluateFacebookPageReadiness(scopes, "facebook_page");
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("pages_show_list");
    const msg = formatMissingScopesMessage(r.missing);
    expect(msg).toMatch(/pages_show_list/);
    expect(msg).toMatch(/Meta Developers/);
  });

  it("intent=facebook_page com múltiplos scopes ausentes lista todos", () => {
    const r = evaluateFacebookPageReadiness(["pages_read_engagement"], "facebook_page");
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(["pages_show_list", "pages_manage_posts"]);
  });

  it("intent=facebook_page com scopes vazios/desconhecidos não bloqueia (sem evidência)", () => {
    expect(evaluateFacebookPageReadiness([], "facebook_page")).toEqual({ ok: true, missing: [] });
    expect(evaluateFacebookPageReadiness(null, "facebook_page")).toEqual({ ok: true, missing: [] });
  });
});
