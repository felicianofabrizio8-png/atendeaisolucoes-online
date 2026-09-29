import { describe, expect, it } from "vitest";
import {
  fitVar1ToTemplate,
  renderBodyWithParameters,
  resumeTemplateProblem,
  templateBodyText,
} from "../wa-template-contract";

// Formato do chamar_novamente no caso real (lead_silent).
const BODY =
  "Olá {{1}}, tudo bem?\n\nPor favor, confirme o recebimento desta mensagem respondendo por aqui.\n\nObrigado.";
const VAR1 = "sobre as informações que solicitou, para darmos continuidade ao seu atendimento";

describe("contrato do template WhatsApp", () => {
  it("render real = body aprovado byte a byte com o var1 (o caso real)", () => {
    expect(renderBodyWithParameters(BODY, [VAR1])).toBe(
      "Olá sobre as informações que solicitou, para darmos continuidade ao seu atendimento, tudo bem?\n\nPor favor, confirme o recebimento desta mensagem respondendo por aqui.\n\nObrigado.",
    );
  });

  it("render marcado só envolve o var1 em {{ }}; o texto fixo não muda", () => {
    const marked = renderBodyWithParameters(BODY, [VAR1], { marked: true });
    expect(marked).toBe(
      "Olá {{sobre as informações que solicitou, para darmos continuidade ao seu atendimento}}, tudo bem?\n\nPor favor, confirme o recebimento desta mensagem respondendo por aqui.\n\nObrigado.",
    );
    expect(marked.replace(/\{\{|\}\}/g, "")).toBe(renderBodyWithParameters(BODY, [VAR1]));
  });

  it("valores com $&/$1 são literais", () => {
    expect(renderBodyWithParameters("x {{1}} y", ["a$&b $1"])).toBe("x a$&b $1 y");
  });

  it("templateBodyText lê o BODY exato, ignorando HEADER/FOOTER", () => {
    expect(
      templateBodyText([
        { type: "HEADER", text: "Oi" },
        { type: "body", text: BODY },
        { type: "FOOTER", text: "rodapé" },
      ]),
    ).toBe(BODY);
    expect(templateBodyText(null)).toBe("");
  });

  it("fitVar1ToTemplate: sem pontuação final quando o template continua", () => {
    expect(fitVar1ToTemplate(VAR1 + ",", BODY)).toBe(VAR1);
    expect(fitVar1ToTemplate(VAR1 + ".", BODY)).toBe(VAR1);
    expect(fitVar1ToTemplate("ainda posso te ajudar com o projeto?", "Olá {{1}} tudo bem?")).toBe(
      "ainda posso te ajudar com o projeto",
    );
    expect(fitVar1ToTemplate("  " + VAR1 + "  ", BODY)).toBe(VAR1); // vírgulas internas ficam
    // {{1}} no fim do body: nada a encaixar depois
    expect(fitVar1ToTemplate("Podemos seguir?", "Oi! {{1}}")).toBe("Podemos seguir?");
  });

  it("retomada exige exatamente {{1}}", () => {
    const t = (variables: string[], text: string) => ({
      name: "chamar_novamente",
      variables,
      components: [{ type: "BODY", text }],
    });
    expect(resumeTemplateProblem(t(["var1"], BODY))).toBeNull();
    expect(resumeTemplateProblem(t(["var1", "var2"], "{{1}} {{2}}"))).toMatch(/2 variáveis/);
    expect(resumeTemplateProblem(t([], "Olá, tudo bem?"))).toMatch(/0 variáveis/);
    expect(resumeTemplateProblem(t(["var1"], "Olá {{nome}}"))).toMatch(/não tem \{\{1\}\}/);
  });
});
