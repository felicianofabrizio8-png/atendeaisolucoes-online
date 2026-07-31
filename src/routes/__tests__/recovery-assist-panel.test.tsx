// ============================================================================
// SPRINT 6 · FASE 6.2 — Recovery Panel (UI).
//
// Verifica o contrato visível do painel em mobile e desktop: gerar estratégia,
// exibir motivo/estratégia/mensagem/alternativas/template/explainability, e
// "Usar no campo" preparando o composer SEM enviar nada.
// ============================================================================
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "token-fake" } } }),
    },
  },
}));

import { RecoveryAssistPanel } from "@/components/recovery/RecoveryAssistPanel";
import { consumeComposerFocus, readDraft } from "@/lib/inbox/mobile-session";

const CONV = "33333333-3333-4333-8333-333333333333";

const RESPONSE = {
  plan: {
    probableReason: "Provavelmente o valor ficou acima do esperado.",
    strategy: "Reabrir com condição de pagamento e prova social.",
    tone: "consultivo",
    insistence: "media",
    bestMoment: "terça à tarde",
    cta: "confirmar interesse",
    primaryMessage: "Oi Maria, ainda faz sentido retomar o projeto da piscina?",
    alternatives: ["Alternativa curta", "Alternativa com foco em prazo"],
    explanation: "Score 78 e orçamento não visualizado.",
    templateName: "followup_orcamento",
    requiresTemplate: true,
  },
  context: {
    score: 78,
    chancePercent: 44,
    stalledLabel: "3d 2h",
    lastSpeaker: "vendedor",
    window: { state: "closed", label: "Janela fechada há 3d — só template aprovado.", requiresTemplate: true },
    factors: ["Orçamento enviado e não visualizado", "Lead de alto valor"],
  },
  fingerprint: "fp-1",
  cached: false,
  generatedAt: new Date().toISOString(),
};

function mockFetch(ok = true, body: unknown = RESPONSE, status = 200) {
  return vi.fn(async () => ({
    ok,
    status,
    json: async () => body,
  })) as unknown as typeof fetch;
}

beforeEach(() => {
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function generate() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /gerar estratégia/i }));
  await screen.findByText(RESPONSE.plan.primaryMessage);
  return user;
}

describe("RecoveryAssistPanel", () => {
  it("gera e exibe motivo, estratégia, mensagem, alternativas e template", async () => {
    vi.stubGlobal("fetch", mockFetch());
    const onUse = vi.fn();
    render(<RecoveryAssistPanel conversationId={CONV} onUseInComposer={onUse} />);

    await generate();

    expect(screen.getByText(/valor ficou acima do esperado/i)).toBeTruthy();
    expect(screen.getByText(/prova social/i)).toBeTruthy();
    expect(screen.getByText("Alternativa curta")).toBeTruthy();
    expect(screen.getByText("Alternativa com foco em prazo")).toBeTruthy();
    expect(screen.getByText("followup_orcamento")).toBeTruthy();
  });

  it("mostra explainability sob demanda", async () => {
    vi.stubGlobal("fetch", mockFetch());
    render(<RecoveryAssistPanel conversationId={CONV} onUseInComposer={() => {}} />);
    const user = await generate();

    await user.click(screen.getByRole("button", { name: /ver explicação/i }));
    expect(await screen.findByText(/Orçamento enviado e não visualizado/i)).toBeTruthy();
    expect(screen.getByText(/chance 44%/i)).toBeTruthy();
  });

  it("'Usar no campo' prepara o composer e não envia mensagem", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    const onUse = vi.fn();
    render(<RecoveryAssistPanel conversationId={CONV} onUseInComposer={onUse} />);
    const user = await generate();

    await user.click(screen.getByRole("button", { name: /usar no campo/i }));

    expect(readDraft(CONV)).toContain("ainda faz sentido retomar");
    expect(consumeComposerFocus(CONV)).toBe(true);
    expect(onUse).toHaveBeenCalledWith(CONV);
    // Uma única chamada: a de geração. Nenhum endpoint de envio foi tocado.
    expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    const [url] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("/api/recovery/assist");
  });

  it("permite editar a mensagem antes de usar", async () => {
    vi.stubGlobal("fetch", mockFetch());
    render(<RecoveryAssistPanel conversationId={CONV} onUseInComposer={() => {}} />);
    const user = await generate();

    await user.click(screen.getByRole("button", { name: /^editar$/i }));
    const box = screen.getByLabelText(/editar mensagem sugerida/i) as HTMLTextAreaElement;
    await user.clear(box);
    await user.type(box, "Texto ajustado pelo vendedor");
    await user.click(screen.getByRole("button", { name: /usar no campo/i }));

    expect(readDraft(CONV)).toContain("Texto ajustado pelo vendedor");
  });

  it("regenerar força nova chamada com force=true", async () => {
    const fetchMock = mockFetch();
    vi.stubGlobal("fetch", fetchMock);
    render(<RecoveryAssistPanel conversationId={CONV} onUseInComposer={() => {}} />);
    const user = await generate();

    await user.click(screen.getByRole("button", { name: /gerar novamente/i }));
    await waitFor(() =>
      expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2),
    );
    const [, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(JSON.parse((init as RequestInit).body as string).force).toBe(true);
  });

  it("exibe erro amigável do contrato do AI Gateway", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(false, { error: "Os créditos de IA do workspace acabaram.", code: "credits_exhausted" }, 402),
    );
    const user = userEvent.setup();
    render(<RecoveryAssistPanel conversationId={CONV} onUseInComposer={() => {}} />);
    await user.click(screen.getByRole("button", { name: /gerar estratégia/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/créditos de IA/i);
  });
});
