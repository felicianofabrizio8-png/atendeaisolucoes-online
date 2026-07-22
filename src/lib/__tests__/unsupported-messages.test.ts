import { describe, it, expect } from "vitest";
import { extractText } from "@/lib/whatsapp/extract-text";
import type { WhatsAppMessage } from "@/lib/whatsapp/extract-text";
import { getUnsupportedPlaceholder } from "@/lib/inbox/unsupported-placeholder";

const base = { id: "wamid.1", from: "5511999999999" } as const;

function msg(type: string, extra: Partial<WhatsAppMessage> = {}): WhatsAppMessage {
  return { ...base, type, ...extra } as WhatsAppMessage;
}

describe("webhook extractText", () => {
  it("preserves plain text messages verbatim", () => {
    expect(extractText(msg("text", { text: { body: "Olá, tudo bem?" } }))).toBe(
      "Olá, tudo bem?",
    );
  });

  it("returns friendly labels for supported non-text types", () => {
    expect(extractText(msg("document"))).toBe("📎 Documento");
    expect(extractText(msg("location"))).toBe("📍 Localização");
    expect(extractText(msg("contacts"))).toBe("👤 Contato");
    expect(extractText(msg("interactive"))).toBe("🔘 Resposta interativa");
    expect(extractText(msg("reaction"))).toBe("💬 Reação");
    expect(extractText(msg("order"))).toBe("🛒 Pedido");
    expect(extractText(msg("poll"))).toBe("📊 Enquete");
    expect(extractText(msg("system"))).toBe("ℹ️ Mensagem do sistema");
    expect(extractText(msg("ephemeral"))).toBe("⏳ Mensagem temporária");
    expect(extractText(msg("sticker"))).toBe("🌟 Sticker");
  });

  it("returns generic placeholder for unknown / unsupported types", () => {
    expect(extractText(msg("unsupported"))).toBe("✉️ Mensagem não suportada");
    expect(extractText(msg("unknown"))).toBe("✉️ Mensagem não suportada");
    expect(extractText(msg("some_future_type"))).toBe("✉️ Mensagem não suportada");
  });

  it("never leaks the raw type between brackets", () => {
    for (const t of [
      "unsupported",
      "unknown",
      "contacts",
      "location",
      "reaction",
      "order",
      "poll",
      "system",
      "ephemeral",
      "future_thing_from_meta",
    ]) {
      const out = extractText(msg(t));
      expect(out).not.toMatch(/^\[.*\]$/);
      expect(out).not.toContain("[unsupported]");
    }
  });

  it("keeps document / image / video / audio captions when present", () => {
    expect(
      extractText(msg("document", { document: { id: "1", caption: "Contrato final" } })),
    ).toBe("Contrato final");
    expect(
      extractText(msg("image", { image: { id: "1", caption: "Foto do produto" } })),
    ).toBe("Foto do produto");
    expect(extractText(msg("video", { video: { id: "1" } }))).toBe("🎥 Vídeo");
    expect(extractText(msg("audio", { audio: { id: "1" } }))).toBe("🎤 Áudio");
  });

  it("uses filename fallback for documents without caption", () => {
    expect(
      extractText(msg("document", { document: { id: "1", filename: "nota.pdf" } })),
    ).toBe("📎 nota.pdf");
  });

  it("reads interactive button/list reply titles when present", () => {
    expect(
      extractText(
        msg("interactive", {
          interactive: { button_reply: { id: "b1", title: "Confirmar" } },
        }),
      ),
    ).toBe("Confirmar");
    expect(
      extractText(
        msg("interactive", {
          interactive: { list_reply: { id: "l1", title: "Plano Básico" } },
        }),
      ),
    ).toBe("Plano Básico");
  });
});

describe("inbox getUnsupportedPlaceholder", () => {
  it("recognises legacy bracket text produced by older webhook versions", () => {
    for (const [raw, expected] of [
      ["[unsupported]", "unsupported"],
      ["[unknown]", "unknown"],
      ["[contacts]", "contacts"],
      ["[contact]", "contacts"],
      ["[contato]", "contacts"],
      ["[location]", "location"],
      ["[localização]", "location"],
      ["[localizacao]", "location"],
      ["[reaction]", "reaction"],
      ["[order]", "order"],
      ["[poll]", "poll"],
      ["[system]", "system"],
      ["[ephemeral]", "ephemeral"],
      ["[sticker]", "sticker"],
      ["[interactive]", "interactive"],
    ] as const) {
      const p = getUnsupportedPlaceholder({ sourceSubtype: null }, raw);
      expect(p, `expected placeholder for legacy ${raw}`).not.toBeNull();
      expect(p!.rawType).toBe(expected);
      expect(p!.label).toMatch(/^[\p{Emoji}\p{So}\p{Sk}].*/u);
    }
  });

  it("uses sourceSubtype when set to an unsupported type", () => {
    const p = getUnsupportedPlaceholder({ sourceSubtype: "location" }, "");
    expect(p).toEqual({ label: "📍 Localização", rawType: "location" });
  });

  it("does NOT replace image/video/audio bubbles even if sourceSubtype matches", () => {
    for (const sub of ["image", "video", "audio"]) {
      expect(getUnsupportedPlaceholder({ sourceSubtype: sub }, "")).toBeNull();
    }
  });

  it("returns null for regular text (does not swallow user content)", () => {
    expect(
      getUnsupportedPlaceholder({ sourceSubtype: null }, "Bom dia, gostei do produto"),
    ).toBeNull();
    expect(getUnsupportedPlaceholder({ sourceSubtype: null }, "")).toBeNull();
  });

  it("handles unknown bracket types with generic placeholder", () => {
    const p = getUnsupportedPlaceholder({ sourceSubtype: null }, "[weirdtype]");
    expect(p).toEqual({
      label: "✉️ Mensagem não suportada",
      rawType: "weirdtype",
    });
  });

  it("caps bracket detection to avoid matching sentences that start with '['", () => {
    // Long free-form text between brackets must not be treated as a type.
    const p = getUnsupportedPlaceholder(
      { sourceSubtype: null },
      "[Isto é apenas um comentário muito longo que o cliente escreveu entre colchetes]",
    );
    expect(p).toBeNull();
  });

  it("does not accept HTML/script payloads as raw types", () => {
    // The extractor limits raw to [a-z0-9_\- ] up to 32 chars, so a
    // "<script>" payload cannot become the rawType. Even if it did, the
    // renderer places it in data-* / title / plain text — never in HTML.
    const p = getUnsupportedPlaceholder(
      { sourceSubtype: "<script>alert(1)</script>" as unknown as string },
      "",
    );
    expect(p).toBeNull();
  });
});
