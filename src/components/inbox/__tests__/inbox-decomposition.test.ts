import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Testes estruturais de não-regressão da Fase 7.3 (decomposição da Inbox).
 * Não validam UI: garantem que a rota permaneça decomposta, que os módulos
 * extraídos existam e que a direção de dependência (rota -> componentes ->
 * helpers) não seja invertida.
 */

const ROUTE = resolve(__dirname, "../../../routes/inbox.$conversationId.lazy.tsx");
const MODULES = [
  "src/lib/inbox/contexts.ts",
  "src/lib/inbox/scroll-trace.tsx",
  "src/lib/inbox/types.ts",
  "src/components/inbox/message/MessageBubble.tsx",
  "src/components/inbox/composer/ComposerWidgets.tsx",
  "src/components/inbox/modals/ConversationModals.tsx",
];

function read(path: string) {
  return readFileSync(resolve(__dirname, "../../../..", path), "utf8");
}

describe("inbox decomposition (fase 7.3)", () => {
  it("mantém a rota abaixo do teto de linhas pós-decomposição", () => {
    const lines = readFileSync(ROUTE, "utf8").split("\n").length;
    expect(lines).toBeLessThan(3000);
  });

  it("todos os módulos extraídos existem", () => {
    for (const m of MODULES) {
      expect(existsSync(resolve(__dirname, "../../../..", m)), m).toBe(true);
    }
  });

  it("nenhum módulo extraído importa a rota (sem ciclo)", () => {
    for (const m of MODULES) {
      const imports = read(m).match(/from\s+["'][^"']+["']/g) ?? [];
      expect(imports.filter((i) => i.includes("inbox.$conversationId")), m).toHaveLength(0);
    }
  });

  it("a rota consome os componentes extraídos em vez de redefini-los", () => {
    const route = readFileSync(ROUTE, "utf8");
    expect(route).toContain("@/components/inbox/message/MessageBubble");
    expect(route).toContain("@/components/inbox/composer/ComposerWidgets");
    expect(route).toContain("@/components/inbox/modals/ConversationModals");
    expect(route).toContain("@/lib/inbox/scroll-trace");
    expect(route).not.toMatch(/^function MessageBubbleImpl/m);
    expect(route).not.toMatch(/^function MediaSendPanel/m);
    expect(route).not.toMatch(/^function CloseSaleModal/m);
  });

  it("a infraestrutura de scroll continua com estado de módulo único", () => {
    const trace = read("src/lib/inbox/scroll-trace.tsx");
    expect(trace.match(/const inboxScrollTraceState/g)).toHaveLength(1);
    expect(trace).toContain("export function getInboxScrollTraceScroller");
    expect(trace).toContain("export function stopInboxScrollTrace");
  });

  it("os contextos compartilhados vivem em um único módulo", () => {
    const ctx = read("src/lib/inbox/contexts.ts");
    for (const name of ["MessagesContext", "VirtuosoScrollContext", "ReplyComposeContext"]) {
      expect(ctx).toContain(`export const ${name}`);
    }
  });
});
