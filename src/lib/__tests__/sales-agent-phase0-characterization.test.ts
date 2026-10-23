import { describe, expect, it } from "vitest";
import {
  computeLeadScore,
  detectObjections,
  detectReadyToClose,
  mergeObjections,
  normalizeState,
  normalizeTiming,
  temperatureFromScore,
} from "../ai-qualifier.server";
import { detectHandoffNeeded, runSafetyLayer } from "../ai-agent.server";
import {
  mergeConversationSalesState,
  revalidateConversationSalesState,
  sanitizeConversationSalesState,
} from "../conversation-sales-state";
import { DEFAULT_TEMPLATES, firstName, isWithinBusinessHours, renderTemplate } from "../followup/defaults";
import { humanizeTemplate } from "../followup/humanizer";
import { buildSalesAgentSystemPrompt, buildValidatedCatalogReply } from "../sales-agent-core";
import { extractCurrentProductAttributes, selectRelevantSalesAgentProducts } from "../sales-agent-grounding.server";
import {
  extractCompanyProductImagePath,
  normalizeRequestedProductIds,
  resolveProductImages,
} from "../sales-agent-product-images";
import {
  SYNTHETIC_COMPANIES,
  syntheticCatalog,
  syntheticContext,
  syntheticConversationState,
  syntheticFollowupSettings,
} from "./fixtures/sales-agent-phase0-fixtures";

