import { describe, expect, it } from "vitest";
import {
  applyAuditSuggestions,
  attributeRowsFromSpecifications,
  attributeRowsToSpecifications,
  auditCatalogFacts,
  extractQuantities,
  normalizeProductFacts,
  parseDeclaredFactClaims,
  renderFactValue,
  sameQuantity,
  validateDeclaredFactClaims,
  type FactProduct,
} from "../catalog-facts";

// Empresas de segmentos diferentes, cada uma com os atributos que criou.
const sofa: FactProduct = {
  id: "sofa",
  name: "Sofá Aurora",
  category: "Sofás",
  price: 3_490,
  promoPrice: 2_990,
  specifications: {
    Largura: { type: "number", value: 2.1, unit: "m" },
    Tecido: { type: "text", value: "Linho bege" },
    Lugares: { type: "number", value: 3, unit: null },
    "Pés removíveis": { type: "boolean", value: true },
  },
};
const fridge: FactProduct = {
  id: "fridge",
  name: "Refrigerador Polar 480",
  category: "Refrigeradores",
  price: 4_299,
  specifications: {
    Volume: "480 litros",
    Tensão: "220V",
    "Dimensões (A x L x P)": "1,86 x 0,70 x 0,74 m",
    "Consumo (kWh/mês)": 38,
  },
};
const shirt: FactProduct = {
  id: "shirt",
  name: "Camiseta Básica",
  category: "Camisetas",
  price: 59.9,
  specifications: {
    Tamanhos: { type: "list", value: ["P", "M", "G", "GG"] },
    Composição: { type: "text", value: "100% algodão" },
  },
};
const session: FactProduct = {
  id: "session",
  name: "Massagem relaxante",
  category: "Serviços",
  price: 180,
  specifications: { Duração: { type: "number", value: 60, unit: "min" } },
};
// Cadastro legado (colunas + especificação com unidade no rótulo).
const legacy: FactProduct = {
  id: "legacy",
  name: "Sol 401",
  category: "Linha Sol",
  price: 15_900,
  promoPrice: 12_900,
  lengthM: 4,
  widthM: 2.5,
  specifications: { "Profundidade (m)": 1.4, Capacidade: "9.500 litros", material: "fibra" },
};

const claim = (productId: string, fact: string, stated: string, denies = false) => ({
  productId,
  fact,
  stated,
  denies,
});

describe("unidades e grandezas", () => {
  it("compara grandezas da mesma família após conversão", () => {
    expect(sameQuantity({ value: 140, unit: "cm" }, { value: 1.4, unit: "m" })).toBe(true);
    expect(sameQuantity({ value: 9.5, unit: "m³" }, { value: 9_500, unit: "L" })).toBe(true);
    expect(sameQuantity({ value: 1.4, unit: "m" }, { value: 1.4, unit: "L" })).toBe(false);
  });

  it("lê medidas compostas e grandezas sem confundir preço ou nome", () => {
    const extracted = extractQuantities(
      "A Sol 401 está por R$ 12.900,00. Medidas externas: 4 x 2,5 x 1,40 m. Capacidade: 9.500 litros, 220V.",
    );
    expect(extracted.dimensions).toEqual([{ values: [4, 2.5, 1.4], unit: "m" }]);
    expect(extracted.quantities).toEqual([
      { value: 9_500, unit: "L" },
      { value: 220, unit: "V" },
    ]);
  });
});

describe("normalizador de fatos de Produtos", () => {
  it("tipa atributos criados pela empresa sem conhecer o segmento", () => {
    const facts = normalizeProductFacts(sofa).facts;
    const byKey = Object.fromEntries(facts.map((fact) => [fact.key, renderFactValue(fact.value)]));
    expect(byKey).toMatchObject({
      preco: "R$ 3.490,00",
      preco_promocional: "R$ 2.990,00",
      largura: "2,1 m",
      tecido: "Linho bege",
      lugares: "3",
      pes_removiveis: "sim",
    });
  });

  it("lê atributos legados com unidade no valor ou no rótulo", () => {
    const facts = normalizeProductFacts(fridge).facts;
    const byKey = Object.fromEntries(facts.map((fact) => [fact.key, fact.value]));
    expect(byKey.volume).toEqual({ kind: "quantity", value: 480, unit: "L" });
    expect(byKey.tensao).toEqual({ kind: "quantity", value: 220, unit: "V" });
    expect(byKey.dimensoes).toEqual({ kind: "dimensions", values: [1.86, 0.7, 0.74], unit: "m" });
    expect(byKey.consumo).toEqual({ kind: "quantity", value: 38, unit: "kwh/mes" });
  });

  it("colunas legadas viram atributos; especificação duplicada não repete e divergente é conflito", () => {
    const { facts, conflicts } = normalizeProductFacts({
      ...legacy,
      specifications: { ...(legacy.specifications as object), Comprimento: "4 m", Largura: "3 m" },
    });
    const keys = facts.map((fact) => fact.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "comprimento",
        "largura",
        "medidas",
        "profundidade",
        "capacidade",
        "material",
      ]),
    );
    expect(keys.filter((key) => key.startsWith("comprimento"))).toEqual(["comprimento"]);
    expect(conflicts).toEqual([{ label: "Largura", fieldValue: "2,5 m", attributeValue: "3 m" }]);
  });
});

