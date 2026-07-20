import { describe, it, expect } from "vitest";
import {
  parseMeasureQuery,
  extractPrincipalLengths,
  productMatchesMeasure,
} from "@/lib/product-measure-filter";

describe("parseMeasureQuery", () => {
  it("interpreta números puros como medida", () => {
    expect(parseMeasureQuery("5")).toBe(5);
    expect(parseMeasureQuery("10")).toBe(10);
    expect(parseMeasureQuery(" 6 ")).toBe(6);
  });
  it("aceita sufixo m/metros", () => {
    expect(parseMeasureQuery("5m")).toBe(5);
    expect(parseMeasureQuery("5 m")).toBe(5);
    expect(parseMeasureQuery("6 metros")).toBe(6);
    expect(parseMeasureQuery("6 metro")).toBe(6);
  });
  it("não interpreta texto livre", () => {
    expect(parseMeasureQuery("piscina")).toBeNull();
    expect(parseMeasureQuery("sol 500")).toBeNull();
    expect(parseMeasureQuery("6x3")).toBeNull();
    expect(parseMeasureQuery("")).toBeNull();
  });
  it("10 não é interpretado como 1", () => {
    expect(parseMeasureQuery("10")).toBe(10);
    expect(parseMeasureQuery("10")).not.toBe(1);
  });
});

describe("extractPrincipalLengths", () => {
  it("extrai medida principal de dimensões (NxM)", () => {
    expect([...extractPrincipalLengths({ name: "Piscina 6x3" })]).toEqual([6]);
    expect([...extractPrincipalLengths({ name: "Piscina 5x2,5" })]).toEqual([5]);
    expect([...extractPrincipalLengths({ name: "Sol 500", description: "5x2,40x1,40" })])
      .toEqual([5]);
  });
  it("ignora o 500 de 'Sol 500' e não retorna 5", () => {
    const lens = extractPrincipalLengths({ name: "Sol 500" });
    expect(lens.has(5)).toBe(false);
    expect(lens.size).toBe(0);
  });
  it("ignora dígitos de preço/litragem", () => {
    const lens = extractPrincipalLengths({
      name: "Piscina Premium",
      description: "Capacidade 5000 litros, preço R$ 26.000",
    });
    expect(lens.size).toBe(0);
  });
  it("aceita '5 m' e '6 metros'", () => {
    expect(extractPrincipalLengths({ name: "Piscina 5 m" }).has(5)).toBe(true);
    expect(extractPrincipalLengths({ name: "X", description: "Comprimento 6 metros" }).has(6)).toBe(true);
  });
});

describe("productMatchesMeasure — exclusão de outros tamanhos", () => {
  const sol500 = { name: "Sol 500", description: "5x2,40x1,40" };
  const sol801 = { name: "Sol 801", description: "8x4x1,40" };
  const p6 = { name: "Piscina de fibra 6x3", description: "6,00 x 3,00 x 1,40m" };
  const p10 = { name: "Piscina 10x5", description: "10 metros" };
  const p1 = { name: "Modelo 1x1", description: "1x1x0,5" };

  it("termo 5 aceita 5x2,40 e exclui 8x4", () => {
    expect(productMatchesMeasure(sol500, 5)).toBe(true);
    expect(productMatchesMeasure(sol801, 5)).toBe(false);
  });
  it("termo 6 exclui 5 e 8", () => {
    expect(productMatchesMeasure(p6, 6)).toBe(true);
    expect(productMatchesMeasure(sol500, 6)).toBe(false);
    expect(productMatchesMeasure(sol801, 6)).toBe(false);
  });
  it("termo 10 casa com 10x5 e NÃO casa com 1x1", () => {
    expect(productMatchesMeasure(p10, 10)).toBe(true);
    expect(productMatchesMeasure(p1, 10)).toBe(false);
    expect(productMatchesMeasure(p10, 1)).toBe(false);
  });
});
