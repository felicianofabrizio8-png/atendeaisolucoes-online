// Testes puros para o normalizador de path do bucket product-images.
// Cobre: path relativo, URL pública absoluta, caracteres codificados,
// URLs de outro bucket, host inesperado, e tenant divergente
// (o tenant é validado no chamador, mas o extractor precisa devolver
// path relativo confiável para essa checagem funcionar).

import { describe, it, expect } from "vitest";
import { extractProductImagePath } from "../MetaPublisher.server";

describe("extractProductImagePath", () => {
  it("aceita path relativo simples", () => {
    expect(extractProductImagePath("comp-1/foto.jpg")).toBe("comp-1/foto.jpg");
  });

  it("normaliza barras iniciais em path relativo", () => {
    expect(extractProductImagePath("///comp-1/foto.jpg")).toBe("comp-1/foto.jpg");
  });

  it("extrai path de URL pública absoluta do bucket product-images", () => {
    const url =
      "https://ubnlvxkjemzhvmulowhj.supabase.co/storage/v1/object/public/product-images/comp-1/1780414377319-dznro3.jpg";
    expect(extractProductImagePath(url)).toBe("comp-1/1780414377319-dznro3.jpg");
  });

  it("decodifica caracteres codificados na URL", () => {
    const url =
      "https://ubnlvxkjemzhvmulowhj.supabase.co/storage/v1/object/public/product-images/comp-1/foto%20com%20espa%C3%A7o.jpg";
    expect(extractProductImagePath(url)).toBe("comp-1/foto com espaço.jpg");
  });

  it("rejeita URL de outro bucket", () => {
    const url =
      "https://ubnlvxkjemzhvmulowhj.supabase.co/storage/v1/object/public/marketing-media/comp-1/foto.jpg";
    expect(extractProductImagePath(url)).toBeNull();
  });

  it("rejeita URL de host inesperado", () => {
    const url =
      "https://evil.example.com/storage/v1/object/public/product-images/comp-1/foto.jpg";
    expect(extractProductImagePath(url)).toBeNull();
  });

  it("rejeita path com traversal", () => {
    expect(extractProductImagePath("../etc/passwd")).toBeNull();
  });

  it("rejeita string vazia", () => {
    expect(extractProductImagePath("")).toBeNull();
  });

  it("aceita URL assinada do mesmo bucket", () => {
    const url =
      "https://ubnlvxkjemzhvmulowhj.supabase.co/storage/v1/object/sign/product-images/comp-1/foto.jpg?token=abc";
    expect(extractProductImagePath(url)).toBe("comp-1/foto.jpg");
  });
});