describe("validação de fatos declarados pela interpretação semântica", () => {
  it("aceita linguagem livre quando o valor confere com o atributo declarado", () => {
    const message =
      "O Aurora acomoda até três pessoas, tem 2,10 m de largura e o revestimento é de linho. Sai por R$ 2.990,00.";
    expect(
      validateDeclaredFactClaims({
        message,
        products: [sofa],
        claims: [
          claim("sofa", "lugares", "3"),
          claim("sofa", "largura", "2,10 m"),
          claim("sofa", "tecido", "linho"),
          claim("sofa", "preco_promocional", "R$ 2.990,00"),
        ],
      }),
    ).toEqual({ ok: true });
  });

  it("converte unidade e valida medidas compostas por posição", () => {
    expect(
      validateDeclaredFactClaims({
        message: "Ele tem 186 cm de altura; dimensões 1,86 x 0,70 x 0,74 m e 480 litros em 220V.",
        products: [fridge],
        claims: [
          claim("fridge", "dimensoes", "186 cm"),
          claim("fridge", "dimensoes", "1,86 x 0,70 x 0,74 m"),
          claim("fridge", "volume", "480 litros"),
          claim("fridge", "tensao", "220V"),
        ],
      }),
    ).toEqual({ ok: true });
    expect(
      validateDeclaredFactClaims({
        message: "Dimensões 1,86 x 0,74 x 0,70 m.",
        products: [fridge],
        claims: [claim("fridge", "dimensoes", "1,86 x 0,74 x 0,70 m")],
      }),
    ).toMatchObject({ ok: false, check: "fact_claim", reason: "value_mismatch" });
  });

  it("caso real 401: preço promocional, medidas e capacidade (profundidade só na especificação)", () => {
    expect(
      validateDeclaredFactClaims({
        message:
          "A Sol 401 está por R$ 12.900,00 no valor promocional.\nMedidas externas: 4 x 2,5 m, profundidade de 1,40 m\nCapacidade: 9.500 litros",
        products: [legacy],
        claims: [
          claim("legacy", "preco_promocional", "R$ 12.900,00"),
          claim("legacy", "medidas", "4 x 2,5 m"),
          claim("legacy", "profundidade", "1,40 m"),
          claim("legacy", "capacidade", "9.500 litros"),
        ],
      }),
    ).toEqual({ ok: true });
  });

  it("bloqueia valor diferente do cadastrado, atributo inexistente e produto fora do turno", () => {
    expect(
      validateDeclaredFactClaims({
        message: "Tem 2,30 m de largura.",
        products: [sofa],
        claims: [claim("sofa", "largura", "2,30 m")],
      }),
    ).toMatchObject({ ok: false, reason: "value_mismatch" });
    expect(
      validateDeclaredFactClaims({
        message: "Tem garantia de 5 anos.",
        products: [sofa],
        claims: [claim("sofa", "garantia", "5 anos")],
      }),
    ).toMatchObject({ ok: false, reason: "fact_not_registered" });
    expect(
      validateDeclaredFactClaims({
        message: "Custa R$ 59,90.",
        products: [sofa],
        claims: [claim("shirt", "preco", "R$ 59,90")],
      }),
    ).toMatchObject({ ok: false, reason: "product_not_in_turn" });
  });

  it("bloqueia grandeza afirmada sem declaração (número fora do cadastro)", () => {
    expect(
      validateDeclaredFactClaims({
        message: "O Aurora tem 2,10 m de largura e pesa 45 kg.",
        products: [sofa],
        claims: [claim("sofa", "largura", "2,10 m")],
      }),
    ).toEqual({ ok: false, check: "undeclared_fact", quantity: "45 kg" });
  });

  it("valida listas, booleanos e negações", () => {
    expect(
      validateDeclaredFactClaims({
        message: "Temos nos tamanhos M e GG, 100% algodão.",
        products: [shirt],
        claims: [
          claim("shirt", "tamanhos", "M e GG"),
          claim("shirt", "composicao", "100% algodão"),
        ],
      }),
    ).toEqual({ ok: true });
    expect(
      validateDeclaredFactClaims({
        message: "Tem no tamanho XG.",
        products: [shirt],
        claims: [claim("shirt", "tamanhos", "XG")],
      }),
    ).toMatchObject({ ok: false, reason: "value_mismatch" });
    expect(
      validateDeclaredFactClaims({
        message: "Os pés não são removíveis.",
        products: [sofa],
        claims: [claim("sofa", "pes_removiveis", "não removíveis", true)],
      }),
    ).toMatchObject({ ok: false, reason: "value_mismatch" });
    expect(
      validateDeclaredFactClaims({
        message: "Não temos no tamanho XG.",
        products: [shirt],
        claims: [claim("shirt", "tamanhos", "XG", true)],
      }),
    ).toEqual({ ok: true });
  });

  it("prazo/percentual de políticas não exigem declaração; grandeza de política cadastrada é coberta", () => {
    expect(
      validateDeclaredFactClaims({
        message: "A sessão dura 60 minutos; entrada de 50% e entrega em 15 dias.",
        products: [session],
        claims: [claim("session", "duracao", "60 minutos")],
      }),
    ).toEqual({ ok: true });
    expect(
      validateDeclaredFactClaims({
        message: "Entregamos em um raio de 30 km.",
        products: [session],
        claims: [],
        coverageTexts: ["Entrega grátis até 30 km da loja."],
      }),
    ).toEqual({ ok: true });
  });

  it("lê as declarações do tool call e ignora entradas malformadas", () => {
    expect(parseDeclaredFactClaims(undefined)).toBeNull();
    expect(
      parseDeclaredFactClaims([
        { product_id: "a", fact: "preco", stated: "R$ 10" },
        { product_id: "a", fact: "", stated: "x" },
        "lixo",
        { product_id: "a", fact: "lugares", stated: 3, denies: true },
      ]),
    ).toEqual([claim("a", "preco", "R$ 10"), claim("a", "lugares", "3", true)]);
  });
});

