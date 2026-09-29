import { describe, expect, it } from "vitest";
import {
  extractLegacyMetaMedia,
  extractMetaMedia,
} from "../../../../supabase/functions/meta-webhook/media";

const photo = {
  type: "image",
  payload: { url: "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=example" },
};

describe("Meta incoming attachments", () => {
  it("normalizes Instagram CDN images without a filename extension", () => {
    expect(extractMetaMedia({ attachments: [photo] })).toEqual({
      media_kind: "image",
      media_url: photo.payload.url,
    });
  });
  it("recovers existing messages from the saved webhook payload", () => {
    expect(extractLegacyMetaMedia({ raw: { message: { attachments: [photo] } } })).toEqual(
      extractMetaMedia({ attachments: [photo] }),
    );
  });
  it.each(["image", "video", "audio", "file"])("recognizes %s attachments", (type) => {
    expect(extractMetaMedia({ attachments: [{ ...photo, type }] })?.media_kind).toBe(
      type === "file" ? "document" : type,
    );
  });
  it.each([
    null,
    {},
    { attachments: null },
    { attachments: [{ type: "image", payload: {} }] },
    { attachments: [{ type: "image", payload: { url: "javascript:alert(1)" } }] },
    { attachments: [{ type: "image", payload: { url: "/other-company/file" } }] },
  ])("does not invent or accept unsafe media references: %j", (message) => {
    expect(extractMetaMedia(message)).toBeNull();
  });
  it("skips unsupported entries without losing a following image", () => {
    expect(extractMetaMedia({ attachments: [{ type: "fallback" }, photo] })?.media_url).toBe(
      photo.payload.url,
    );
  });
});