describe("Fase 0 — caracterização da vendedora (comportamento observado)", () => {
  describe("qualificação e score", () => {
    it("normaliza sinais comerciais e acumula objeções", () => {
      expect(normalizeState("sp")).toBe("SP");
      expect(normalizeTiming("comprar no próximo mês")).toBe("30d");
      expect(detectReadyToClose("Pode fazer o pedido hoje?")).toBe(true);
      expect(detectObjections("Está caro e preciso parcelar")).toEqual(["preco", "financiamento"]);
      expect(mergeObjections(["preco", "desconhecida"], ["prazo", "preco"])).toEqual(["preco", "prazo"]);
    });

    it("calcula score determinístico e faixas de temperatura", () => {
      const score = computeLeadScore({
        detected_city: "Cidade Sintética",
        detected_state: "SP",
        detected_pool_size: "6x3",
        detected_interest: "modelo H6",
        detected_budget: "até 25 mil",
        purchase_timing: "imediato",
        customer_stage: "pronto_para_comprar",
        lead_ready_to_close: true,
        objections: ["preco"],
      });
      expect(score).toBe(100);
      expect(temperatureFromScore(score)).toBe("quente");
      expect(temperatureFromScore(50)).toBe("morno");
      expect(temperatureFromScore(49)).toBe("frio");
    });
  });

  describe("catálogo e fotos", () => {
    it("extrai espaço como contexto e filtra o catálogo sintético de piscinas", () => {
      const history = [{ role: "lead" as const, text: "Tenho um quintal 8x5 e quero uma piscina" }];
      expect(extractCurrentProductAttributes(history)).toMatchObject({ spaceLengthM: 8, spaceWidthM: 5 });
      expect(selectRelevantSalesAgentProducts(syntheticCatalog, history).map((p) => p.id)).toEqual([
        syntheticCatalog[0].id,
        syntheticCatalog[1].id,
      ]);
    });

    it("formata fatos do catálogo sem inventar preço ou foto", () => {
      const reply = buildValidatedCatalogReply([syntheticCatalog[0]], { includePrice: true });
      expect(reply).toContain("Modelo Horizonte 6x3");
      expect(reply).toContain("R$ 22.900,00");
      expect(reply).toContain("12 meses");
      expect(reply).not.toContain("https://");
    });

    it("mantém escopo de empresa ao normalizar e resolver imagens", () => {
      const otherId = "10000000-0000-4000-8000-000000000099";
      expect(normalizeRequestedProductIds([syntheticCatalog[0].id, syntheticCatalog[0].id, "ruim"])).toEqual([
        syntheticCatalog[0].id,
      ]);
      expect(extractCompanyProductImagePath(`${SYNTHETIC_COMPANIES.pools}/modelo-h6.jpg`, SYNTHETIC_COMPANIES.pools))
        .toBe(`${SYNTHETIC_COMPANIES.pools}/modelo-h6.jpg`);
      expect(extractCompanyProductImagePath(`${SYNTHETIC_COMPANIES.furniture}/mesa.jpg`, SYNTHETIC_COMPANIES.pools))
        .toBeNull();
      expect(resolveProductImages([syntheticCatalog[0].id, otherId], syntheticCatalog, SYNTHETIC_COMPANIES.pools))
        .toHaveLength(1);
    });
  });

  describe("memória e contexto", () => {
    it("sanitiza atributos, deduplica referências e remove produto inativo", () => {
      const sanitized = sanitizeConversationSalesState(syntheticConversationState);
      expect(sanitized.lastCatalogQuery?.confidence).toBe(1);
      expect(revalidateConversationSalesState(sanitized, [syntheticCatalog[0].id]).productIds)
        .toEqual([syntheticCatalog[0].id]);
      const merged = mergeConversationSalesState(sanitized, {
        attributes: { widthM: 3 },
        candidateProductIds: [syntheticCatalog[1].id, syntheticCatalog[1].id],
      });
      expect(merged.attributes).toMatchObject({ spaceLengthM: 8, widthM: 3 });
      expect(merged.lastValidProductIds).toEqual([syntheticCatalog[1].id]);
    });
  });

  describe("handoff e políticas comerciais", () => {
    it("distingue pergunta informativa de pedido comercial sensível", () => {
      expect(detectHandoffNeeded("Qual o prazo de instalação?").needed).toBe(false);
      expect(detectHandoffNeeded("Consegue dar desconto?").needed).toBe(true);
      expect(detectHandoffNeeded("Quero fechar hoje").needed).toBe(true);
    });

    it("bloqueia percentual não cadastrado e preserva percentual cadastrado", () => {
      const allowed = runSafetyLayer(
        { kind: "reply", message: "A entrada é de 30%.", grounding_sources: ["commercial_rules"] },
        syntheticContext.grounding.commercialRules.commercialTerms,
      );
      const blocked = runSafetyLayer(
        { kind: "reply", message: "Posso dar 15% de desconto.", grounding_sources: ["commercial_rules"] },
        syntheticContext.grounding.commercialRules.commercialTerms,
      );
      expect(allowed.kind).toBe("reply");
      expect(blocked).toMatchObject({ kind: "handoff" });
    });

    it("injeta política autorizada no contexto do prompt", () => {
      const prompt = buildSalesAgentSystemPrompt(syntheticContext, [
        { role: "lead", text: "Quais formas de pagamento?" },
      ]);
      expect(prompt).toContain("Entrada de 30% cadastrada");
      expect(prompt).toContain("Instalação avaliada por região");
      expect(prompt).toContain("Modelo Horizonte 6x3");
    });
  });

  describe("follow-up", () => {
    it("renderiza templates sintéticos e respeita a janela configurada", () => {
      expect(firstName("Cliente Sintético")).toBe("Cliente");
      expect(renderTemplate(DEFAULT_TEMPLATES.quote_no_reply, { nome: "Cliente" })).toContain("Cliente");
      expect(isWithinBusinessHours(syntheticFollowupSettings, new Date("2026-10-20T10:00:00"))).toBe(true);
      expect(isWithinBusinessHours(syntheticFollowupSettings, new Date("2026-10-20T19:00:00"))).toBe(false);
    });

    it("humaniza de forma reproduzível para o mesmo seed e tentativa", () => {
      const first = humanizeTemplate("Olá {{nome}}, posso ajudar?", 2, 7, { nome: "Cliente" });
      const second = humanizeTemplate("Olá {{nome}}, posso ajudar?", 2, 7, { nome: "Cliente" });
      expect(first).toEqual(second);
      expect(first.text).toContain("Cliente");
      expect(first.text).not.toContain("{{nome}}");
    });
  });
});