describe("atributos editáveis em Produtos", () => {
  it("converte linhas digitadas em atributos tipados com validação semântica", () => {
    const { specifications, issues } = attributeRowsToSpecifications([
      { label: "Largura", type: "number", value: "2,10", unit: "m" },
      { label: "Medidas", type: "dimensions", value: "4 x 2,5 x 1,40", unit: "m" },
      { label: "Faixa de peso", type: "range", value: "10 a 20", unit: "kg" },
      { label: "Tecido", type: "text", value: "Linho", unit: "" },
      { label: "Cores", type: "list", value: "Azul, Branco", unit: "" },
      { label: "Bivolt", type: "boolean", value: "sim", unit: "" },
      { label: "largura", type: "number", value: "3", unit: "m" },
      { label: "Potência", type: "number", value: "muito", unit: "W" },
      { label: "", type: "text", value: "", unit: "" },
    ]);
    expect(specifications).toEqual({
      Largura: { type: "number", value: 2.1, unit: "m" },
      Medidas: { type: "dimensions", value: [4, 2.5, 1.4], unit: "m" },
      "Faixa de peso": { type: "range", value: { min: 10, max: 20 }, unit: "kg" },
      Tecido: { type: "text", value: "Linho" },
      Cores: { type: "list", value: ["Azul", "Branco"] },
      Bivolt: { type: "boolean", value: true },
    });
    expect(issues).toEqual([
      { index: 6, error: "label_duplicate" },
      { index: 7, error: "number_invalid" },
    ]);
  });

  it("abre cadastro legado como linhas tipadas (sem perder informação)", () => {
    expect(attributeRowsFromSpecifications(legacy.specifications)).toEqual([
      { label: "Profundidade", type: "number", value: "1,4", unit: "m" },
      { label: "Capacidade", type: "number", value: "9.500", unit: "L" },
      { label: "material", type: "text", value: "fibra", unit: "" },
    ]);
  });
});

describe("auditoria somente leitura do catálogo", () => {
  it("aponta pendências e sugere tipagem inequívoca sem gravar nada", () => {
    const products: FactProduct[] = [
      {
        ...legacy,
        description: "Piscina com 9.500 litros e borda de 30 cm.",
        specifications: { "Profundidade (m)": 1.4, Altura: 1.2, Capacidade: "9.500 litros" },
      },
      { ...legacy, id: "copy", name: "Sol 401 (cópia)", promoPrice: 16_000 },
    ];
    const snapshot = JSON.stringify(products);
    const report = auditCatalogFacts(products);
    expect(JSON.stringify(products)).toBe(snapshot);
    const first = report.find((entry) => entry.productId === "legacy");
    expect(first?.issues).toEqual(
      expect.arrayContaining([
        { code: "attribute_untyped", subject: "Profundidade (m)", detail: "1,4 m" },
        { code: "attribute_missing_unit", subject: "Altura", detail: "1,2" },
        { code: "fact_only_in_free_text", subject: "Descrição", detail: "30 cm" },
        { code: "possible_duplicate", detail: "2 produtos com o mesmo nome" },
      ]),
    );
    expect(first?.issues.some((issue) => issue.detail === "9500 L")).toBe(false);
    expect(first?.suggestions).toEqual([
      { label: "Profundidade", attribute: { type: "number", value: 1.4, unit: "m" } },
      { label: "Capacidade", attribute: { type: "number", value: 9_500, unit: "L" } },
    ]);
    expect(report.find((entry) => entry.productId === "copy")?.issues).toEqual(
      expect.arrayContaining([{ code: "promo_not_lower" }]),
    );
    expect(applyAuditSuggestions(products[0].specifications, first?.suggestions ?? [])).toEqual({
      Altura: 1.2,
      Profundidade: { type: "number", value: 1.4, unit: "m" },
      Capacidade: { type: "number", value: 9_500, unit: "L" },
    });
  });
});
