import { describe, it, expect } from "vitest";
import {
  buildAudioStoragePath,
  extractCompanyIdFromAudioPath,
  extForAudioMime,
  sanitizeAudioFilename,
  sanitizeRecommendedForList,
  validateAudioFile,
} from "../audio-library-validation";
import { AUDIO_MAX_FILE_BYTES } from "../audio-library.types";

describe("validateAudioFile", () => {
  it("aceita mp3 dentro do limite quando direitos confirmados", () => {
    const r = validateAudioFile({
      mimeType: "audio/mpeg",
      sizeBytes: 5 * 1024 * 1024,
      commercialUseConfirmed: true,
    });
    expect(r.ok).toBe(true);
  });

  it("bloqueia sem confirmação de direitos comerciais", () => {
    const r = validateAudioFile({
      mimeType: "audio/mpeg",
      sizeBytes: 1024,
      commercialUseConfirmed: false,
    });
    expect(r).toEqual({ ok: false, reason: "commercial_use_not_confirmed" });
  });

  it("rejeita mime não suportado", () => {
    const r = validateAudioFile({
      mimeType: "audio/flac",
      sizeBytes: 1024,
      commercialUseConfirmed: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("mime_type_not_allowed");
  });

  it("rejeita arquivo acima de 30MB", () => {
    const r = validateAudioFile({
      mimeType: "audio/wav",
      sizeBytes: AUDIO_MAX_FILE_BYTES + 1,
      commercialUseConfirmed: true,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("file_too_large");
  });

  it("rejeita tamanho inválido", () => {
    const r = validateAudioFile({
      mimeType: "audio/wav",
      sizeBytes: 0,
      commercialUseConfirmed: true,
    });
    expect(r).toEqual({ ok: false, reason: "invalid_size" });
  });
});

describe("sanitizeAudioFilename", () => {
  it("remove caracteres perigosos e colapsa espaços", () => {
    expect(sanitizeAudioFilename("../etc/passwd  minha música!.mp3")).toBe(
      "etcpasswd-minha-musica.mp3",
    );
  });
  it("usa fallback quando vazio", () => {
    expect(sanitizeAudioFilename("   ")).toBe("audio");
    expect(sanitizeAudioFilename("!!!")).toBe("audio");
  });
  it("limita comprimento", () => {
    const long = "a".repeat(500);
    expect(sanitizeAudioFilename(long).length).toBeLessThanOrEqual(120);
  });
});

describe("buildAudioStoragePath + extractCompanyIdFromAudioPath", () => {
  it("gera path com prefixo companyId/audioId/nome.ext e round-trip", () => {
    const path = buildAudioStoragePath({
      companyId: "company-1",
      audioId: "audio-1",
      originalFilename: "Minha Música.mp3",
      mimeType: "audio/mpeg",
    });
    expect(path).toBe("company-1/audio-1/Minha-Musica.mp3");
    expect(extractCompanyIdFromAudioPath(path)).toBe("company-1");
  });

  it("usa extensão wav para audio/x-wav", () => {
    expect(extForAudioMime("audio/x-wav")).toBe("wav");
    expect(extForAudioMime("audio/wav")).toBe("wav");
    expect(extForAudioMime("audio/mpeg")).toBe("mp3");
  });

  it("extractCompanyIdFromAudioPath devolve null em path inválido", () => {
    expect(extractCompanyIdFromAudioPath("")).toBeNull();
    expect(extractCompanyIdFromAudioPath("semseparador")).toBeNull();
  });

  it("detecta path que pretende escapar da própria empresa", () => {
    const path = "outra-empresa/audio-x/malicioso.mp3";
    expect(extractCompanyIdFromAudioPath(path)).toBe("outra-empresa");
    expect(extractCompanyIdFromAudioPath(path)).not.toBe("company-1");
  });
});

describe("sanitizeRecommendedForList", () => {
  it("filtra valores desconhecidos e remove duplicatas", () => {
    const out = sanitizeRecommendedForList([
      "story",
      "reel",
      "story",
      "invalido",
      42,
      null,
      "feed",
    ]);
    expect(out).toEqual(["story", "reel", "feed"]);
  });
  it("aceita apenas array", () => {
    expect(sanitizeRecommendedForList("story" as unknown)).toEqual([]);
    expect(sanitizeRecommendedForList(null)).toEqual([]);
  });
});
